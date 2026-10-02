# WordPress — REST, AJAX and API Exposure

## Contents
- Custom REST routes
- Data exposure through core REST endpoints
- admin-ajax.php and admin-post.php
- Abilities API and MCP
- XML-RPC
- Application Passwords
- User enumeration
- Heartbeat and other surfaces
- Verification

## Custom REST routes

Review every `register_rest_route()`:

- **`permission_callback`**: present, and checks the right capability and object (see `authorization.md`). `__return_true` only for intentionally public, read-only data.
- **`args`**: declare `type`, `required`, `enum`, `sanitize_callback` and `validate_callback`. Core validates by schema when `type` is set. Missing args definitions mean raw values reach the callback.
- **Callback output**: don't return raw `WP_User`/`WP_Post` objects or full meta arrays (hashes, emails, private meta). Build explicit response arrays.
- **Methods**: `WP_REST_Server::READABLE` vs `EDITABLE`/`DELETABLE`. State changes on `GET` routes skip core's cookie-nonce protection logic for reads.
- **Batch API** (`/batch/v1`, 5.6+): routes that opt in with `allow_batch` can be called in batches. Make sure per-request permission checks hold. Core's 2026 "WP2Shell" chain started with a batch route-confusion bug (fixed in 7.0.2 / 6.9.5).

## Data exposure through core REST endpoints

- **Custom post types** registered with `show_in_rest => true` are listed at `/wp/v2/{type}`. Published posts are public. Check that private data isn't stored in published CPT content or exposed meta.
- **Post/user/term meta** registered with `register_meta( …, [ 'show_in_rest' => true ] )` or `register_post_meta()` appears in REST responses and, with `auth_callback` permitting, is writable. Look for secrets, emails, tokens, internal notes, and writable fields that affect authorization (e.g. a `_myplugin_role` meta).
- **Settings** with `show_in_rest` in `register_setting()` → `/wp/v2/settings` (admins only, but avoid secrets).
- `rest_prepare_*` filters adding fields: check they don't add private data for unauthenticated contexts (`$request['context'] === 'edit'` requires edit permissions; `view` is public).

## admin-ajax.php and admin-post.php

- Map every `wp_ajax_*`, `wp_ajax_nopriv_*`, `admin_post_*` and `admin_post_nopriv_*` hook. Each needs: a nonce check (state changes), a capability check (privileged actions), and input sanitization.
- `nopriv` handlers that return data: check they don't leak other users' data (form entries, orders, emails) by ID.
- Handlers registered for both `wp_ajax_` and `wp_ajax_nopriv_` with the same callback: the callback must handle the logged-out case explicitly.
- Responses: `wp_send_json_*`. Don't echo HTML built from input without escaping (reflected XSS via `admin-ajax.php` is possible when the response is served as `text/html`).

## Abilities API and MCP

WordPress 6.9+ abilities (`wp_register_ability`) can be exposed to AI agents through the MCP Adapter. Review:
- `permission_callback` on every ability (it's the only access control).
- Input schemas restricting values. The `execute_callback` must still validate object ownership.
- Abilities that change content, users, settings or files: require high capabilities. Consider whether they should be exposed to MCP at all.
- MCP server authentication (application passwords/OAuth) and which user context abilities run under.

## XML-RPC

- `xmlrpc.php` enables authentication with username and password per call. `system.multicall` lets one request try many passwords (brute-force amplification).
- Pingbacks can be abused for DDoS reflection and as an SSRF vector.
- Disable if unused (`add_filter( 'xmlrpc_enabled', '__return_false' )` disables authenticated methods, or block at the web server). That's Hardening, unless the site has weak passwords and no lockout.
- Custom `xmlrpc_methods` added by plugins: review like REST routes.

## Application Passwords

- Available since 5.6 (HTTPS required by default) for REST/XML-RPC authentication. Hashed with BLAKE2b since 6.8.
- They bypass interactive 2FA plugins unless those plugins handle them. Note it if the site relies on 2FA.
- Plugins that create Application Passwords programmatically or display them: check capability checks and exposure.

## User enumeration

`/wp-json/wp/v2/users` lists users who have published posts in REST-enabled post types (name, slug, avatar). `/?author=1` redirects to the author slug. WordPress treats this as not a vulnerability. Report as **Informational/Hardening** unless usernames are otherwise secret and login lacks brute-force protection. Custom endpoints exposing **emails** or **all users** to the public are real findings.

## Heartbeat and other surfaces

- `heartbeat_received` filters processing `$data` from logged-in users: same rules as AJAX.
- `wp-cron.php` is publicly callable. Expensive cron hooks can be triggered by anyone (DoS hardening). Disable with `DISABLE_WP_CRON` plus a real cron job on high-traffic sites.
- `oEmbed` / `wp-json/oembed/1.0/proxy` (authenticated): SSRF considerations (see `ssrf-redirects.md`).

## Verification

```bash
curl -s https://site.test/wp-json/ | jq '.routes | keys[]' | grep myplugin           # discover routes
curl -s -X POST https://site.test/wp-json/myplugin/v1/settings -d 'x=1'             # expect 401/403
curl -s https://site.test/wp-admin/admin-ajax.php -d 'action=myplugin_export'        # unauthenticated: expect 0/-1/403
curl -s https://site.test/wp-json/wp/v2/users | jq '.[].slug'                        # enumeration (informational)
```

`wp rest` isn't a core WP-CLI command. Use `curl`, or PHPUnit with `rest_do_request( new WP_REST_Request( 'POST', '/myplugin/v1/settings' ) )` and assert `401`/`403` for subscribers.

References: REST API Handbook → Adding Custom Endpoints, Authentication; Plugin Handbook → AJAX; `register_meta()` reference; Abilities API docs; CWE-284, CWE-200, CWE-307.
