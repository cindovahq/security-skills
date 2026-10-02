# Django — CSRF

## Contents
- How Django CSRF protection works
- What to investigate
- DRF, SPAs and APIs
- Severity, false positives, verification

## How Django CSRF protection works

`django.middleware.csrf.CsrfViewMiddleware` (in the default `MIDDLEWARE`; `security.W003` warns when missing) enforces CSRF for every request whose method is not `GET`, `HEAD`, `OPTIONS` or `TRACE` (so `POST`, `PUT`, `PATCH`, `DELETE` and unknown methods are checked), unless the view carries `csrf_exempt`. Checks:

1. If an `Origin` header is present it must match the request host or `CSRF_TRUSTED_ORIGINS`.
2. For HTTPS requests without `Origin`, the `Referer` must match the host or a trusted origin (strict referer check).
3. A CSRF cookie must be present and the `csrfmiddlewaretoken` form field or the `X-CSRFToken` header (`CSRF_HEADER_NAME`) must match its secret. Tokens are masked per response (BREACH).

Moving parts: `{% csrf_token %}` in forms, `@csrf_exempt`, `@csrf_protect`, `@requires_csrf_token`, `@ensure_csrf_cookie`, `CSRF_USE_SESSIONS` (token in the session instead of a cookie), `CSRF_COOKIE_SECURE/SAMESITE/DOMAIN`, `CSRF_FAILURE_VIEW`. Since Django 4.0, `CSRF_TRUSTED_ORIGINS` entries must include the scheme (`https://app.example.com`) and may use a leading wildcard (`https://*.example.com`).

Limits stated in Django's docs: subdomains can set cookies for the parent domain and so can bypass CSRF with a matching cookie and token; the protection assumes host validation (`ALLOWED_HOSTS`) and no XSS; `request.is_secure()` drives the Referer check, so a wrong `SECURE_PROXY_SSL_HEADER` weakens it (`secrets-config.md`).

## What to investigate

**1. `@csrf_exempt` and removed middleware.**
```text
@csrf_exempt   csrf_exempt(   method_decorator(csrf_exempt   path('x/', csrf_exempt(view))
'django.middleware.csrf.CsrfViewMiddleware' missing or commented out
```
For each exempt view ask: how else is the caller authenticated? Acceptable: provider signature verification (HMAC over the raw body with `hmac.compare_digest`), bearer/API-key/token header that browsers do not attach automatically, mTLS, or a genuinely public side-effect-free endpoint. Not acceptable: a session-authenticated, state-changing view (profile, email or password change, payments, admin-like actions) exempted "to make AJAX work". Severity follows the action: email/password/role change or money movement **High**; low-impact settings **Medium/Low**.

An exempt webhook without signature verification is forgeable by anyone, not just via CSRF. Report it under `api-security.md` (webhooks).

**2. State-changing GET.** `GET` is never checked. `GET` handlers that delete, approve, change email, toggle flags or log out are CSRF-able through `<img>`, links and top-level navigation (`SameSite=Lax` allows top-level GET). `LogoutView` is POST-only since Django 5.0, but custom logout-on-GET is Low. Also check `@require_http_methods(["GET", "POST"])` views that act on GET query parameters.

**3. Over-broad trust.**
- `CSRF_TRUSTED_ORIGINS` containing `http://` origins on an HTTPS site, wildcards for parent domains that host untrusted content, or origins the organization does not control: **Medium**.
- `CSRF_COOKIE_DOMAIN = ".example.com"` or `SESSION_COOKIE_DOMAIN` shared with untrusted subdomains: **Medium** (documented limitation).
- `CSRF_COOKIE_SAMESITE = "None"` or `SESSION_COOKIE_SAMESITE = "None"` without a cross-site requirement.

**4. Token handling.** `CSRF_COOKIE_HTTPONLY` is irrelevant (the docs call it of little practical benefit; do not report). `CSRF_COOKIE_SECURE` unset on HTTPS sites is Hardening. Tokens in URLs leak via `Referer`. Templates rendering forms with `method="post"` and no `{% csrf_token %}` break in dev (403), so check whether the "fix" was an exemption. `Referrer-Policy: no-referrer` site-wide breaks the strict Referer check on HTTPS without `Origin`; developers sometimes respond by exempting views.

**5. Login CSRF.** Django's `LoginView` is CSRF-protected. Custom login endpoints exempted from CSRF allow login CSRF (Low, higher if the app links payment methods or uploads to the identity).

## DRF, SPAs and APIs

- DRF's `APIView.as_view()` wraps views in `csrf_exempt`. Protection comes from the authentication class: `SessionAuthentication.enforce_csrf` runs the Django CSRF check for **authenticated** session requests only. `TokenAuthentication`, JWT and OAuth bearer headers are not sent automatically by browsers and need no CSRF token. Do not report missing CSRF on those.
- DRF docs: only authenticated requests require CSRF tokens under session auth; anonymous requests may be sent without a token, which is "not suitable for login views". Custom DRF login/registration views based on `SessionAuthentication` need explicit CSRF handling (for example a plain Django view, or `@method_decorator(csrf_protect)`).
- `BasicAuthentication` (in DRF's default `DEFAULT_AUTHENTICATION_CLASSES` together with `SessionAuthentication`) is re-sent by browsers that have cached the credentials, so it is not CSRF-safe for cookie-like browser use. Report **Low/Hardening** when browsers can authenticate that way; in production Basic should not be used over anything but HTTPS (DRF docs).
- Cross-origin SPAs using cookies need `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOW_CREDENTIALS` with a tight origin allowlist, and a CSRF token header. CORS is not CSRF protection: a permissive CORS config enables cross-origin reads, while simple form posts are blocked only by the CSRF middleware.
- `ensure_csrf_cookie` on a view that returns the token to cross-origin callers combined with permissive CORS leaks the token. Check both.

## Severity, false positives, verification

False positives: missing CSRF on token/JWT APIs; exempt webhooks with signature verification; `csrf_exempt` on a public, idempotent endpoint (health, public search); `CSRF_COOKIE_HTTPONLY=False`; Django's test client not enforcing CSRF by default.

Verify (the default `Client` skips CSRF, so enable enforcement):

```python
from django.test import Client

def test_profile_update_requires_csrf(django_user_model):
    u = django_user_model.objects.create_user("a", password="pw-a-123456")
    c = Client(enforce_csrf_checks=True)
    c.force_login(u)
    r = c.post("/accounts/profile/", {"email": "x@example.com"})
    assert r.status_code == 403            # not 200/302
```

```bash
# Origin mismatch must be rejected by a running staging instance (expect 403)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.example.com/accounts/profile/ \
  -H "Cookie: sessionid=<test user session>" -H "Origin: https://other.example.net" --data "email=csrf@test.invalid"
```

Fix state-changing GET by switching to POST and `@require_POST`. Verify with a test asserting `GET` returns 405.

References: OWASP CSRF Prevention cheat sheet; CWE-352; https://docs.djangoproject.com/en/stable/ref/csrf/, https://docs.djangoproject.com/en/stable/howto/csrf/, https://www.django-rest-framework.org/api-guide/authentication/#sessionauthentication.
