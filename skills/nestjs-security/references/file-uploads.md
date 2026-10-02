# NestJS — File Uploads, Downloads and Static Files

## Contents
- How uploads work in Nest
- Limits
- Type validation
- Storage and naming
- Serving files
- Downloads and path traversal
- Fix pattern
- False positives
- Verification

Generic upload and path-traversal reasoning is in the `nodejs-security` skill (files, paths and uploads reference). This file covers the Nest APIs.

## How uploads work in Nest

`FileInterceptor('file', options)`, `FilesInterceptor`, `FileFieldsInterceptor`, `AnyFilesInterceptor` from `@nestjs/platform-express` wrap **multer**. The interceptor options are multer's (`dest`, `storage`, `limits`, `fileFilter`, `preservePath`, `defParamCharset`). Without `dest`/`storage`, files are kept in memory (`file.buffer`). `@UploadedFile(new ParseFilePipe({...}))` validates after multer has consumed the stream. On the Fastify adapter, Nest 12.1 adds interceptors backed by `@fastify/multipart` (default `fileSize` equals `bodyLimit`, 1 MiB; `parts` 1000) and a Fastify-only `FileStreamInterceptor`; Fastify's interceptors do not support multer's `fieldNestingDepth`/`fieldArrayIndexLimit`.

## Limits

- multer has **no default file size, file count or part count limit** (only `fieldSize` 1 MB and `headerPairs` 2000). Without `limits: { fileSize, files, fields, parts }` an attacker can exhaust memory (memory storage) or disk.
- `MaxFileSizeValidator` runs inside `ParseFilePipe`, i.e. **after** the whole file has been received and buffered or written. It is a business rule, not a DoS defence. Set `limits.fileSize` on the interceptor as well.
- multer versions matter: `@nestjs/platform-express` up to 10.4.17 bundled multer 1.4.4-lts.1, 11.0.0 to 11.1.1 bundled 1.4.5-lts (1.x has unpatched DoS advisories), and 2.0.x to 2.3.x have later DoS advisories (crafted field names, aborted uploads). multer 2.4.0 is the fixed version on 2026-10-02, shipped with `@nestjs/platform-express` 11.2.6 and 12.0.3. See `dependencies.md`.
- Compressed archives uploaded and extracted server-side: zip-slip and decompression bombs (`nodejs-security`).

## Type validation

`FileTypeValidator({ fileType })` from `@nestjs/common`:
- Since 10.4.16 / 11.0.16 the validator reads the file's **magic number** with the `file-type` package and compares the detected MIME type; it needs `file.buffer` (memory storage). With disk storage there is no buffer and validation fails unless `fallbackToMimetype: true` (an option added in 11.1.0; on 10.4.x and 11.0.x disk-storage uploads always fail this validator).
- `fallbackToMimetype: true` and `skipMagicNumbersValidation: true` fall back to / use the client-supplied `Content-Type`, which an attacker controls. The Fastify `FileStreamInterceptor` docs tell you to set `skipMagicNumbersValidation` because no buffer exists, so streaming uploads are not content-checked.
- `fileType` is matched with `String#match`/`RegExp`, i.e. **unanchored**: `'image'` or `/png|jpeg/` also match other strings containing them. Use `/^image\/(png|jpeg)$/`.
- Content types without magic numbers (SVG, HTML, text, CSV, JS) cannot be detected by `file-type` (XML only when it starts with an XML prolog, and then SVG with a prolog is typed `application/xml`); allowing them via fallback permits active content. Never accept `image/svg+xml` or `text/html` for public serving.
- Versions before 10.4.16 / 11.0.16 relied on the client-provided header: `CVE-2024-29409` (`GHSA-cj7v-w2c7-cp7c`), fixed in 10.4.16 and 11.0.16.
- A magic-number match proves only the first bytes; polyglots exist. Re-encode images (sharp) and store outside the web root.
- `fileFilter` in multer options sees only the client's `mimetype`/`originalname`; do not treat it as validation. Async `fileFilter` has had a size-limit race fixed in multer 2.3.0 (`CVE-2026-77063`).

## Storage and naming

- `diskStorage({ filename: (req, file, cb) => cb(null, file.originalname) })`: client-controlled name and extension; overwrites other users' files with the same name; multer strips directory components from `originalname` unless `preservePath: true`, so check for that option.
- Preserving the client extension (`extname(file.originalname)`) into a directory that is later served or executed.
- `dest: 'uploads'` relative to the working directory, inside the served static directory.
- Fix: random server-generated names (`randomUUID()`), extension derived from the **detected** type, store metadata (owner, original name) in the database, files outside the web root or in object storage with private ACLs and signed URLs.

## Serving files

- `ServeStaticModule.forRoot({ rootPath })` / `app.useStaticAssets()` serve every file in a directory without Nest guards; user uploads placed there are public and same-origin (stored XSS via `.html`/`.svg`, phishing pages). Set `serveStaticOptions: { index: false }` and never mix uploads with the app's own assets.
- `@Res() res.sendFile(path)` / `res.download()` and `StreamableFile(createReadStream(path))` with user-controlled `path`.
- Missing `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a restrictive `Content-Type` on user content (`@Header()` or `StreamableFile` options).
- Download endpoints must check ownership of the file record (`authorization.md`), not just authentication.

## Downloads and path traversal

```ts
// Vulnerable: Express decodes %2f in :name, so "..%2f..%2fetc%2fpasswd" becomes "../../etc/passwd"
@Get('download/:name')
download(@Param('name') name: string) {
  return new StreamableFile(createReadStream(join(UPLOAD_DIR, name)));
}
```

Fix: look up a file record by ID for the current user and read the stored path from the database; or resolve and verify containment: `const full = resolve(UPLOAD_DIR, name); if (!full.startsWith(UPLOAD_DIR + sep)) throw new NotFoundException();`. Validate the parameter with `@Matches(/^[\w-]+\.\w+$/)` or `ParseUUIDPipe`.

## Fix pattern

```ts
@Post('avatar')
@UseInterceptors(FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}))
async avatar(
  @UploadedFile(new ParseFilePipe({ validators: [
    new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
    new FileTypeValidator({ fileType: /^image\/(png|jpeg)$/ }),   // magic-number check, no fallback
  ]})) file: Express.Multer.File,
  @CurrentUser() user: AuthUser,
) {
  const name = `${randomUUID()}.png`;                              // never the client name
  await this.storage.put(name, await reencode(file.buffer));
  return this.users.setAvatar(user.id, name);
}
```

## False positives

- Uploads written to a private directory/bucket with random names, size limits and magic-number validation, served only through an authenticated, owner-checked endpoint.
- `fileType: 'image/png'` with default options on memory storage: the magic-number check applies (the unanchored match is only a Hardening note).
- `originalname` stored as database metadata and returned escaped, never used as a filesystem path.
- `ServeStaticModule` serving only build output.

## Verification

```ts
it('rejects a non-image renamed to .png', () =>
  request(app.getHttpServer()).post('/users/me/avatar').set(auth)
    .attach('file', Buffer.from('<html></html>'), { filename: 'a.png', contentType: 'image/png' }).expect(400));
it('rejects oversized files', () =>
  request(app.getHttpServer()).post('/users/me/avatar').set(auth)
    .attach('file', Buffer.alloc(3 * 1024 * 1024), 'big.png').expect(413));
it('does not traverse', () =>
  request(app.getHttpServer()).get('/documents/download/..%2f..%2fpackage.json').set(auth).expect(404));
```

References: https://docs.nestjs.com/techniques/file-upload (v12: /http/file-upload), https://github.com/expressjs/multer, OWASP File Upload Cheat Sheet; CWE-434, CWE-22, CWE-79, CWE-400.
