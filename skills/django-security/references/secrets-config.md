# Django — Secrets, Settings and Deployment Configuration

## Contents
- Defaults that matter
- DEBUG
- SECRET_KEY and SECRET_KEY_FALLBACKS
- ALLOWED_HOSTS and the Host header
- HTTPS, proxies and HSTS
- Cookies
- Security headers and CSP
- CORS
- Logging and error reporting
- `manage.py check --deploy`
- Secrets in the repository
- Severity, false positives, verification

## Defaults that matter

Verify against the installed version's settings reference. Values below are for Django 5.2 to 6.1.

| Setting | Default | Note |
|---|---|---|
| `DEBUG` | `False` | `startproject` templates write `DEBUG = True`, so a hard-coded `True` is the usual bug |
| `ALLOWED_HOSTS` | `[]` | With `DEBUG=True` and an empty list, only `.localhost`, `127.0.0.1`, `[::1]` are accepted |
| `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` | `False` | Must be set for HTTPS sites |
| `SESSION_COOKIE_HTTPONLY` | `True` | `False` is a finding |
| `SESSION_COOKIE_SAMESITE`, `CSRF_COOKIE_SAMESITE` | `'Lax'` | |
| `CSRF_COOKIE_HTTPONLY` | `False` | Docs say it gives little practical benefit; do not report it |
| `SECURE_SSL_REDIRECT` | `False` | Fine if the proxy or load balancer redirects |
| `SECURE_HSTS_SECONDS` | `0` | HSTS off by default |
| `SECURE_CONTENT_TYPE_NOSNIFF` | `True` | Needs `SecurityMiddleware` |
| `SECURE_REFERRER_POLICY` | `'same-origin'` | Needs `SecurityMiddleware` |
| `SECURE_CROSS_ORIGIN_OPENER_POLICY` | `'same-origin'` | Needs `SecurityMiddleware` |
| `X_FRAME_OPTIONS` | `'DENY'` | Needs `XFrameOptionsMiddleware` in `MIDDLEWARE` |
| `AUTH_PASSWORD_VALIDATORS` | `[]` | `startproject` adds four; removing them means no password rules |
| `SECURE_CSP` (6.0+) | `{}` | No CSP unless `ContentSecurityPolicyMiddleware` and a policy are configured |

The `SECURE_*` header settings do nothing if `django.middleware.security.SecurityMiddleware` is missing from `MIDDLEWARE` (`security.W001`).

## DEBUG

`DEBUG = True` in a deployed app shows tracebacks with source excerpts, local variables, request data and settings. Django hides settings whose names contain `API`, `AUTH` (5.2+), `KEY`, `PASS`, `SECRET`, `SIGNATURE`, `TOKEN` or `HTTP_COOKIE`, but not connection strings under other names, file paths or `ALLOWED_HOSTS`.

Investigate: `DEBUG = True` literal in a settings module that production imports, `DEBUG = os.environ.get("DEBUG", True)` (note that any non-empty string such as `"False"` is truthy), `bool(os.getenv("DEBUG"))`, `django-debug-toolbar` in `INSTALLED_APPS` outside a `DEBUG` guard, `INTERNAL_IPS` containing wide ranges.

Fix: parse explicitly (`os.environ.get("DJANGO_DEBUG", "") == "1"` or `django-environ`'s `env.bool`) and default to `False`.

Severity: **High** (Critical if the page also exposes credentials or the app is internet-facing with sensitive data) when production reachability is shown; **Likely** when only the settings file is available. Debug flag in `settings_dev.py`/`settings_test.py` that production does not import is not a finding.

## SECRET_KEY and SECRET_KEY_FALLBACKS

The key signs sessions (for every backend except `cache`, plus `get_session_auth_hash()`), cookie-based messages, `PasswordResetView` tokens and everything using `django.core.signing`. Django's docs state that a known key "can lead to privilege escalation and remote code execution vulnerabilities".

Investigate:
- A literal `SECRET_KEY = "..."` in a committed settings file, a default in `os.environ.get("SECRET_KEY", "literal")`, or the `django-insecure-` prefix that `startproject` generates (`security.W009` also fires for keys under 50 characters or fewer than 5 unique characters).
- The same key across environments, or a key in public Docker images or CI logs.
- `SECRET_KEY_FALLBACKS`: old keys must be removed once rotation completes (`security.W025` checks fallback strength). A leaked fallback is as bad as a leaked key.
- Chains: known key + `SESSION_ENGINE = "...signed_cookies"` lets an attacker forge any user's session (see `sessions.md`). Known key + a custom pickle-based serializer, cache or signer payload is code execution (see `injection.md`).

Fix: load from the environment or a secrets manager (`os.environ["SECRET_KEY"]` fails loudly), rotate by moving the old value to `SECRET_KEY_FALLBACKS`, then delete it.

Severity: committed production key **High** (Critical when combined with signed-cookie sessions, pickle, or an admin that trusts a forgeable session). Obviously placeholder keys in `.env.example` or test settings: not a finding.

## ALLOWED_HOSTS and the Host header

Django uses the `Host` header to build absolute URLs (password reset emails, `build_absolute_uri`, redirects). `ALLOWED_HOSTS` is enforced inside `request.get_host()`, so code reading `request.META["HTTP_HOST"]` directly bypasses it.

- `ALLOWED_HOSTS = ["*"]` means the application must validate hosts itself. Report as **Medium** when password-reset or other emailed links are built from the request host (reset-link poisoning), **Low** otherwise.
- A leading dot (`".example.com"`) matches the apex and all subdomains. Check that subdomains are trusted.
- `USE_X_FORWARDED_HOST = True` makes `X-Forwarded-Host` take priority. Only safe if the proxy overwrites it.
- Empty `ALLOWED_HOSTS` with `DEBUG=False` makes the site return 400, so production configs usually have it set (`security.W020`).

## HTTPS, proxies and HSTS

- `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")` tells Django to trust that header. Django's docs require that the proxy strips the header from client requests and sets it only for requests that arrived over HTTPS. If the app is also reachable directly (published container port, second listener on plain HTTP), a client can send the header and make `request.is_secure()` true. That weakens the CSRF Referer check and `Secure` cookie handling. Report as **Likely** with the exposure condition named.
- Setting it when no proxy terminates TLS, or when the proxy forwards the client's own header, is the same issue.
- `SECURE_SSL_REDIRECT = True` behind a proxy without `SECURE_PROXY_SSL_HEADER` causes redirect loops, which tempts teams to switch the redirect off instead. Look for that.
- HSTS: `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD`. Missing HSTS is **Hardening**. Do not recommend `INCLUDE_SUBDOMAINS` or preload without checking that every subdomain serves HTTPS, because the docs warn that mistakes are irreversible for the HSTS period. The same header can be set at the proxy.

## Cookies

Report `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` unset on an HTTPS-only site as **Medium/Low** (Hardening when HSTS plus redirect are in place). `SESSION_COOKIE_HTTPONLY = False`, `SESSION_COOKIE_SAMESITE = "None"` and a broad `SESSION_COOKIE_DOMAIN` (shared with untrusted subdomains) are findings. See `sessions.md` and `csrf.md`.

## Security headers and CSP

- `X-Frame-Options`: needs `XFrameOptionsMiddleware`. Per-view `@xframe_options_exempt` or `@xframe_options_sameorigin` on pages with sensitive actions deserves a look.
- Django 6.0 added built-in CSP: `django.middleware.csp.ContentSecurityPolicyMiddleware`, `SECURE_CSP`, `SECURE_CSP_REPORT_ONLY`, `django.utils.csp.CSP` constants and a `csp()` context processor for nonces. With 5.2 use `django-csp`. A missing CSP is **Hardening**. `CSP.UNSAFE_INLINE` in `script-src` removes most XSS benefit.
- With nonces (`CSP.NONCE`) the `csp` context processor must be enabled (`security.W027` in 6.1).

## CORS

Django has no built-in CORS. The common package is `django-cors-headers` (`CORS_ALLOWED_ORIGINS`, `CORS_ALLOWED_ORIGIN_REGEXES`, `CORS_ALLOW_ALL_ORIGINS`, `CORS_ALLOW_CREDENTIALS`). With `CORS_ALLOW_ALL_ORIGINS = True` and `CORS_ALLOW_CREDENTIALS = True`, the middleware reflects the request `Origin` instead of `*`, so any site can make credentialed reads. Impact depends on whether the API authenticates with cookies (High) or with bearer tokens that browsers do not attach automatically (Low). Loose origin regexes (`r"^https://.*example\.com$"` matches `evilexample.com`) are a common mistake.

## Logging and error reporting

- Use `@sensitive_variables(...)` and `@sensitive_post_parameters(...)` (from `django.views.decorators.debug`) on views that handle credentials, card data or tokens, so tracebacks and `AdminEmailHandler` emails redact them.
- Findings: `logger.info(..., request.POST)`, logging passwords, tokens, session keys or full `request.headers`; logging at DEBUG to a shared sink in production; `ADMINS` emails with unredacted data. Rate **Medium** when credentials or tokens are written to logs, **Low** for lesser PII.
- CVE-2025-48432 (June 2025) was log injection through an unescaped request path in Django's own logging, so stay on current patch releases. Custom logging of user strings should pass them as `%s` arguments and strip or escape newlines.

## `manage.py check --deploy`

```bash
python manage.py check --deploy --settings=myproject.settings.production
python manage.py check --deploy --fail-level WARNING --settings=...   # use in CI
```

It audits `SecurityMiddleware`, HSTS, SSL redirect, secure cookies, `DEBUG`, `ALLOWED_HOSTS`, `SECRET_KEY` strength and a few more. It does not audit code, `SECURE_PROXY_SSL_HEADER` correctness, permissions or CORS. Silenced checks (`SILENCED_SYSTEM_CHECKS`) should have a reason, for example `security.W008` when the load balancer redirects.

## Secrets in the repository

`.env`, `local_settings.py`, `settings/*.py` with passwords, database URLs with credentials, email/API/Stripe/AWS keys, `db.sqlite3` with real data, `*.pem`, `docker-compose.yml` with real passwords. Check `git log -p -- settings.py` for removed keys: the history still leaks them. Recommend rotation of any live secret. Never print the value; show `SECRET_KEY = "****"`.

## Severity, false positives, verification

False positives: placeholder values in `.env.example`/docs/tests, `DEBUG = True` guarded by an environment switch that defaults to `False`, `ALLOWED_HOSTS = ["*"]` in a container whose ingress validates the host (name it as the condition), `CSRF_COOKIE_HTTPONLY` unset.

Verify:

```bash
python manage.py check --deploy --settings=...
python manage.py shell -c "from django.conf import settings as s; print(s.DEBUG, s.ALLOWED_HOSTS, s.SESSION_COOKIE_SECURE)"
curl -sI -H 'Host: attacker.invalid' https://staging.example.com/   # expect 400, not 200
curl -sI https://staging.example.com/ | grep -i 'strict-transport\|x-frame\|content-security'
```

References: https://docs.djangoproject.com/en/stable/howto/deployment/checklist/, https://docs.djangoproject.com/en/stable/ref/settings/, https://docs.djangoproject.com/en/stable/ref/checks/#security, https://docs.djangoproject.com/en/stable/topics/security/; OWASP Top 10:2025 A02 Security Misconfiguration; CWE-489, CWE-798, CWE-16.
