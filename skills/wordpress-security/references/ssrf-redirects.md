# WordPress — SSRF and Open Redirects

## Contents
- SSRF sinks
- WordPress's built-in protection
- Fix patterns
- Open redirects
- Verification

## SSRF sinks

Server-side requests to URLs influenced by users:

```php
wp_remote_get( $_POST['url'] );                       // no internal-address filtering
wp_remote_post( $webhook_url_from_settings, … );       // settings writable by lower roles?
download_url( $_GET['src'] );                         // also writes the file to a temp location
file_get_contents( $url ); fopen( $url, 'r' );        // also file://, php://, phar:// (old PHP)
curl_exec() with CURLOPT_URL from input
media_sideload_image( $url, … );                      // image import from URL
```

Common features: "import from URL", remote image/avatar fetch, link previews, webhook senders, PDF generators rendering user HTML (dompdf with remote enabled, headless Chrome), oEmbed discovery, license/update servers configurable in settings.

Impact factors: cloud metadata (`169.254.169.254`), internal admin panels, localhost services (Redis, Elasticsearch), and whether the response body is returned to the user. If the `appsec-review` skill is installed, its SSRF checklist covers the general model.

## WordPress's built-in protection

- `wp_safe_remote_get()` / `wp_safe_remote_post()` / `wp_safe_remote_request()` set `reject_unsafe_urls`, which runs `wp_http_validate_url()`. That rejects non-HTTP(S) schemes and, by default, private/loopback/link-local IP ranges (after DNS resolution), plus unusual ports. Sites can relax this with the `http_request_host_is_external` and `http_allowed_safe_ports` filters. Check for plugins that return `true` there broadly.
- Limitations: the check resolves DNS separately from the request (DNS rebinding remains possible), and redirects are followed. `wp_safe_remote_*` re-validates redirect targets via `reject_unsafe_urls` in recent versions, but confirm for the installed version before relying on it.
- `wp_remote_*` (non-safe variants) have **no** such filtering.

## Fix patterns

- Use `wp_safe_remote_get()` for any user-influenced URL. Add a host allow-list where the feature permits.
- Validate scheme and host with `wp_parse_url()` before the request. Disable redirects (`'redirection' => 0`) when not needed.
- Limit response size (`'limit_response_size'`) and timeout. Don't return raw response bodies to users unless that's the feature.
- Settings that hold URLs (webhooks, API endpoints) must be writable only by administrators.

## Open redirects

```php
wp_redirect( $_GET['redirect_to'] );                  // open redirect
header( 'Location: ' . $_REQUEST['return'] );         // open redirect (+ header issues)
```

- `wp_safe_redirect( $url )` only allows the site's host and hosts added via the `allowed_redirect_hosts` filter. Otherwise it redirects to `admin_url()` (changeable via the `wp_safe_redirect_fallback` filter).
- `wp_validate_redirect( $url, $fallback )` returns a safe URL for custom flows.
- Login flows: core's `redirect_to` is validated. Custom login/registration/logout redirects in plugins often aren't.
- Severity: Low/Medium by itself. **High** if tokens (password reset keys, magic links, OAuth codes) are appended to the redirect target.
- Always `exit;` after `wp_redirect()`/`wp_safe_redirect()`. Missing `exit` lets the rest of the handler run, which matters when the redirect was meant to stop unauthorized users (an authorization bypass, not just a redirect issue).

## Verification

- Request handlers with `http://127.0.0.1/`, `http://169.254.169.254/latest/meta-data/`, `http://[::1]/`, `file:///etc/passwd`, and a URL on a host you control that redirects to `127.0.0.1` → all rejected (`WP_Error` `http_request_failed`).
- In PHPUnit, use the `pre_http_request` filter to intercept and assert which URLs would be requested. Don't make real outbound requests.
- Redirect parameters with `https://evil.example`, `//evil.example`, `/\evil.example` → redirected to the site or fallback.

References: `wp_safe_remote_get()`, `wp_http_validate_url()`, `wp_safe_redirect()` reference; CWE-918, CWE-601, CWE-698.
