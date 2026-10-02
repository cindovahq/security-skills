# Laravel — CSRF / Request Forgery

## Contents
- Version map
- How the middleware decides
- What to investigate
- SPAs, Sanctum and APIs
- False positives
- Verification

## Version map

| Laravel | Middleware | Exclusions configured in |
|---|---|---|
| ≤10 | `App\Http\Middleware\VerifyCsrfToken` (extends the framework class) | `protected $except = [...]` in that class |
| 11–12 | `Illuminate\Foundation\Http\Middleware\ValidateCsrfToken` (alias `VerifyCsrfToken`) | `bootstrap/app.php` → `$middleware->validateCsrfTokens(except: [...])` |
| 13 | `Illuminate\Foundation\Http\Middleware\PreventRequestForgery`. `VerifyCsrfToken` and `ValidateCsrfToken` remain as deprecated aliases. | `bootstrap/app.php` → `$middleware->preventRequestForgery(except: [...], originOnly: bool, allowSameSite: bool)`. `validateCsrfTokens()` is deprecated and forwards to it. |

The middleware is in the `web` group by default. Routes in `routes/api.php` (the `api` group) do **not** get CSRF protection unless Sanctum stateful handling applies (see below).

## How the middleware decides (Laravel 13)

A request passes if **any** of these is true, checked in order:

1. Method is `GET`, `HEAD` or `OPTIONS` ("reading").
2. Running unit tests (CSRF is disabled in tests, **so feature tests can't prove CSRF protection**).
3. URI matches the `except` list.
4. Origin check: the `Sec-Fetch-Site` header is `same-origin`, or `same-site` when `allowSameSite: true`. With `originOnly: true`, a failed origin check returns **403** and there's no token fallback.
5. Token check: `_token` input, `X-CSRF-TOKEN` header, or the `X-XSRF-TOKEN` header (decrypted from the `XSRF-TOKEN` cookie) matches the session token.

Laravel ≤12 uses steps 1–3 and 5 only. Browsers send `Sec-Fetch-Site` only over HTTPS. Over plain HTTP, Laravel 13 falls back to token validation, and `originOnly` would reject every state-changing request.

## What to investigate

**1. State-changing `GET` routes.** Because `GET` skips CSRF entirely, any `GET` route that changes state is CSRF-able (`<img src>`, links, top-level navigation, which `SameSite=Lax` allows):

```php
Route::get('/posts/{post}/delete', ...);      // investigate
Route::get('/account/email/confirm?new=...'); // investigate
Route::match(['get', 'post'], '/settings', ...);
Route::any('/webhook', ...);
```

Severity follows the action's impact: deleting data or changing email/password → **High**; logout → Low.

**2. Over-broad exclusions.**
- `except: ['*']`, `'api/*'` (when those routes rely on session cookies), `'admin/*'`, `'livewire/*'`, or entire route groups moved to `withoutMiddleware(PreventRequestForgery::class)` / `VerifyCsrfToken::class`.
- Each excluded route must authenticate the request some other way: a provider signature (Stripe, GitHub, Twilio), a bearer token, or be genuinely public and side-effect-free.
- Excluded webhook routes that **don't verify signatures** are forgeable by anyone, not just via CSRF. Report under `api-security.md`.

**3. `allowSameSite: true` (Laravel 13).** Requests from any sibling subdomain (`*.example.com`) pass the origin check without a token. That's a finding if any subdomain hosts user-controlled content, a less-trusted app, or is takeover-prone. Medium/High depending on the action.

**4. Token handling.**
- Forms missing `@csrf` produce 419 errors, so they're noticed in dev. The real risk is developers "fixing" 419s by adding the route to `except`. Check git history or comments near exclusions.
- CSRF token placed in URLs (`?_token=`) leaks via `Referer` and logs. Low.
- Custom AJAX setups that read the token from a cookie the attacker can set (e.g. a non-HttpOnly cookie on a parent domain). Rare.

**5. Login CSRF / logout CSRF.** Usually Low. Login CSRF matters when the app links actions to the logged-in identity (e.g. saving payment methods).

## SPAs, Sanctum and APIs

- **Sanctum SPA (cookie) auth:** `EnsureFrontendRequestsAreStateful` (enabled by `$middleware->statefulApi()` in 11+) applies session, cookie encryption and CSRF validation to requests whose `Origin`/`Referer` matches `config('sanctum.stateful')`. The SPA must first call `/sanctum/csrf-cookie`. A finding exists if API routes use cookie sessions **without** this stateful middleware, which leaves them CSRF-able.
- **Token-based APIs** (`Authorization: Bearer`) are not CSRF-prone, because browsers don't attach bearer tokens automatically. Don't report missing CSRF on them.
- **CORS is not CSRF protection.** A permissive CORS config makes cross-origin reads possible. It doesn't change whether a simple cross-site form `POST` is accepted. See `secrets-config.md` → CORS.
- **Livewire** requests carry a CSRF token automatically. Excluding `livewire/*` from CSRF is a finding.

## False positives

- Missing CSRF on `routes/api.php` routes that use token auth only.
- Webhook exclusions **with** signature verification.
- `Route::get` endpoints that are idempotent reads.
- `SameSite=Lax` doesn't make an app CSRF-proof, but treat missing tokens on POST routes as the issue, not the SameSite value.

## Verification

Feature tests disable CSRF, so verify on a running non-production environment:

```bash
# Expect 419 (≤12 / token mode) or 403 (13 origin-only) — NOT 2xx/3xx
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.example.com/profile \
  -H "Cookie: <session cookie of a test user>" -H "Sec-Fetch-Site: cross-site" \
  --data "name=csrf-test"
```

For state-changing `GET` routes, the fix is changing the method to `POST`/`PUT`/`DELETE`. Verify with `php artisan route:list --method=GET` and a test asserting `GET` returns 405.

References: OWASP CSRF Prevention Cheat Sheet; CWE-352; https://laravel.com/docs/csrf, https://laravel.com/docs/sanctum#spa-authentication, Laravel 13 upgrade guide → Request Forgery Protection.
