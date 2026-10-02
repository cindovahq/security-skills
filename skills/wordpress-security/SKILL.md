---
name: wordpress-security
description: Security review and secure-coding guidance for WordPress plugins, themes, sites and WooCommerce stores (WordPress 6.x–7.x, WooCommerce 8.x–11.x). Use when auditing, reviewing or hardening WordPress PHP code, or when writing or changing plugin/theme code that handles requests, such as admin-ajax actions, admin-post handlers, REST routes, shortcodes, blocks, settings pages, the Abilities API, $wpdb queries, file uploads, user/role management, or WooCommerce orders, carts, checkout and payment gateways. Triggers on wp-config.php, wp-content/, plugin or theme file headers, or WooCommerce code. Covers capability checks and broken access control, nonces/CSRF, SQL injection ($wpdb->prepare), XSS and escaping, sanitization, PHP object injection, file inclusion and uploads, SSRF and redirects, REST/AJAX exposure, wp-config and secrets, WooCommerce order and price integrity, vulnerable plugins, and fix verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "WordPress 6.0–7.1, WooCommerce 8.x–11.x"
  last-verified: "2026-10-02"
---

# WordPress Security

Find, explain, fix and verify security issues in WordPress plugins, themes, sites and WooCommerce stores, and write WordPress code that doesn't introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: audit, security review, plugin vetting, "is this secure?". Follow the workflow below.
- **Build mode**: writing or modifying plugin/theme code. Apply the [build-mode guardrails](#build-mode-guardrails) to every handler you write.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the WordPress-specific knowledge.

## The WordPress security model in one paragraph

Almost every WordPress vulnerability is one of four mistakes in a request handler: **a missing capability check** (`current_user_can`), **a missing nonce check** (CSRF), **unescaped output** (XSS), or **unprepared SQL**. Handlers are reachable in more ways than developers expect. `wp_ajax_nopriv_*`, `admin_post_nopriv_*`, `admin_init`, `init`, REST routes, shortcodes and blocks all run for **unauthenticated** or **low-privilege** users unless the code checks. A nonce proves intent, not permission. `is_admin()` checks the screen, not the user.

## Review workflow

### 1. Scope and versions

- What is being reviewed: a single plugin/theme (most common), a full site (`wp-config.php`, `wp-content/`), or a WooCommerce extension.
- WordPress version: `wp-includes/version.php` (`$wp_version`), or the plugin's `Requires at least:` header for plugin-only reviews. Only the latest major (7.1 as of 2026-10) is actively supported. Older branches back to 4.7 get security backports on a best-effort basis.
- Plugin/theme version: main file header (`Version:`), `readme.txt` (`Stable tag:`).
- WooCommerce: `woocommerce/woocommerce.php` header, or `WC_VERSION`. Note HPOS (custom order tables) usage.
- Check `composer.json` / `composer.lock` if present (Bedrock, modern plugins).

### 2. Map entry points

Search the code for every way a request reaches plugin code. This is the most important step.

```text
add_action( 'wp_ajax_…'            → logged-in users of ANY role (including subscribers)
add_action( 'wp_ajax_nopriv_…'     → unauthenticated visitors
add_action( 'admin_post_…' / 'admin_post_nopriv_…'
add_action( 'admin_init'           → also runs for unauthenticated admin-ajax.php / admin-post.php requests
add_action( 'init' / 'wp_loaded' / 'template_redirect' / 'parse_request' reading $_GET/$_POST/$_REQUEST
register_rest_route(               → check permission_callback
add_shortcode( / register_block_type( render_callback   → run with content authors' input (contributor+)
wp_register_ability(               → Abilities API (6.9+), exposed to AI agents via MCP
add_menu_page( / add_submenu_page( → capability argument + the handler that saves settings
register_setting( / options.php     → sanitize_callback
add_filter( 'xmlrpc_methods'        → custom XML-RPC methods
Direct file access: PHP files without `defined( 'ABSPATH' ) || exit;`
Woo: woocommerce_api_* (wc-api callbacks), Store API extensions, checkout/cart hooks
```

For each, record: who can reach it, what input it reads, what it changes or returns.

### 3. Review each area

| Area | Reference | Start by looking for |
|---|---|---|
| Authorization & capabilities | `references/authorization.md` | Handlers without `current_user_can`, `is_admin()` used as auth, `__return_true` permission callbacks, `update_option`/`update_user_meta` from input |
| Nonces & CSRF | `references/nonces-csrf.md` | State changes without `check_admin_referer`/`check_ajax_referer`/`wp_verify_nonce`, ignored return values |
| SQL injection | `references/sql-injection.md` | `$wpdb->query/get_results/get_var/get_row/get_col` with interpolated variables, `esc_sql` misuse, `ORDER BY` from input |
| XSS & escaping | `references/xss-escaping.md` | `echo $…` without `esc_*`, `_e()`/`__()` with HTML, shortcode attributes, `wp_kses` configs, admin notices |
| Input handling & object injection | `references/input-validation.md` | `$_GET/$_POST/$_REQUEST/$_COOKIE/$_SERVER` without `wp_unslash` + sanitize/validate, `unserialize`/`maybe_unserialize` on input, `extract()`, LFI |
| File uploads & file operations | `references/file-uploads.md` | `move_uploaded_file`, `wp_handle_upload` with `test_type => false`, `upload_mimes` additions, `unzip_file`, paths from input |
| REST, AJAX & API exposure | `references/rest-ajax-api.md` | REST routes, `show_in_rest` meta/CPTs, Abilities API, XML-RPC, user enumeration, application passwords |
| SSRF & redirects | `references/ssrf-redirects.md` | `wp_remote_get($input)`, `file_get_contents($url)`, `wp_redirect($input)` |
| Authentication & accounts | `references/authentication.md` | Custom login/registration/reset, `wp_set_auth_cookie`, `default_role`, password storage, brute force |
| Configuration & secrets | `references/secrets-config.md` | `wp-config.php`, debug settings, `debug.log`, salts, API keys in code/options, file editing, uploads PHP execution |
| WooCommerce | `references/woocommerce.md` | Order IDOR, price/coupon tampering, payment callbacks, Store API extensions, PII exports |
| Dependencies | `references/dependencies.md` | Core/plugin/theme versions, known advisories, abandoned or nulled plugins |
| Verification | `references/verification.md` | WP-CLI, PHPCS security sniffs, Plugin Check, tests, safe requests |

### 4. Classify, report, fix, verify

Trace every finding from entry point → missing/broken check → sensitive operation, with file:line. Classify using the rules below. When fixing, use WordPress APIs (capabilities, nonces, `$wpdb->prepare`, `esc_*`, `sanitize_*`) and add a test or reproducible request per `references/verification.md`.

## High-signal patterns

**Investigation signals, not findings.** Trace each one.

```text
# Access control
wp_ajax_nopriv_   admin_post_nopriv_   add_action( 'admin_init'   is_admin() &&   is_user_logged_in()   (as the only check)
'permission_callback' => '__return_true'   register_rest_route( (no permission_callback)
update_option( $_POST / $request    update_user_meta( … $_POST    wp_update_user( $_POST    wp_insert_user(   set_role(   add_cap(
wp_set_auth_cookie(   wp_set_current_user(   get_user_by( 'email', $_…

# CSRF
wp_verify_nonce( without if/!   check_ajax_referer( …, false )   nonce created but never verified   handlers on GET that change state

# SQL
$wpdb->query( "…$   $wpdb->get_results( "…{$   ->prepare( "…$var…"   esc_sql( (unquoted)   ORDER BY $   LIMIT $   IN ( $
like_escape(   $wpdb->prepare( $sql ) (no args)

# XSS
echo $_   echo $atts[   print $   _e( / __( with variables   printf( without esc_   esc_attr( inside href   wp_kses( $x, 'post' ) on untrusted   html_entity_decode(
add_shortcode(   render_callback   admin_notices

# Injection / RCE
unserialize(   maybe_unserialize( $_   extract(   include( $_   require( … $   call_user_func( $_   do_action( $_   apply_filters( $_
eval(   create_function(   assert(   shell_exec(   exec(   system(   passthru(   proc_open(   popen(   preg_replace( …/e

# Files
move_uploaded_file(   'test_form' => false   'test_type' => false   upload_mimes   unfiltered_upload   unzip_file(   file_put_contents(
copy( $_   unlink( $_   readfile( $_   file_get_contents( $_   fopen( $_   wp_delete_file( $_

# SSRF / redirect
wp_remote_get( $   wp_remote_post( $   download_url( $   file_get_contents( 'http   wp_redirect( $_   header( 'Location: ' . $

# Config
define( 'WP_DEBUG', true )   WP_DEBUG_DISPLAY   WP_DEBUG_LOG   DISALLOW_FILE_EDIT   put your unique phrase here   ALLOW_UNFILTERED_UPLOADS
```

## Common false positives

- **`wp_ajax_*` without `current_user_can`** when the action only reads or writes the **current user's own** data (scoped by `get_current_user_id()`). That's still worth a nonce check, but it isn't privilege escalation.
- **`$wpdb->query()` with only constants, `$wpdb->prefix`/table properties, or values passed through `absint()`/`(int)`** before interpolation.
- **`$wpdb->prepare()` with `%s`/`%d`/`%i` placeholders and arguments**: safe for those values. `%i` (6.2+) safely quotes identifiers.
- **Output passed through `esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`, `wp_kses`** at the point of echo. Also core template tags that escape internally (`the_title()` runs filters; `the_content()` is designed to output HTML). Don't flag core-filtered post content as XSS: authors with `unfiltered_html` (admins/editors on single site) are allowed to post HTML.
- **Missing nonce on read-only `GET` handlers** with no side effects.
- **`is_admin()` used to decide *where* to load code**, not *whether a user may act*.
- **`maybe_unserialize()` on data read from the database that only admins can write.** A finding only if lower-privilege or external input reaches it.
- **REST routes with `__return_true`** that are intentionally public and read-only (public post data, health checks).
- **Placeholder salts** (`put your unique phrase here`) in `wp-config.php`: WordPress ignores them and uses random salts stored in the database. Hardening, not Critical. Real, publicly known salt values are the critical case.
- **User enumeration** (`/wp-json/wp/v2/users`, `?author=1`) is Informational/Hardening by WordPress's own security policy, not a vulnerability.
- **Admins doing admin things** (installing plugins, editing code via the file editor, adding unfiltered HTML). WordPress treats administrators as fully trusted on single-site installs. Report only when a **lower** role or an unauthenticated user can reach the capability.

## Severity calibration

| Who can trigger it | Typical severity for impactful issues |
|---|---|
| Unauthenticated (`nopriv`, public REST, front-end `init`) | Critical/High |
| Subscriber / customer (anyone who can register; check `users_can_register`) | High |
| Contributor / author | Medium (High for stored XSS that executes for admins) |
| Editor / shop manager | Low/Medium |
| Administrator (single site) | Usually not a vulnerability |

Privilege escalation to administrator, arbitrary option update, arbitrary file upload/read/delete, SQL injection and PHP object injection reachable by unauthenticated users or subscribers are **Critical**.

## Build-mode guardrails

For every request handler you write:

1. **Capability:** `if ( ! current_user_can( 'manage_options' ) ) { wp_die( … , 403 ); }` (or the narrowest fitting capability). Use meta capabilities for objects: `current_user_can( 'edit_post', $post_id )`.
2. **Nonce:** create with `wp_nonce_field( 'myplugin_save_' . $id )` / `wp_create_nonce()`, verify with `check_admin_referer()` / `check_ajax_referer()` (both die on failure by default). REST routes rely on cookie auth plus the `X-WP-Nonce` (`wp_rest`) nonce automatically. Don't disable that.
3. **Input:** `wp_unslash()` then sanitize by type: `absint`, `sanitize_text_field`, `sanitize_email`, `sanitize_key`, `sanitize_file_name`, `esc_url_raw`. Validate against allow-lists for enums.
4. **SQL:** always `$wpdb->prepare()` with placeholders (`%d`, `%f`, `%s`, `%i` for identifiers on 6.2+). Use `$wpdb->esc_like()` for LIKE. Prefer `WP_Query`, `get_posts`, `$wpdb->insert/update/delete` with format arrays.
5. **Output:** escape late, at the point of output, for the context: `esc_html`, `esc_attr`, `esc_url`, `esc_textarea`, `wp_kses_post`/`wp_kses`, `wp_json_encode` for JS. Use `esc_html__()` / `esc_html_e()` for translated strings.
6. **REST:** always provide a real `permission_callback`. Declare `args` with `type`, `sanitize_callback` and `validate_callback`.
7. **AJAX:** register `wp_ajax_nopriv_*` only for genuinely public actions, and never for state changes without a proof of authorization.
8. **Files:** use `wp_handle_upload()` with type checking, never trust client names or types, and never `include` paths built from input.
9. **Never** `unserialize()` user input (use JSON), `extract()` request data, `eval`, or dynamic function names from input.
10. **Remote requests:** `wp_safe_remote_get()` for user-supplied URLs. Redirects: `wp_safe_redirect()`.
11. **Secrets:** constants in `wp-config.php` or environment variables, not hardcoded or autoloaded options readable via REST.
12. **Direct access guard** at the top of every PHP file: `defined( 'ABSPATH' ) || exit;`

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

- **Confidence:** Confirmed (entry point → sink fully traced), Likely (one runtime condition unverified: name it, e.g. "requires `users_can_register` enabled"), Hardening, Informational.
- **Severity:** impact × required role (table above) × exposure.
- **Finding format:** Title (impact in plain words), severity and confidence, location (file:line, hook/function), entry point and required role, evidence (code), impact, preconditions, fix (WordPress API), verification (request/test), references (CWE, WordPress developer docs).
- **Rules:** never invent hooks, files or plugin behavior. Redact secrets (`AUTH_KEY` → `****`). Say when runtime verification wasn't performed. Only test sites you are authorized to assess, with non-destructive requests.

## References

- WordPress Plugin Handbook, Security: https://developer.wordpress.org/plugins/security/
- Common APIs, Security: https://developer.wordpress.org/apis/security/
- REST API Handbook, Adding endpoints: https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/
- WordPress Coding Standards (PHPCS security sniffs): https://github.com/WordPress/WordPress-Coding-Standards
- WordPress security releases: https://wordpress.org/news/category/security/
- WooCommerce developer docs: https://developer.woocommerce.com/docs/
