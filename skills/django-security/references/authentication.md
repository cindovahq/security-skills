# Django — Authentication

## Contents
- How Django authentication works
- Password hashing
- Password validation and policy
- Brute force and throttling
- Login, logout and redirects
- Password reset and account recovery
- MFA, SSO and remote-user auth
- Custom user models and backends
- Severity, false positives, verification

## How Django authentication works

`django.contrib.auth` provides `User`, `authenticate()`, `login()`, `logout()`, backends (`AUTHENTICATION_BACKENDS`, default `ModelBackend`) and the built-in views (`LoginView`, `LogoutView`, `PasswordResetView`, ...). `AuthenticationMiddleware` sets `request.user`. Sessions are covered in `sessions.md`, authorization in `authorization.md`, DRF token auth in `api-security.md`.

Facts that prevent false positives:
- `login()` rotates the session key (`cycle_key()`), so a missing explicit rotation is not session fixation (`sessions.md`).
- `ModelBackend` rejects inactive users (`user_can_authenticate`) and runs the password hasher even for unknown usernames, which equalizes timing. `login_required` itself does not check `is_active`; the default backends do. Custom backends and `RemoteUserBackend` setups must repeat the check.
- `LogoutView` accepts only POST (and OPTIONS) since Django 5.0, so logout CSRF is closed for the built-in view. A hand-written logout on GET is only a Low.
- `LoginView` validates `next` with `url_has_allowed_host_and_scheme`. A hand-written login view that does `redirect(request.POST["next"])` does not (`ssrf-redirects.md`).

## Password hashing

`PASSWORD_HASHERS` default order: `PBKDF2PasswordHasher`, `PBKDF2SHA1PasswordHasher`, `Argon2PasswordHasher`, `BCryptSHA256PasswordHasher`, `ScryptPasswordHasher`. The **first** entry hashes new passwords; the others verify (and upgrade on next login). Default PBKDF2 iterations rise each release:

| Django | PBKDF2 iterations |
|---|---|
| 5.1 | 870,000 |
| 5.2 | 1,000,000 |
| 6.0 | 1,200,000 |
| 6.1 | 1,500,000 |

Investigate:
- `PASSWORD_HASHERS` with `MD5PasswordHasher`, `SHA1PasswordHasher` (removed in 5.1), `UnsaltedMD5PasswordHasher`/`UnsaltedSHA1PasswordHasher` (removed in 5.1) or `PBKDF2SHA1PasswordHasher` listed **first**. Report **High** (Medium if the database is not an exposure risk). Fast hashers listed after a strong first entry only verify legacy hashes and upgrade on login; that is a Hardening point at most.
- Fast hashers in a test-only settings module (a common speed-up): not a finding.
- Passwords stored without hashing: `User.objects.create(username=..., password=raw)`, `user.password = request.data["password"]`, a `ModelSerializer`/`ModelForm` that writes the `password` field directly, `update()` queries with a raw password. Use `create_user()`, `set_password()` or `make_password()`. **Critical** if reachable: plaintext passwords in the database.
- Tuned-down parameters: custom `PBKDF2PasswordHasher` subclass with a low `iterations`, `Argon2` with tiny `time_cost`.
- Recommend Argon2 (`pip install "django[argon2]"`, put `Argon2PasswordHasher` first) as optional improvement; PBKDF2 at default iterations is acceptable.
- Django upgrades hashes only for algorithms still listed in `PASSWORD_HASHERS` and only when the user logs in.

## Password validation and policy

`AUTH_PASSWORD_VALIDATORS` defaults to `[]`: **no rules** unless configured (`UserAttributeSimilarityValidator`, `MinimumLengthValidator`, `CommonPasswordValidator`, `NumericPasswordValidator`). Validators run in `UserCreationForm`, `SetPasswordForm`, `PasswordChangeForm` and `createsuperuser`, but not in `set_password()`, `create_user()` or DRF serializers. Custom registration APIs must call `validate_password(password, user)` themselves.

Severity: no validators or `MinimumLengthValidator` below 8: **Medium/Low** (Hardening if MFA or throttling exists). Validators missing only on an API registration path: **Low/Medium**.

## Brute force and throttling

Django does **not** throttle authentication; the security overview says to deploy a plugin or web-server module for that. DRF's throttling docs say its throttles "should not be considered a security measure or protection against brute forcing" (non-atomic cache counters, spoofable client IP).

Investigate the login view, token endpoint (`obtain_auth_token` has no throttling by default), password reset, OTP verification, registration and the admin login. Evidence of a control: `django-axes` (`AxesStandaloneBackend` first in `AUTHENTICATION_BACKENDS`), `django-ratelimit` decorators, django-allauth's `ACCOUNT_RATE_LIMITS` (default `login_failed` is `10/m/ip,5/5m/key`), a WAF or proxy rule (`limit_req` in nginx), or a custom lockout.

Severity: no throttling or lockout on password login: **Medium** (High with weak password policy and no MFA, or on OTP verification where the code space is small). Throttle keyed on `X-Forwarded-For` without `NUM_PROXIES` or a trusted proxy: **Medium/Low** (spoofable).

## Login, logout and redirects

- Log `username` and outcome, never the password (`secrets-config.md` → Logging).
- Account enumeration: distinct error messages or response times for unknown user vs wrong password, "email already registered" on sign-up, reset forms that reveal existence. Django's built-in `PasswordResetView` always shows the same confirmation page. Rate **Low** unless the product treats user lists as sensitive.
- `CVE-2025-13473` (Feb 2026): timing difference in `django.contrib.auth.handlers.modwsgi.check_password()` allowed username enumeration. Low severity; affects mod_wsgi auth handler users on unpatched 4.2/5.2/6.0.
- `next` parameter: see `ssrf-redirects.md`.
- Changing the password should invalidate other sessions: `PasswordChangeView` calls `update_session_auth_hash`; custom password-change views must too (the session hash is derived from the password hash and `SECRET_KEY`).

## Password reset and account recovery

- Tokens come from `PasswordResetTokenGenerator`, are signed with `SECRET_KEY`, expire after `PASSWORD_RESET_TIMEOUT` (default 3 days), and stop working after the password or `last_login` changes. Docs note that shortening the timeout does not change brute-force resistance.
- Reset emails build links from the request host. With `ALLOWED_HOSTS = ["*"]` or `USE_X_FORWARDED_HOST` and a proxy that forwards the header, an attacker can poison the link (`secrets-config.md`). Report as **Medium** when the combination exists. The `sites` framework (`SITE_ID`) avoids request-derived hosts.
- Custom reset flows: tokens must be random (`secrets.token_urlsafe`), single-use, hashed at rest, expiring, and not returned in the HTTP response. `random.choice`/`uuid1`/timestamp-based tokens: **High**.
- Do not send passwords by email; do not use security questions.

## MFA, SSO and remote-user auth

Django has no built-in MFA, including for `/admin/`. Common packages: `django-otp`, `django-allauth` (MFA), `django-two-factor-auth`. Absence of MFA on staff/admin accounts is **Hardening** to **Medium** depending on data sensitivity.

`RemoteUserMiddleware`/`PersistentRemoteUserMiddleware` and `RemoteUserBackend` trust a header set by the web server (`REMOTE_USER` by default). They are safe only when the proxy strips that header from client requests and the app is not reachable around the proxy (**Critical** otherwise: full impersonation). Under ASGI, 6.1 changed how custom header names are looked up in `request.META` (no automatic `HTTP_` prefix, restoring pre-5.2 behavior); check that a customized `header` still matches what the proxy sends and strips.

django-allauth and social login: check automatic account linking by email when the provider email is unverified, and `ACCOUNT_EMAIL_VERIFICATION`. OAuth `state` and redirect URI checks are handled by the library; custom OAuth code must implement both.

## Custom user models and backends

- `AUTH_USER_MODEL` swapped models: ensure `is_staff`/`is_superuser`/`is_active` are not writable through public forms or serializers (`validation-mass-assignment.md`).
- Custom `authenticate()` backends must return `None` for inactive users and compare secrets with `check_password`/`hmac.compare_digest`.
- `ModelBackend` case-sensitivity: usernames are case-sensitive by default in `AbstractUser`; duplicate accounts differing in case can enable impersonation in "email as identity" flows. Normalize emails (`BaseUserManager.normalize_email` only lowercases the domain).

## Severity, false positives, verification

False positives: fast hashers in test settings; `PBKDF2SHA1PasswordHasher` present but not first; missing explicit `cycle_key()`; `login_required` "not checking `is_active`"; `CSRF_COOKIE_HTTPONLY`; absence of throttling when an upstream limiter is documented (name it as the condition); `PasswordResetView` not revealing existence (this is correct).

Verify:

```python
from django.contrib.auth.hashers import get_hasher, identify_hasher
from django.contrib.auth import get_user_model
def test_new_passwords_use_strong_hasher(db):
    u = get_user_model().objects.create_user("a", password="x" * 12)
    assert identify_hasher(u.password).algorithm in {"pbkdf2_sha256", "argon2", "scrypt", "bcrypt_sha256"}

def test_login_is_throttled(client, db):
    for _ in range(20):
        r = client.post("/accounts/login/", {"username": "a", "password": "wrong"})
    assert r.status_code in (403, 429)
```

```bash
python manage.py check --deploy
pip-audit -r requirements.txt     # hashers/packages with advisories
```

References: OWASP Authentication and Password Storage cheat sheets; ASVS 5.0 V6/V7; CWE-256, CWE-307, CWE-327, CWE-640; https://docs.djangoproject.com/en/stable/topics/auth/passwords/, https://docs.djangoproject.com/en/stable/topics/auth/default/, https://docs.djangoproject.com/en/stable/topics/security/.
