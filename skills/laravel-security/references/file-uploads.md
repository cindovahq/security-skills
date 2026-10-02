# Laravel — File Uploads, Storage and Downloads

## Contents
- Upload validation
- Storing files
- Executable uploads (RCE)
- Active content (stored XSS)
- Downloads and path traversal
- Private files and access control
- Processing uploaded content
- Livewire / Filament uploads
- Verification

## Upload validation

| Rule | What it checks |
|---|---|
| `file` | A successfully uploaded file |
| `mimes:jpg,png,pdf` | **Content-based**: guesses the MIME type from file contents, then maps it to an extension |
| `mimetypes:image/jpeg,...` | Content-based MIME type |
| `extensions:jpg,png` | The **client-supplied** extension (pair with `mimes`) |
| `image` | Content is an image. **Laravel 12+ excludes SVG** unless `image:allow_svg` |
| `File::types([...])->max('5mb')` / `File::image()->dimensions(...)` | Fluent rule builder |
| `max:` | Size in **kilobytes** for files |

**Investigate:**
- No validation on an upload endpoint, or only `required`.
- `mimes`/`mimetypes` without restricting **how the file is stored** (see below). Polyglot files (valid JPEG that is also valid PHP/HTML) pass content checks. Validation alone doesn't stop executable or active-content uploads.
- Size limits missing (resource exhaustion). Also check `upload_max_filesize`/`post_max_size` and web server body limits.
- Allowing `svg`, `html`, `htm`, `xml`, `xhtml`, `js`, `php*`, `phtml`, `phar`, `shtml`, `.htaccess` anywhere they could be served.
- Validation applied in one entry point (web form) but not another (API, Livewire, Filament field).

## Storing files

```php
$path = $request->file('avatar')->store('avatars', 'public');      // random name via hashName()
$path = $request->file('avatar')->storeAs('avatars', $name, 'public');
Storage::disk('public')->putFileAs('docs', $file, $file->getClientOriginalName());
$file->move(public_path('uploads'), $file->getClientOriginalName());
```

- `store()` / `hashName()` generate a random 40-character name, and the extension is **guessed from content** (`guessExtension()`). Good default.
- `getClientOriginalName()` / `getClientOriginalExtension()` are **attacker-controlled**. Using them as the stored filename lets the attacker choose the extension (`shell.php`), overwrite other files with predictable names, and inject odd characters.
- `move(public_path(...))` writes directly into the web root: native PHP, no Flysystem path normalization.
- Disks (`config/filesystems.php`):
  - `public` → `storage/app/public`, served via the `public/storage` symlink (`php artisan storage:link`). **Everything here is world-readable by URL.**
  - `local` → `storage/app/private` by default in Laravel 12+ (when no `local` disk is defined), `storage/app` before. Not web-served.
  - `s3` etc. → check bucket ACLs and `visibility` (`'visibility' => 'public'` and `->storePublicly()` make objects public).

## Executable uploads (RCE)

**Critical** when all of these hold:
1. The attacker controls the stored extension (`getClientOriginalName/Extension`, or `storeAs` with input).
2. The file lands in a web-served directory (`public` disk, `public_path()`).
3. The web server executes PHP there. A typical nginx `location ~ \.php$ { fastcgi_pass ... }` executes **any** `.php` file under the document root, including `/storage/x.php` via the symlink. Apache with `AddHandler`/`SetHandler` behaves similarly. Check deployment configs (nginx confs, Dockerfiles, `.htaccess`) when they're in the repo. Otherwise mark the finding **Likely** and state the server assumption.

**Fix:** random names with server-chosen extensions (`store()`), allow-listed extensions, non-public disk for anything not meant to be public, and deny script execution under `/storage` and `/uploads` at the web server.

## Active content (stored XSS)

SVG (with `<script>` or `onload`), HTML, XML and some PDFs execute script **in the app's origin** when served inline from the same domain. Avatars and attachments are the usual vectors. **High** if other users or admins view them.

**Fix:** disallow these types, or serve them with `Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff`, or from a separate cookieless domain or CDN, or sanitize SVG (e.g. `enshrined/svg-sanitize`).

## Downloads and path traversal

```php
return response()->download(storage_path('app/invoices/' . $request->file));   // ../../.env
return response()->file(public_path($request->path));
return Storage::download($request->input('path'));
return Storage::disk('s3')->get("users/{$request->user_id}/{$request->name}");
```

- **Native paths** (`storage_path()`, `base_path()`, `public_path()` + input with `response()->download/file`, `file_get_contents`, `File::get`): `../` traversal → arbitrary file read (`.env` → `APP_KEY`, DB creds). **High/Critical.**
- **Flysystem paths** (`Storage::...`): Flysystem's path normalizer **throws on `..` that escapes the disk root**, so classic traversal outside the disk is blocked. The remaining risk is **reading other users' files inside the same disk**, i.e. access control (IDOR). Report it as authorization, not traversal.
- Filenames in `Content-Disposition`: use `response()->download($path, $safeName)`. Laravel/Symfony encode the header safely.

**Fix:** look up files by database record (`$doc = $request->user()->documents()->findOrFail($id); return Storage::download($doc->path, $doc->original_name);`), never by a client-supplied path. If a path is unavoidable, use `basename()` and an allow-listed directory.

## Private files and access control

- Private documents (invoices, IDs, medical, exports) on the `public` disk or a public S3 bucket. Unguessable names reduce discoverability but are **not** access control. URLs leak via referrers, logs and shared links. **Medium/High** depending on data.
- `Storage::temporaryUrl($path, now()->addMinutes(5))` (S3 and local disk with `serve` support) and signed routes are good patterns. Check the expiry, and that the URL is generated only after authorization.
- Exports and backups written to `public/` (`public/exports/users.csv`, `public/backup.sql`) → **High**.

## Processing uploaded content

- **Archives:** extracting ZIPs. Check entry names for `../` and absolute paths before extracting (zip slip), and limit total uncompressed size and entry count (zip bombs). Don't assume `ZipArchive::extractTo` sanitizes every case. Validate entries yourself.
- **Images:** ImageMagick/Imagick on untrusted files. Keep the ImageMagick policy restrictive (disable `MVG`, `MSL`, `URL`, `EPHEMERAL`, `PS`/`PDF` coders where not needed). Decompression bombs: check pixel dimensions before processing (`dimensions` rule).
- **Spreadsheets/CSV imports:** formula injection on re-export; XXE in XLSX parsers (keep packages updated); huge files.
- **XML/SVG parsing** with entity loading flags (see `injection.md`).
- **EXIF** metadata (GPS) on public user photos: privacy hardening (strip on upload).

## Livewire / Filament uploads

- **Livewire** `WithFileUploads` stores temporary uploads (default disk under `livewire-tmp/`) before your validation runs on save. Configure `config/livewire.php` → `temporary_file_upload.rules` (default allows any file up to 12 MB in v3) and `disk`. Validate again in the action (`$this->validate(['photo' => 'image|max:1024'])`).
- **Filament** `FileUpload` field: check `->acceptedFileTypes()`, `->maxSize()`, `->disk()`, `->visibility('private')`, and `->preserveFilenames()` (keeps attacker-controlled names → see executable uploads).

## Verification

```php
it('rejects php uploads', function () {
    Storage::fake('public');
    $file = UploadedFile::fake()->create('shell.php', 1, 'application/x-php');
    $this->actingAs(User::factory()->create())
        ->post('/avatar', ['avatar' => $file])
        ->assertSessionHasErrors('avatar');
    expect(Storage::disk('public')->allFiles())->toBeEmpty();
});

it('stores with a random name', function () {
    Storage::fake('public');
    $this->actingAs(User::factory()->create())
        ->post('/avatar', ['avatar' => UploadedFile::fake()->image('../../evil.php.jpg')]);
    expect(Storage::disk('public')->allFiles()[0])->not->toContain('evil');
});

it('prevents downloading other users documents', function () {
    [$a, $b] = User::factory()->count(2)->create();
    $doc = Document::factory()->for($a)->create();
    $this->actingAs($b)->get("/documents/{$doc->id}/download")->assertForbidden();
});
```

References: OWASP File Upload Cheat Sheet; CWE-434, CWE-22, CWE-73, CWE-79, CWE-409; https://laravel.com/docs/filesystem, /validation#rule-mimes, /requests#storing-uploaded-files.
