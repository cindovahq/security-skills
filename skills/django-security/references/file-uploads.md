# Django — File Uploads, Storage and Downloads

## Contents
- What Django does and does not do
- Upload validation
- Storage and serving
- Downloads and path traversal
- Archives and image processing
- Resource limits
- Severity, false positives, verification

## What Django does and does not do

Does:
- `FileField`/`ImageField` take the upload's base name, run it through `Storage.get_valid_name()`/`generate_filename()` and reject `..` in `upload_to` directories (`SuspiciousFileOperation`). `FileSystemStorage` resolves paths with `safe_join`. A client-supplied filename like `../../x.py` therefore does not escape `MEDIA_ROOT` through the standard storage API.
- `FileSystemStorage.get_available_name()` avoids overwriting by appending a random suffix. `FILE_UPLOAD_PERMISSIONS` defaults to `0o644`.
- `ImageField` runs Pillow verification and `validate_image_file_extension`.
- Sets `X-Content-Type-Options: nosniff` via `SecurityMiddleware` by default.

Does **not**:
- Restrict extensions or content types on a plain `FileField`. `UploadedFile.content_type` is client-supplied.
- Detect polyglots. The docs warn that a file with a valid PNG header followed by HTML passes `ImageField` verification and may be rendered as HTML if served that way.
- Protect `os.path.join(base, user)`, `open()`, `FileResponse(open(...))`, `zipfile`/`tarfile` extraction, or `shutil` calls you write yourself.
- Cap upload size. `DATA_UPLOAD_MAX_MEMORY_SIZE` excludes files; `FILE_UPLOAD_MAX_MEMORY_SIZE` is only the threshold for spilling to disk. The docs tell you to limit request size at the web server.

## Upload validation

Investigate every `FileField`, `ImageField`, `request.FILES`, `UploadedFile`, DRF `FileField`/`ImageField`, and direct `default_storage.save(...)`.

- No allow-list of extensions and types: `FileField(upload_to="docs/")` with no validators. Danger depends on where files are served (below).
- Extension-only validation: `FileExtensionValidator` is bypassed by renaming (docs: "Don't rely on validation of the file extension to determine a file's type"). Combine it with content sniffing (`python-magic`, `filetype`, Pillow `Image.open().verify()`) and by re-encoding images.
- Trusting `content_type` or the original extension for access decisions.
- `upload_to` callables that embed unsanitized user input (`f"{instance.folder}/{filename}"` where `folder` is user-controlled): traversal is blocked for `..`, but users can still write into other users' prefixes or reserved names. Prefer server-generated paths (`uuid4().hex` + a server-chosen extension).
- Storing with the **original filename** in the URL path or `Content-Disposition` and trusting it elsewhere (templates, shell commands, ZIP names).
- django-storages S3: `AWS_S3_FILE_OVERWRITE` defaults to `True`, so same-named uploads overwrite each other. Combined with predictable keys that is data tampering.
- SVG, HTML, XML, PDF and Office files accepted as "images/documents": SVG and HTML run script when served inline from your origin (stored XSS). Require raster formats or sanitize SVG; force download.

Fix pattern:

```python
def avatar_path(instance, filename):
    return f"avatars/{instance.pk}/{uuid.uuid4().hex}.png"      # server-controlled name and extension

class Profile(models.Model):
    avatar = models.ImageField(upload_to=avatar_path, validators=[FileExtensionValidator(["png", "jpg", "jpeg"])])
```

then validate size in `clean_avatar`, re-encode with Pillow, and serve with `Content-Disposition: attachment` or from a separate domain.

## Storage and serving

- **Production should not serve media through Django.** `django.conf.urls.static.static()` is a no-op when `DEBUG=False` (the helper checks `settings.DEBUG`). An explicit `re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})` or `django.views.static.serve` in a production `urls.py` works regardless of `DEBUG`, is documented as "not suitable for production use", serves every file under the root to everyone (no authentication), and delivers uploaded HTML/SVG from the application origin. **High** when users can upload such files; **Medium** otherwise.
- Same-origin hosting of user content is an XSS and cookie-scope risk. Django's docs recommend a distinct registrable domain for `MEDIA_URL` (for example `usercontent-example.com`); `usercontent.example.com` is "not sufficient".
- Web server config for `MEDIA_ROOT`: no script execution (the deployment checklist says the server must never interpret uploads), `nosniff`, explicit content types, optional `Content-Disposition: attachment`.
- Private files: store outside `MEDIA_ROOT` or in a private bucket; serve through an authorized view (`FileResponse` or `X-Accel-Redirect`/`X-Sendfile` after the check) or signed, expiring URLs (`django-storages` `querystring_auth`, `AWS_QUERYSTRING_EXPIRE`). Public-read buckets (`AWS_DEFAULT_ACL = "public-read"`) holding private documents are findings (**High**).
- `MEDIA_ROOT` inside `STATIC_ROOT`/source tree, world-writable directories, `FILE_UPLOAD_PERMISSIONS = 0o777`, `FILE_UPLOAD_TEMP_DIR` in a shared location.
- Cache `LOCATION` within `MEDIA_ROOT`: the cache holds pickled data (`injection.md`).

## Downloads and path traversal

```python
# vulnerable: user chooses any path under or outside the reports directory
path = os.path.join(settings.BASE_DIR, "reports", request.GET["file"])
return FileResponse(open(path, "rb"), as_attachment=True)

# safe: resolve and verify containment, or use an ID, not a path
base = (settings.BASE_DIR / "reports").resolve()
path = (base / request.GET["file"]).resolve()
if not path.is_relative_to(base) or not path.is_file():
    raise Http404
```

`django.utils._os.safe_join(base, *paths)` raises `SuspiciousFileOperation` when the result leaves `base` (private module; usable but unversioned API). `default_storage.open(name)` uses the same containment for `FileSystemStorage`. Better: look the file up by a database ID owned by the user and never build paths from request data.

Investigate `FileResponse(open(...))`, `HttpResponse(open(...).read())`, `send_file`-style helpers, `open(request...)`, `Path(request...)`, `os.path.join(base, user)` (a leading `/` in the user part discards `base`), `shutil.copy`, `os.remove`, `glob(user)`, template file loaders reading `user` names, and `X-Accel-Redirect` values built from user strings. Arbitrary file read reaches `.env`, `settings.py`, SSH keys and the database file: **Critical/High**.

## Archives and image processing

- `ZipFile.extractall`/`TarFile.extractall` on uploads: path traversal and symlink members. Validate member names and sizes. Python 3.14 made `tarfile` default to the safe `data` extraction filter; on older Pythons pass `filter="data"` (3.12+, and backported to current 3.8 to 3.11 patch releases). ZIP members are not covered by that filter; check `os.path.commonpath`.
- `django.utils.archive.extract` partial traversal (CVE-2025-59682) affects only `startapp/startproject --template`.
- Zip bombs and decompression bombs: cap uncompressed size and file counts. Pillow raises `DecompressionBombError` beyond about twice `Image.MAX_IMAGE_PIXELS`; do not disable it. Re-encode images and strip metadata.
- Thumbnailers and converters (`ImageMagick`, `ffmpeg`, `ghostscript`, `libreoffice`) running on uploads: use argument lists, sandboxes and timeouts (`injection.md`).

## Resource limits

Django has no default maximum upload size. Set limits at the proxy (`client_max_body_size` in nginx), and in the app (`clean_<field>` checking `file.size`, DRF validators). Review `DATA_UPLOAD_MAX_NUMBER_FILES` (default 100) and `DATA_UPLOAD_MAX_NUMBER_FIELDS` (default 1000). Under ASGI, the whole request may be spooled before limits apply, and ASGI-only upload-limit bypasses were patched in 2026 (CVE-2026-5766, CVE-2026-33034), and a multipart-parser DoS affecting every server (CVE-2026-33033); stay patched. Missing size limits are **Medium/Low** (DoS), higher when unauthenticated.

## Severity, false positives, verification

False positives: user filename used only as display text (escaped); `upload_to` with server-generated names; file served only through an authenticated view with `as_attachment=True`; `static()` helper in a production `urls.py` (inert when `DEBUG=False`); user-chosen filename passed through `default_storage.save()` (sanitized by storage).

Verify:

```python
def test_upload_rejects_html_and_traversal(client, user):
    client.force_login(user)
    r = client.post("/support/upload/", {"file": SimpleUploadedFile("../../x.html", b"<script>1</script>", "text/html")})
    assert r.status_code == 400
    assert not Path(settings.MEDIA_ROOT, "x.html").exists()

def test_download_stays_inside_reports(client, user):
    client.force_login(user)
    assert client.get("/support/download/", {"file": "../settings.py"}).status_code in (400, 404)
```

```bash
curl -sI https://staging.example.com/media/<uploaded-file> | grep -i 'content-type\|content-disposition\|x-content-type'
```

References: OWASP File Upload cheat sheet, ASVS 5.0 V5; CWE-434, CWE-22, CWE-73, CWE-79; https://docs.djangoproject.com/en/stable/topics/security/#user-uploaded-content, https://docs.djangoproject.com/en/stable/ref/files/uploads/, https://docs.djangoproject.com/en/stable/howto/static-files/#serving-files-uploaded-by-a-user-during-development.
