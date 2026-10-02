# WordPress — Configuration and Secrets

## Contents
- wp-config.php review
- Debug output and logs
- Secrets in plugins and options
- File editing and installation
- Exposed files and server configuration
- HTTPS, headers and cookies
- Logging and monitoring
- Verification

## wp-config.php review

Redact all values in reports.

| Setting | Expected (production) | Finding if not |
|---|---|---|
| `AUTH_KEY`, `SECURE_AUTH_KEY`, `LOGGED_IN_KEY`, `NONCE_KEY` + `*_SALT` | Unique random values (from `https://api.wordpress.org/secret-key/1.1/salt/` or `wp config shuffle-salts`) | **Publicly known values** (copied from a tutorial, a public repo, or shared across sites) → forgeable auth cookies and nonces: **Critical**. Note: `wp_salt()` treats the `put your unique phrase here` placeholder, empty values, and values duplicated between constants as missing, and falls back to random salts stored in the database (`*_key`/`*_salt` site options). Placeholders are therefore **Low/Hardening** (secrets live in the DB and change if it's restored or leaked), not Critical |
| `DB_PASSWORD` etc. | From environment or a file outside the web root; not committed | Committed to a public repo: **Critical** (rotate) |
| `WP_DEBUG` | `false` | `true` in production → notices may leak paths/data |
| `WP_DEBUG_DISPLAY` | `false` (and `display_errors` off) | Errors shown to visitors: **Medium** |
| `WP_DEBUG_LOG` | `false`, or a path **outside** the web root | `true` writes `wp-content/debug.log`, which is **publicly downloadable** unless blocked; often contains paths, queries and personal data: **Medium/High** |
| `DISALLOW_FILE_EDIT` | `true` | Theme/plugin editor available, so any admin-session compromise (e.g. via stored XSS) becomes immediate RCE. Hardening, raised when XSS findings exist |
| `DISALLOW_FILE_MODS` | `true` where deployments are code-managed | Hardening |
| `FORCE_SSL_ADMIN` | `true` | Hardening (when the site is HTTPS) |
| `ALLOW_UNFILTERED_UPLOADS` | not defined | Defined: admins can upload any file type, including PHP |
| `DISALLOW_UNFILTERED_HTML` | `true` on sites where editors aren't fully trusted | Hardening |
| `WP_ENVIRONMENT_TYPE` | `production` | `development`/`local` may enable debug behavior in plugins |
| `$table_prefix` | Any | Changing it from `wp_` is not a security control. Don't report it. |
| `WP_AUTO_UPDATE_CORE` / auto-updates | Minor (security) updates enabled at least | Disabled with no update process: Medium |

`wp-config.php` should sit outside the web root or be denied by the web server, with restrictive file permissions. WordPress supports placing it one directory above the install.

## Debug output and logs

- `debug.log` in `wp-content/` (default `WP_DEBUG_LOG` location). Check `https://site/wp-content/debug.log`.
- Plugin logs written to `wp-content/uploads/<plugin>/*.log` or plugin directories: often contain API requests with keys, emails, payment payloads. Must be outside the web root or blocked.
- `phpinfo()` pages, `info.php`, and debug endpoints shipped in plugins (`?myplugin_debug=1`) without capability checks.
- Query Monitor / Debug Bar active in production: restricted to admins by default. Check their authentication cookie settings if configured for non-admins.

## Secrets in plugins and options

- API keys, license keys and payment credentials hardcoded in plugin code → if the plugin is distributed, the key is public. Rotate it and move it to settings or constants.
- Secrets stored in `wp_options`: readable by anyone with DB access, SQL injection, or a backup leak. Check they aren't exposed via REST (`show_in_rest`), AJAX handlers, front-end `wp_localize_script`, or HTML source (common: Google Maps keys are fine with referrer restrictions; Stripe **secret** keys, SMTP passwords and OpenAI/LLM provider keys are not).
- Autoloaded options containing secrets are loaded on every request. Not a vulnerability by itself.
- Secrets in `wp-config.php` constants (`define( 'MYPLUGIN_API_KEY', getenv( 'MYPLUGIN_API_KEY' ) )`) are preferred.
- Settings pages that echo saved secrets back into `value=""` attributes: mask them.

## File editing and installation

- `DISALLOW_FILE_EDIT` (above).
- Plugins that implement their own "code snippets", "custom PHP" or "custom JS/CSS" features: PHP execution must require `manage_options` **and** `unfiltered_html` (or `edit_plugins`), with nonce checks. Lower roles executing PHP = **Critical**.
- Plugins that download and install other plugins/themes from URLs: capability checks (`install_plugins`) and package source validation.

## Exposed files and server configuration

Check (on a staging site, or from server configs in the repo):
- `/.git/`, `/.env`, `/wp-config.php.bak`, `/wp-config.php~`, `/backup.zip`, `/*.sql`, `/wp-content/uploads/*backup*`
- Directory listing on `/wp-content/uploads/`, `/wp-content/plugins/*/`
- PHP execution allowed in `/wp-content/uploads/`
- `readme.html`, `license.txt` and generator meta tags reveal the version: Informational only.
- `xmlrpc.php` reachable (see `rest-ajax-api.md`).

## HTTPS, headers and cookies

- `siteurl`/`home` on `https://`, HTTP → HTTPS redirect, HSTS.
- Security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`): Hardening. Note that WordPress admin is not CSP-friendly. Recommend front-end CSP carefully.
- Behind proxies/CDNs: `$_SERVER['HTTPS']` handling in `wp-config.php` (`if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && 'https' === $_SERVER['HTTP_X_FORWARDED_PROTO'] ) $_SERVER['HTTPS'] = 'on';`) is fine **only** when the origin isn't directly reachable.
- IP-based security plugins trusting `X-Forwarded-For`: spoofable lockouts and allow-lists.

## Logging and monitoring

- Activity/audit logging (logins, user/role changes, plugin installs, settings changes) is recommended for business sites: Hardening.
- Failed-login monitoring and alerting.
- Logs must not contain passwords (watch plugins that log full `$_POST` on login or checkout).

## Verification

```bash
wp config get WP_DEBUG; wp config get WP_DEBUG_LOG; wp config get DISALLOW_FILE_EDIT
wp config shuffle-salts                     # remediation for default/leaked salts (logs everyone out)
wp option get users_can_register; wp option get default_role
curl -s -o /dev/null -w '%{http_code}\n' https://site.test/wp-content/debug.log   # expect 403/404
curl -s -o /dev/null -w '%{http_code}\n' https://site.test/.git/HEAD              # expect 403/404
curl -sI https://site.test/ | grep -iE 'strict-transport|content-security|x-content-type'
```

References: Advanced Administration Handbook → Hardening WordPress, Editing wp-config.php; Debugging in WordPress; CWE-200, CWE-215, CWE-532, CWE-798, CWE-1188.
