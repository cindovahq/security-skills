# Laravel — Secrets and Configuration

## Contents
- Secrets in the repository
- APP_KEY
- Debug mode and environment
- Debug and admin tooling
- `env()` outside config files
- Document root and exposed files
- Trusted proxies and hosts
- CORS
- HTTPS and security headers
- Rate limiting
- Logging and error handling
- Cryptography and randomness
- Verification

## Secrets in the repository

**Investigate** (and **redact values** in the report; show only the key name and the first characters):
- `.env`, `.env.production`, `.env.backup`, `.env.*.bak` tracked in git (`git ls-files | grep -i '\.env'`). Also check git history if available (`git log --all --diff-filter=A -- .env`).
- Real values in `.env.example`, `docker-compose.yml`, CI files (`.github/workflows`, `.gitlab-ci.yml`), `phpunit.xml`, Dockerfiles (`ENV`, `ARG`), deployment scripts.
- Hardcoded defaults in config: `env('STRIPE_SECRET', 'sk_live_...')`, `'password' => env('DB_PASSWORD', 'prod-password')`.
- Private keys: `storage/oauth-private.key` (Passport), `*.pem`, `*.p12`, Firebase service-account JSON, `auth.json` (Composer credentials).
- Secrets in front-end bundles: only `VITE_*` (or `MIX_*`) variables reach JS. A secret placed in a `VITE_` variable is public.

A live secret committed to a public repo → **Critical/High** (it must be rotated; removing the file is not enough). A test or placeholder value → Informational.

## APP_KEY

`APP_KEY` signs and encrypts cookies, sessions (when encrypted), `encrypted` casts, `Crypt::` values, signed URLs and password-confirmation state.

**If exposed** (committed, logged, in a public Docker image, identical across environments, or one of the keys published in tutorials): attackers can forge signed URLs, decrypt encrypted data and cookies, and, where `decrypt()` or PHP session/cache serialization is used, potentially reach deserialization RCE (see `injection.md`).

- Rotation: generate a new key and move the old one to `APP_PREVIOUS_KEYS` (Laravel 11+) so existing encrypted data can still be decrypted. Re-encrypt data, then drop the old key.
- Same key in staging and production → Medium (staging compromise becomes production compromise).

## Debug mode and environment

- `APP_DEBUG=true` in production → the error page shows stack traces, source snippets, SQL, request data and, depending on the renderer, environment variables. **High** (often Critical when secrets appear). Historical: CVE-2021-3129 (facade/ignition < 2.5.2 with debug enabled → unauthenticated RCE).
- `APP_ENV=local` (or anything other than `production`) in production: enables local-only behavior in packages (Telescope/Horizon/Pulse/Nova gates open, Debugbar, Filament panel access without `FilamentUser`). **High.**
- Evidence: production env files, deployment config (Forge/Envoyer/Vapor/Cloud env, Kubernetes ConfigMaps, `docker-compose.prod.yml`). If only the local `.env` shows `APP_DEBUG=true`, it's **not** a finding.
- CVE-2024-52301: on Laravel < 10.48.23 / < 11.31.0 with PHP `register_argc_argv=On`, a query string can change the detected environment (e.g. `?--env=local`). Check the version and the PHP ini.

## Debug and admin tooling

Check `composer.json` `require` (not only `require-dev`) and service providers for:

| Tool | Route | Access control |
|---|---|---|
| Telescope | `/telescope` | `TelescopeServiceProvider::gate()` → `viewTelescope`. **Always open in `local` env.** Contains requests, queries, mail, dumps, auth tokens. |
| Horizon | `/horizon` | `HorizonServiceProvider::gate()` → `viewHorizon` (open in local). Exposes job payloads. |
| Pulse | `/pulse` | `viewPulse` gate |
| Debugbar | injected into pages, `/_debugbar/*` | Enabled when `APP_DEBUG=true` unless `DEBUGBAR_ENABLED=false`. Leaks queries, session, request data. |
| Log viewers (opcodesio/log-viewer, rap2hpoutre) | `/log-viewer`, `/logs` | Check auth gate and middleware |
| Clockwork | `/clockwork`, `/__clockwork` | Should be disabled in production |
| Ignition / error page | `/_ignition/*` | Only with debug |
| `phpinfo()` routes, `Route::get('/test', ...)`, `/debug`, `/info` | — | Remove |

Production exposure of any of these with sensitive data → **High**. Gate logic like `in_array($user->email, [...])` is fine. `return true` is not.

## `env()` outside config files

When config is cached (`php artisan config:cache`, standard in production), **`env()` returns `null` everywhere except inside `config/*.php`**.

```php
// Controller / middleware
if ($request->header('X-Api-Key') == env('INTERNAL_API_KEY')) { ... }
```

In production, `env('INTERNAL_API_KEY')` is `null`, so a request **without** the header (`null == null`) passes. This is an authentication bypass: **Critical** when the guarded action is sensitive. Even when it doesn't bypass anything, `env()` outside config is a bug.

**Fix:** `config('services.internal.key')`, a non-empty check, and `hash_equals()`.

## Document root and exposed files

The web server's document root must be `public/`. If the project root is served (common in shared hosting, or a misconfigured nginx `root`), then `/.env`, `/storage/logs/laravel.log`, `/composer.json` and `/vendor/...` are downloadable. **Critical.** Check nginx/Apache configs, Dockerfiles and root-level `.htaccess` / `index.php` shims.

Also check for: `public/.env`, `public/*.sql`, `public/backup*`, `public/phpinfo.php`, `public/adminer.php`, `.git/` deployed under `public/`.

## Trusted proxies and hosts

- Laravel ≤10: `app/Http/Middleware/TrustProxies.php` → `$proxies`. Laravel 11+: `$middleware->trustProxies(at: ...)`.
- `'*'` trusts `X-Forwarded-*` from **any** client. This is acceptable only when the app is reachable **exclusively** through a proxy or load balancer that overwrites these headers. Otherwise:
  - `$request->ip()` is spoofable → IP-based rate limiting, allow-lists and audit logs can be bypassed.
  - `X-Forwarded-Host` → URL generation poisoning (password reset links).
  - `X-Forwarded-Proto` → scheme confusion.
- **TrustHosts** (`$middleware->trustHosts()` in 11+, `TrustHosts` middleware in ≤10, commented out by default): without it, and with a catch-all vhost, Host-header poisoning affects password-reset links and other absolute URLs. See `authentication.md`.

## CORS

`config/cors.php` (published in 11+ with `php artisan config:publish cors`). Defaults: `paths => ['api/*', 'sanctum/csrf-cookie']`, `allowed_origins => ['*']`, `supports_credentials => false`.

- `'allowed_origins' => ['*']` **with** `'supports_credentials' => true`: the CORS library then reflects the requesting origin, so **any website can make credentialed requests and read responses** for logged-in users. **High** for cookie-authenticated endpoints.
- `allowed_origins_patterns` with unanchored or loose regex (`/example\.com/` matches `example.com.evil.net`).
- Allowing `null` origin.
- `'*'` without credentials on a bearer-token API is generally fine.

## HTTPS and security headers

- HTTPS enforcement: web server redirect, or `URL::forceScheme('https')` in production. HSTS (`Strict-Transport-Security`) via web server or middleware. Missing HSTS → Hardening.
- Laravel sets no security headers by default. Recommend (Hardening): `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors` (clickjacking matters for sensitive one-click actions), `Permissions-Policy`.
- Cookies: see `sessions.md`. `EncryptCookies` should not exclude sensitive custom cookies (`encryptCookies(except: [...])` in 11+, `$except` in ≤10).

## Rate limiting

- Limiters defined via `RateLimiter::for(...)` in `AppServiceProvider` (11+) or `RouteServiceProvider` (≤10). Applied with `throttle:name` or `throttle:60,1`. API throttling in 11+ is opt-in (`$middleware->throttleApi()` or route middleware).
- Must cover: login, registration, password reset, OTP/2FA, email/SMS sending endpoints (cost and spam abuse), search and export endpoints, AI/LLM-backed endpoints (cost).
- `throttle` keyed by IP behind `trustProxies('*')` → bypassable (see above).

## Logging and error handling

- Passwords and tokens in logs: `Log::info('Login', $request->all())`, logging full request bodies in middleware, `dd()`/`dump()` left in code paths.
- Flash protection: fields excluded from old-input flashing on validation errors. Defaults: `current_password`, `password`, `password_confirmation`. Laravel 11+: `$exceptions->dontFlash([...])`; ≤10: `$dontFlash` in `Handler.php`. Add custom secret fields (card numbers, tokens, SSNs).
- Exception reporting to third parties (Sentry, Bugsnag, Flare) can include request payloads. Check scrubbing config.
- `LOG_LEVEL=debug` in production with query logging: sensitive data in logs. Hardening/Medium.
- Logs under `storage/logs` must not be web-accessible (document root).

## Cryptography and randomness

- Tokens, codes and filenames for secrets must use a CSPRNG: `Str::random()`, `random_int()`, `random_bytes()`, `Str::uuid()` (for identifiers, not secrets; v7 UUIDs are time-ordered and **partially predictable**). `rand()`, `mt_rand()`, `uniqid()`, `str_shuffle()`, `time()`, `md5(microtime())` → **High** when used for security tokens.
- Use `Crypt::encryptString` / the `encrypted` cast for data at rest. Custom `openssl_encrypt` with ECB, a static IV, no MAC, or hardcoded keys → **High**.
- Compare secrets with `hash_equals()`. `==`/`===`/`strcmp` on secrets is timing-unsafe (Low/Medium; context dependent).
- Hashes for integrity or signatures: `hash_hmac('sha256', ...)` with a secret key, not plain `md5`/`sha1` of the payload.

## Verification

```bash
php artisan about --only=environment      # Environment, Debug Mode, URL, Maintenance
php artisan config:show app               # where available; confirm debug/env/url on the target environment
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/.env          # expect 404
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/telescope     # expect 403/404 unauthenticated
curl -sI -H "Origin: https://evil.example" https://staging.example.com/api/user | grep -i access-control
```

```php
it('rejects requests without the internal key', function () {
    config(['services.internal.key' => 'test-key']);
    $this->postJson('/internal/sync')->assertUnauthorized();
    $this->postJson('/internal/sync', [], ['X-Api-Key' => 'test-key'])->assertOk();
});
```

References: OWASP Secrets Management, Logging, HTTP Headers, CORS (WSTG-CLNT-07) guidance; CWE-200, CWE-209, CWE-215, CWE-312, CWE-338, CWE-346, CWE-532, CWE-798, CWE-942; https://laravel.com/docs/configuration, /deployment, /requests#configuring-trusted-proxies, /routing#rate-limiting.
