# ASP.NET Core — File Uploads, Downloads and Static Files

## Contents
- Framework behavior
- Uploads
- Downloads and path traversal
- Static files
- Severity, false positives, verification

## Framework behavior

- `IFormFile.FileName` is the raw `Content-Disposition` filename (the parser only removes quotes). It can contain `../`, absolute paths, or Windows separators. Microsoft's docs: never use it for storage; use it only for display and logging after HTML encoding.
- Limits: Kestrel `MaxRequestBodySize` 30,000,000 bytes (~28.6 MB); IIS `maxAllowedContentLength` and `IISServerOptions.MaxRequestBodySize` the same; `FormOptions.MultipartBodyLengthLimit` 128 MB. `[RequestSizeLimit]`, `[DisableRequestSizeLimit]` and `[RequestFormLimits]` change them per endpoint.
- `PhysicalFileProvider` (used by static files, `File("~/x")` virtual results and `WebRootFileProvider`) re-roots leading `/` or `\` under its root, rejects drive-rooted paths and paths that climb above its root, and by default excludes dot-prefixed and hidden/system files. `PhysicalFile(path)`, `File.OpenRead`, `FileStream` and `Path.Combine` give no such protection.
- `Path.Combine(root, userPath)` returns `userPath` unchanged when it is rooted (`/etc/passwd`, `C:\...`); `..` segments pass through untouched.

## Uploads

**Investigate:**
```csharp
var path = Path.Combine(_env.WebRootPath, "uploads", file.FileName);          // traversal on write + same-origin serving
using var fs = System.IO.File.Create(path); await file.CopyToAsync(fs);
```
1. **Storage location:** under `wwwroot` (served by `UseStaticFiles`/`MapStaticAssets` with the extension's content type: `.html`, `.svg`, `.js` become stored XSS on the app origin) versus outside the web root or in blob storage.
2. **Name:** client name used (overwrite of other files, traversal) versus `Path.GetRandomFileName()`/GUID.
3. **Type validation:** only `file.ContentType` (client-controlled), deny-lists of extensions (`.svg`, `.xhtml`, `.htm` slip through), or substring checks (`FileName.Contains(".jpg")`). Prefer an allow-list of extensions from `Path.GetExtension`, a signature (magic bytes) check, and re-encoding images when practical.
4. **Size and count:** unbounded `IFormFileCollection`, `[DisableRequestSizeLimit]` on public endpoints, buffering large files into memory (`file.OpenReadStream()` into `MemoryStream`).
5. **Archives:** `ZipFile.ExtractToDirectory` is safe against entries that escape the destination (it throws), but manual `entry.FullName` handling with `Path.Combine` is zip-slip; check uncompressed size limits (zip bombs).
6. **Processing:** ImageSharp/Magick.NET/SkiaSharp versions with advisories (`dependencies.md`), shelling out to converters with the file name (`injection.md`), antivirus scanning for files shared with other users.
7. **Authorization and CSRF:** upload endpoints using cookies must keep antiforgery (minimal API `IFormFile` binding validates automatically in 8.0+ unless `.DisableAntiforgery()`), and the object the file attaches to must be owner-checked.

**Fix:**
```csharp
var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
if (!AllowedExtensions.Contains(ext) || file.Length is 0 or > 5_000_000) return BadRequest();
var stored = Path.Combine(_options.UploadRoot, Path.GetRandomFileName() + ext);   // UploadRoot is outside wwwroot
await using (var fs = new FileStream(stored, FileMode.CreateNew)) await file.CopyToAsync(fs);
```
Serve user files from an authorized action with `Content-Disposition: attachment` (`File(stream, contentType, downloadName)`), `X-Content-Type-Options: nosniff`, or from a separate domain/blob storage with SAS links.

## Downloads and path traversal

```csharp
public IActionResult Download(string name) => PhysicalFile(Path.Combine(_root, name), "application/octet-stream");
```
`name = "../../appsettings.json"` or an absolute path reads arbitrary files the process can access (configuration with secrets, Data Protection keys). Also check `File.ReadAllBytes`, `FileStreamResult` over `File.OpenRead`, and `Directory.GetFiles(Path.Combine(root, userDir))`.

**Fix:** look up files by ID in the database (owner-scoped), or canonicalize and contain:
```csharp
var full = Path.GetFullPath(Path.Combine(_root, name));
if (!full.StartsWith(Path.GetFullPath(_root) + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return NotFound();
```
(`OrdinalIgnoreCase` on Windows.)

## Static files

- `UseStaticFiles()` / `MapStaticAssets()` serve `wwwroot` publicly; static files mapped before `UseAuthorization()` get no authorization checks. On 9.0+ `MapStaticAssets` endpoints are subject to the fallback policy unless marked anonymous. Look for exports, reports, backups, logs, `.env` or key files written into `wwwroot`.
- `ServeUnknownFileTypes = true` serves files of any extension (Microsoft calls it a security risk; it's off by default). Use `FileExtensionContentTypeProvider` mappings instead.
- `UseDirectoryBrowser()` / `AddDirectoryBrowser()` (off by default) list folder contents.
- Extra `StaticFileOptions { FileProvider = new PhysicalFileProvider(somePath) }` pointing at upload, log or content-root folders publishes them.

## Severity, false positives, verification

Severity: arbitrary file read (config, keys) **High/Critical**; arbitrary file write or overwrite **Critical** (code or config replacement); stored XSS via uploaded HTML/SVG served same-origin **High/Medium**; missing size limits **Low/Medium** (DoS).

False positives: `FileName` used only for display or for an extension allow-list; `File("~/docs/manual.pdf")` virtual paths; `PhysicalFileProvider`-backed lookups with user subpaths; uploads stored with generated names outside `wwwroot`; `ZipFile.ExtractToDirectory`.

Verify: an integration test posting a multipart file named `../../evil.txt` and asserting no file appears outside the upload root; `GET /files/download?name=..%2F..%2Fappsettings.json` returns 404; an `.html` upload is rejected or served with `Content-Disposition: attachment`.

References: https://learn.microsoft.com/aspnet/core/mvc/models/file-uploads, https://learn.microsoft.com/aspnet/core/fundamentals/static-files, https://learn.microsoft.com/dotnet/api/system.io.path.combine; OWASP File Upload cheat sheet; CWE-22, CWE-434, CWE-73.
