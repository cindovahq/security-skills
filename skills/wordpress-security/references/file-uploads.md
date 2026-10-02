# WordPress — File Uploads and File Operations

## Contents
- How core handles uploads
- Upload vulnerabilities
- Arbitrary file read, write and delete
- Archives, imports and exports
- Server configuration
- Verification

## How core handles uploads

- `wp_handle_upload( $_FILES['file'], [ 'test_form' => false ] )` / `media_handle_upload()` check the type against `get_allowed_mime_types()` (filterable via `upload_mimes`) using `wp_check_filetype_and_ext()`, which combines the extension with real content type detection for images and more. Files go to `wp-content/uploads/YYYY/MM/` with a sanitized, unique filename.
- `test_form => false` is normal (it skips the `action` field check). **`test_type => false` disables type checking. Investigate it.**
- Users need `upload_files` (Author and above) for the media library. Plugin upload handlers don't inherit this. They must check capabilities themselves.
- `unfiltered_upload` (any file type) isn't granted by default, even to admins, unless `ALLOW_UNFILTERED_UPLOADS` is defined.

## Upload vulnerabilities

| Pattern | Risk |
|---|---|
| `move_uploaded_file( $_FILES['f']['tmp_name'], $dir . $_FILES['f']['name'] )` | Arbitrary file upload: `.php` lands in a web-served directory → **RCE (Critical)** |
| Checking `$_FILES['f']['type']` (client-supplied MIME) or extension with `strpos`/`substr` | Bypassable (`shell.php.jpg`, `shell.pHp`, `shell.php%00.jpg` on old PHP, `.phtml`/`.phar` if executed) |
| `wp_handle_upload( …, [ 'test_type' => false ] )` | No type checking |
| `upload_mimes` filter adding `svg`, `html`, `htm`, `xml`, `js`, `php`, `swf` | SVG/HTML → stored XSS on the site origin; executable types → RCE |
| `nopriv` or subscriber-reachable upload handlers | Unauthenticated file upload |
| Writing to plugin directories (`plugin_dir_path(__FILE__) . 'uploads/'`) | Plugin dirs are web-served and usually execute PHP |
| Predictable names/locations for private files (`uploads/myplugin/invoice-123.pdf`) | IDOR: uploads are public by URL |

**SVG:** WordPress doesn't allow SVG by default. Plugins that enable it must sanitize (e.g. `enshrined/svg-sanitize`) or restrict it to trusted roles.

## Arbitrary file read, write and delete

```php
readfile( WP_CONTENT_DIR . '/uploads/' . $_GET['file'] );        // ../../wp-config.php → DB creds and salts (Critical)
wp_delete_file( $upload_dir . $_POST['file'] );                    // delete wp-config.php → reinstall wizard → takeover (Critical)
unlink( $_POST['path'] );
file_put_contents( $dir . $_POST['name'], $_POST['content'] );     // write PHP → RCE
copy( $_POST['src'], $_POST['dst'] );
```

- **Arbitrary file deletion is Critical in WordPress**: deleting `wp-config.php` puts the site into installation mode, and the attacker can connect it to their own database.
- Fix: never take paths from input. Map IDs to stored paths. If a filename is required: `$name = sanitize_file_name( wp_unslash( $_GET['file'] ) ); $path = realpath( $base . $name ); if ( ! $path || ! str_starts_with( $path, realpath( $base ) . DIRECTORY_SEPARATOR ) ) { wp_die(); }`. Also `validate_file( $name ) === 0`. Plus capability checks and ownership.

## Archives, imports and exports

- `unzip_file()` (uses `WP_Filesystem`) and raw `ZipArchive::extractTo()` on user-supplied archives: check entry names for `../` and absolute paths (zip slip), block executable extensions, and limit size and file count.
- Import features (CSV, JSON, XML, "import settings") are often reachable by lower roles via AJAX. Check the capability, the nonce, and what the import writes (options → privilege escalation, posts → stored XSS, `unserialize` → object injection).
- Export features (users, orders, form entries, backups) written to `wp-content/uploads/…` with predictable names → PII disclosure. Exports should be streamed or stored outside the web root with random names, and require capabilities.
- Backup plugins storing archives with DB dumps in web-accessible paths → Critical data exposure.

## Server configuration

- PHP execution in `wp-content/uploads/` should be disabled (nginx `location ~* /wp-content/uploads/.*\.php$ { deny all; }`, or an Apache `.htaccess` in uploads). Absence is Hardening by itself, and Critical **when** an upload flaw exists.
- Directory listing disabled (`Options -Indexes`, `autoindex off`).
- File permissions: `wp-config.php` not world-readable (e.g. 600/640), no 777 directories.

## Verification

- As a subscriber (and unauthenticated), call each upload/file handler with `shell.php`, `x.php.jpg`, a polyglot JPEG with PHP, and `x.svg` with `<script>`. Expect rejection, or storage that never executes or serves inline.
- Path parameters: `../wp-config.php`, `..%2fwp-config.php`, absolute paths → rejected.
- Confirm on staging that `https://site.test/wp-content/uploads/test.php` (a harmless `<?php echo 1;` placed manually) returns 403 or plain text, not `1`.
- PHPUnit: simulate `$_FILES` with `tmp_name` and assert `wp_handle_upload` errors for disallowed types.

References: `wp_handle_upload()`, `wp_check_filetype_and_ext()`, `validate_file()` reference; Hardening WordPress (Advanced Administration Handbook); CWE-434, CWE-22, CWE-73, CWE-552.
