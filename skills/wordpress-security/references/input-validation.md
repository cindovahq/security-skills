# WordPress — Input Handling, Object Injection and Code Execution

## Contents
- Reading input safely
- Sanitize vs validate
- PHP object injection
- Local file inclusion and dynamic code
- Mass updates from request data
- Settings API
- Verification

## Reading input safely

WordPress adds slashes to `$_GET`, `$_POST`, `$_COOKIE`, `$_SERVER` and `$_REQUEST` (`wp_magic_quotes()`). The canonical pattern:

```php
$title = isset( $_POST['title'] ) ? sanitize_text_field( wp_unslash( $_POST['title'] ) ) : '';
$id    = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
```

- `$_REQUEST` mixes GET, POST (and cookies, depending on `request_order`). Prefer the specific superglobal so CSRF and logging reasoning stays clear.
- `$_SERVER['HTTP_*']` headers, `REMOTE_ADDR` behind proxies, and `REQUEST_URI` are attacker-controlled. IP-based logic (rate limiting, allow-lists) using `HTTP_X_FORWARDED_FOR`/`HTTP_CLIENT_IP` is spoofable unless a trusted proxy sets it.

## Sanitize vs validate

| Data | Sanitize | Validate |
|---|---|---|
| Integer ID | `absint()` | `> 0`, object exists, user may access it |
| Free text | `sanitize_text_field()`, `sanitize_textarea_field()` | length |
| Key/slug | `sanitize_key()`, `sanitize_title()` | allow-list |
| Email | `sanitize_email()` | `is_email()` |
| URL | `sanitize_url()` / `esc_url_raw()` | scheme/host allow-list (see `ssrf-redirects.md`) |
| Filename | `sanitize_file_name()` | extension allow-list; `validate_file()` for paths |
| HTML | `wp_kses_post()` / `wp_kses()` | |
| Enum | — | `in_array( $v, $allowed, true )` |
| Array | `array_map( 'sanitize_text_field', … )` | expected keys only |

Sanitizing doesn't make data safe for every sink. Escape for output (`xss-escaping.md`), prepare for SQL (`sql-injection.md`), and validate paths (`file-uploads.md`).

**Type confusion:** request values can be arrays (`?id[]=1`). Functions like `sanitize_text_field( $_GET['x'] )` on an array return an empty string, and `in_array`/comparisons with arrays can behave unexpectedly. Check `is_string()`/`is_array()` where it matters. Loose comparisons (`==`) on tokens or secrets: use `hash_equals()`.

## PHP object injection

`unserialize()` and `maybe_unserialize()` on attacker-controlled data → **PHP object injection** (CWE-502). With a gadget chain in WordPress core, active plugins or Composer dependencies, that can mean file deletion or RCE. Common sources:

```php
$data = unserialize( base64_decode( $_COOKIE['myplugin_cart'] ) );
$prefs = maybe_unserialize( $_POST['prefs'] );
$items = maybe_unserialize( get_user_meta( $uid, 'imported', true ) );   // if the meta was written from user input as a string
```

- Severity: unauthenticated or subscriber-reachable → **Critical/High**. Even without a known gadget chain in the codebase, report it (chains appear with other plugins). Note the absence of a known chain as a precondition.
- Fix: use `json_encode`/`json_decode`. If PHP serialization is unavoidable, `unserialize( $s, [ 'allowed_classes' => false ] )`.
- WordPress's own options/meta API serializes arrays. Passing a **string that looks like a serialized object** from users into `update_option`/`update_post_meta` is mostly safe (core double-serializes serialized strings), but code that later calls `unserialize()` on raw DB strings is not.

## Local file inclusion and dynamic code

```php
include plugin_dir_path( __FILE__ ) . 'templates/' . $_GET['view'] . '.php';     // LFI via ../
require $_POST['module'];                                                          // RCE
call_user_func( $_POST['callback'], $_POST['arg'] );                               // arbitrary function call
$method = $_REQUEST['method']; $this->$method();                                   // arbitrary method
do_action( $_POST['hook'] ); apply_filters( $_GET['filter'], … );                  // arbitrary hook execution
extract( $_POST );                                                                 // overwrites local variables ($is_admin, $user_id, …)
eval( $code ); assert( $string ); create_function( … ); preg_replace( '/…/e', … ); // code execution
```

Fixes: allow-list (`$views = [ 'list' => 'list.php', 'grid' => 'grid.php' ]`), `validate_file()` for path checks, never call functions/hooks named by input, never `extract()` request data.

Also check **PHP files that run directly** without loading WordPress (`ajax.php` or `download.php` in plugin folders that read `$_GET` and touch files or the DB). They bypass all WordPress auth. Every plugin PHP file should start with `defined( 'ABSPATH' ) || exit;` unless it's an intentional endpoint, and those need their own authentication.

## Mass updates from request data

```php
foreach ( $_POST as $key => $value ) { update_option( $key, $value ); }           // arbitrary option update → admin takeover
foreach ( $_POST['meta'] as $k => $v ) { update_user_meta( $uid, $k, $v ); }        // wp_capabilities → admin
wp_update_post( $_POST );                                                           // post_author, post_status, ID of other posts
wp_update_user( array_merge( [ 'ID' => $uid ], $_POST ) );                          // role, user_email, user_pass
```

Use explicit allow-lists of option/meta keys and fields. See `authorization.md` → privilege escalation sinks.

## Settings API

`register_setting( $group, $option, [ 'sanitize_callback' => …, 'type' => …, 'show_in_rest' => … ] )`:
- Missing `sanitize_callback` on options that are later echoed or used in SQL/paths/URLs → stored-XSS or injection risk (impact depends on who can save: the `options.php` capability, default `manage_options`).
- `show_in_rest => true` exposes the option to `/wp/v2/settings` (readable and writable by users with `manage_options`). Don't do this for secrets.

## Verification

- PHPCS: `WordPress.Security.ValidatedSanitizedInput` (input sanitized/unslashed), `WordPress.PHP.DiscouragedPHPFunctions` (`serialize`/`unserialize`), `WordPress.PHP.DontExtract`.
- Tests: send arrays where strings are expected, `../` in view/template parameters, serialized objects in cookies or fields (e.g. `O:8:"stdClass":0:{}`). Assert they're rejected or treated as plain data.

References: Plugin Handbook → Sanitizing Data, Validating Data; Common APIs → Data Validation; CWE-20, CWE-502, CWE-98, CWE-94, CWE-915.
