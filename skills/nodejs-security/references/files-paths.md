# Node.js — Path Traversal, File Serving and Uploads

## Contents
- Path traversal with `fs` and `path`
- Express `res.sendFile` / `res.download`
- Static file serving
- Uploads with multer and friends
- Serving uploaded files
- Archives (zip slip)
- False positives
- Verification

## Path traversal with `fs` and `path`

`path.join(base, input)` normalizes `..` segments, so `path.join('/srv/files', '../../etc/passwd')` → `/etc/passwd`. `path.resolve(base, input)` returns `input` itself when it is absolute. Neither is a security check. Route params and query values arrive URL-decoded (`%2e%2e%2f` → `../`).

```js
// Vulnerable
fs.readFile(path.join(UPLOAD_DIR, req.query.name), ...);
fs.createReadStream(`./exports/${req.params.file}`).pipe(res);

// Fixed: resolve, then require the base directory prefix (with separator)
const base = path.resolve(UPLOAD_DIR);
const target = path.resolve(base, String(req.query.name));
if (!target.startsWith(base + path.sep)) return res.sendStatus(400);
```

- Use `fs.realpath` on both sides when symlinks inside the directory could point elsewhere.
- `startsWith(base)` without the separator lets `/srv/files-private/x` match `/srv/files`.
- Better: don't accept paths at all. Look up a stored file record by ID (authorized for the user) and use the stored server-generated name.
- Also check `require(userPath)`, `import(userPath)`, `res.render(req.query.view)`, `fs.unlink`/`rm` (arbitrary file delete), `fs.writeFile` with user paths (overwrite of code or `.ssh/authorized_keys` → RCE).

Severity: arbitrary file read → **High** (Critical when `.env`, keys or cloud credentials are readable); arbitrary write/delete → **Critical**.

## Express `res.sendFile` / `res.download`

Verified against Express 5.2 / `send` 1.2:

- `res.sendFile(path)` requires an absolute path **or** the `root` option.
- **With `root`:** the user-supplied relative path is checked for `..` segments after decoding, and requests escaping `root` get **403**. `res.sendFile(req.params.name, { root: AVATAR_DIR })` is safe against traversal.
- **Without `root`:** `send` rejects paths that still contain `..` segments, but code that pre-joins (`res.sendFile(path.join(__dirname, 'files', name))`) has already normalized the `..` away, so traversal works (tested: 200 with `name=../package.json`).
- `res.download(path)` without `root` calls `path.resolve()` first, which also normalizes `..` away: `res.download('uploads/' + name)` is traversal.
- `dotfiles` default for `send`/`sendFile` is `'ignore'` (404 for dot-segments). With an absolute path and no `root`, the dot check covers the whole path.
- Both set `Content-Type` from the extension: serving a user-chosen `.html`/`.svg` from your origin is stored XSS (see below).

## Static file serving

- `express.static(dir)` (serve-static): safe against traversal; review **what** is in `dir`. Serving the project root or `__dirname` exposes `.env` (Express 5 ignores dotfiles by default; Express 4 also ignored dotfiles but served files **inside** dot-directories, such as `.git/` contents), `package.json`, source code, and `node_modules`.
- `dotfiles: 'allow'` on a broad directory → exposure of `.env`, `.git`.
- Static middleware mounted before auth for private files.
- Koa `koa-static`/`koa-send` need `root`; `hidden` defaults to `false`. Fastify `@fastify/static` needs `root`. Hono `serveStatic` from `@hono/node-server/serve-static`: keep Hono and the adapter patched (a September 2026 advisory, GHSA-5r4p-p66f-jhc7, covers a double-decoding middleware bypass in `serveStatic`).

## Uploads with multer and friends

multer 2.x facts (README):
- `limits` defaults are **Infinity** for `fileSize`, `files`, `fields`, `parts`, `fieldNestingDepth`, etc. Always set `fileSize` and `files`.
- `file.originalname` is client-supplied ("treat it as untrusted"). With `preservePath: true` it includes client path segments.
- `diskStorage` without `filename` uses a random name with **no extension**; a custom `filename` callback using `file.originalname` lets the client choose the name and extension (overwrite, traversal on older code, `.html` uploads).
- `file.mimetype` comes from the client's multipart header, not the content.
- multer published many DoS advisories in 2026 (aborted uploads, nested field names, fd leaks); keep it on the latest 2.x.

```js
// Vulnerable
const storage = multer.diskStorage({
  destination: 'public/uploads',
  filename: (req, file, cb) => cb(null, file.originalname),
});
// Fixed
const storage = multer.diskStorage({
  destination: PRIVATE_UPLOAD_DIR,                                          // not under a static root
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${allowedExt(file)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype)) });
// then verify magic bytes (e.g. `file-type`) before accepting
```

Also review `busboy`, `formidable` (`keepExtensions`, `uploadDir`, `maxFileSize`), `@fastify/multipart` (`limits`), and direct-to-S3 presigned uploads (content-type and key chosen by the client?).

## Serving uploaded files

- Uploads stored under a static directory with user-controlled extension → HTML/SVG/JS served from your origin → **stored XSS** (High), plus overwrite of other users' files when names collide.
- Prefer a separate domain (user-content origin) or object storage with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and a fixed safe `Content-Type`.
- Authorize downloads: route by file ID and check ownership; don't rely on unguessable names for private documents unless that is an accepted design (signed, expiring URLs).
- Image processing (`sharp`, ImageMagick via `child_process`, `pdf-lib`/`pdfjs`) on untrusted files: keep libraries patched; set pixel limits (`sharp` has `limitInputPixels`).

## Archives (zip slip)

Extraction libraries (`adm-zip`, `unzipper`, `yauzl`, `tar`, `decompress`) have had traversal bugs; current versions of `tar` (node-tar) strip `..` and absolute paths by default, but custom extraction loops (`entry.path` → `fs.createWriteStream(path.join(dest, entry.path))`) need the resolve + prefix check above, plus limits on entry count and total size (zip bombs). Symlink entries need explicit handling.

## False positives

- `res.sendFile(name, { root: dir })`.
- `path.resolve` + `startsWith(base + path.sep)` (or `path.relative` not starting with `..` and not absolute).
- `express.static('public')` where `public/` contains only build assets.
- `path.basename(userName)` used to strip directories before joining (still check for empty names and dotfiles).

## Verification

```js
it('blocks traversal in downloads', async () => {
  await agent.get('/files/download?name=../../package.json').expect((r) => expect([400, 403, 404]).toContain(r.status));
  await agent.get('/files/download?name=..%2f..%2fpackage.json').expect((r) => expect(r.status).not.toBe(200));
});
it('does not keep client file names or extensions', async () => {
  const r = await agent.post('/files/upload').attach('file', Buffer.from('<script>1</script>'), 'x.html');
  expect(r.body.url).not.toMatch(/x\.html$/);
});
```

References: OWASP Path Traversal, File Upload Cheat Sheets; CWE-22, CWE-23, CWE-73, CWE-434, CWE-552; https://expressjs.com/en/5x/api.html#res.sendFile, https://github.com/expressjs/multer, https://github.com/pillarjs/send.
