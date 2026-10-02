# Django — Sessions

## Contents
- How sessions work
- Backends and what to look for
- Cookie settings
- Fixation, logout and invalidation
- Serializers and pickle history
- Subdomain and cache pitfalls
- Severity, false positives, verification

## How sessions work

`SessionMiddleware` reads the session cookie (`sessionid`), loads data from the configured `SESSION_ENGINE`, and writes the cookie back when the session changes. Authentication stores the user id, backend path and a session hash in the session; `SessionAuthentication` in DRF and the admin both rely on it. Defaults: engine `django.contrib.sessions.backends.db`, `SESSION_COOKIE_AGE` 1,209,600 s (2 weeks), `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE='Lax'`, `SESSION_COOKIE_SECURE=False`, `SESSION_SERIALIZER` = `JSONSerializer`.

## Backends and what to look for

| Engine | Notes |
|---|---|
| `db` (default), `cached_db` | Server-side records; logout deletes the row. Run `clearsessions` regularly. |
| `cache` | Data lives in the cache. An unauthenticated or shared Redis/Memcached with write access is a session-forgery and (for pickle-based cache values) code-execution risk. Cache `LOCATION` inside `MEDIA_ROOT`/`STATIC_ROOT` can expose cache files (Django docs warn about pickle). |
| `file` | Check `SESSION_FILE_PATH` permissions. |
| `signed_cookies` | Data is **signed but not encrypted**, readable by the client; there is no server-side record, so **logout does not invalidate a stolen cookie** and there is no freshness check (replay). Everything depends on `SECRET_KEY`. |

`signed_cookies` plus a committed or leaked `SECRET_KEY` (or any key in `SECRET_KEY_FALLBACKS`) lets an attacker forge a session for any user id, including superusers: **High to Critical**. With `JSONSerializer` this is account takeover, not code execution. Report `signed_cookies` itself as **Hardening/Low** when the key is properly secret and sessions hold no sensitive data; **Medium** when sessions authenticate privileged users and immediate revocation matters.

Also flag: secrets, PII or authorization decisions stored in the session under `signed_cookies`; the `messages` framework with `CookieStorage`/`FallbackStorage` (signed with `SECRET_KEY` as well).

## Cookie settings

- `SESSION_COOKIE_SECURE = False` on an HTTPS site: **Medium/Low** (Hardening when HSTS and redirect exist). `security.W012` flags it under `check --deploy`.
- `SESSION_COOKIE_HTTPONLY = False`: **Medium** (turns XSS into session theft). Code that reads the session cookie from JavaScript is a design smell.
- `SESSION_COOKIE_SAMESITE = "None"` requires a reason (embedded cross-site use). `Lax` default is fine.
- `SESSION_COOKIE_DOMAIN = ".example.com"` shares the cookie with every subdomain: **Medium** if any subdomain hosts untrusted content or is takeover-prone.
- Long lifetimes: 2 weeks default. For high-risk apps use `SESSION_COOKIE_AGE`, `SESSION_EXPIRE_AT_BROWSER_CLOSE`, and re-authentication for sensitive actions. Hardening unless the domain demands more.
- `SESSION_SAVE_EVERY_REQUEST = True` combined with `cache_page`/`UpdateCacheMiddleware` on unpatched Django allowed session fixation through a cached public page (CVE-2026-35192, fixed May 2026 in 6.0.5 and 5.2.14). Check the patch level and do not cache pages that set cookies.

## Fixation, logout and invalidation

- `django.contrib.auth.login()` calls `request.session.cycle_key()`: session id changes on login. Missing explicit rotation after `authenticate()` + `login()` is **not** a finding. It is a finding only for custom auth that writes identity into the session manually (`request.session["user_id"] = user.pk`) without `cycle_key()`.
- `django.contrib.auth.logout()` flushes the session (deletes data and cookie server-side for server-side backends). Custom logout that only deletes the cookie, or removes one key, leaves the session valid. Flag it.
- A password change should invalidate other sessions. The session hash is derived from the password hash, so `set_password()` logs other sessions out; the changing user stays logged in only if the view calls `update_session_auth_hash` (as `PasswordChangeView` does). A custom `get_session_auth_hash()` override that returns a constant removes this protection.
- Deactivating a user (`is_active=False`) ends access with server-side sessions because `get_user()` rejects inactive users; confirm with custom backends.
- Server-side revocation ("log out everywhere") is only possible with `db`, `cached_db`, `cache` or `file` backends.

## Serializers and pickle history

`SESSION_SERIALIZER` defaults to `JSONSerializer`. `django.contrib.sessions.serializers.PickleSerializer` was deprecated in Django 4.1 and **removed in 5.0**, so on 5.x/6.x only a custom pickle-based serializer can reintroduce it. On an unsupported 4.2 app, `SESSION_SERIALIZER = "django.contrib.sessions.serializers.PickleSerializer"` plus a known `SECRET_KEY` and the cookie backend (or any writable session store) is remote code execution. The docs' own example: a leaked key "immediately escalates to a remote code execution vulnerability". Rate **Critical** if a key leak or write path to the store is demonstrated, **High** if only the configuration is present (state the condition).

## Subdomain and cache pitfalls

- Subdomains can set cookies for the parent domain, which enables session fixation if any subdomain is untrusted (Django docs, Session security). The same limitation applies to CSRF cookies (`csrf.md`).
- Do not serve authenticated pages from shared caches: check `cache_page`, `UpdateCacheMiddleware`/`FetchFromCacheMiddleware`, CDN rules and `Vary: Cookie`. Several Django cache-header leaks were patched in 2026 (see `authorization.md` → Multi-tenancy).
- Session ids in URLs, logs or `Referer` are findings; Django never puts them in URLs by default.

## Severity, false positives, verification

False positives: no explicit `cycle_key()`; session cookie lacking `Secure` in a local settings file; `CSRF_COOKIE_HTTPONLY=False`; DB sessions growing without `clearsessions` (operational).

Verify:

```python
def test_login_rotates_session(client, django_user_model):
    django_user_model.objects.create_user("a", password="pw-a-123456")
    s = client.session; s["probe"] = 1; s.save()      # pre-login session cookie
    before = client.cookies["sessionid"].value
    client.post("/accounts/login/", {"username": "a", "password": "pw-a-123456"})
    assert client.cookies["sessionid"].value != before

def test_production_cookie_flags(settings):
    # run with the production settings module
    assert settings.SESSION_COOKIE_SECURE and settings.SESSION_COOKIE_HTTPONLY
    assert settings.SESSION_COOKIE_SAMESITE in ("Lax", "Strict")
```

```bash
python manage.py check --deploy | grep -i 'session\|cookie'
curl -sI https://staging.example.com/accounts/login/ | grep -i set-cookie
```

References: OWASP Session Management cheat sheet; CWE-384, CWE-613, CWE-1004, CWE-502; https://docs.djangoproject.com/en/stable/topics/http/sessions/, https://docs.djangoproject.com/en/stable/releases/5.0/ (PickleSerializer removal).
