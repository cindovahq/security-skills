# Laravel — Session Security

## Contents
- Effective configuration
- Session fixation and regeneration
- Logout and invalidation
- Other-device logout and password changes
- Serialization (Laravel 13)
- Driver and storage
- Sanctum SPA sessions
- False positives
- Verification

## Effective configuration

Read `config/session.php` **and** the environment values it references. The effective value is the env var when set, otherwise the default in the config file. Laravel 13 skeleton defaults (earlier skeletons are similar):

| Key | Env var | Skeleton default | Review |
|---|---|---|---|
| `driver` | `SESSION_DRIVER` | `database` (11+), `file` (≤10) | `cookie` driver stores the whole session client-side (encrypted). Acceptable, but it can't be revoked server-side. |
| `lifetime` | `SESSION_LIFETIME` | `120` (minutes, idle) | Match the risk profile. Hours-long idle sessions on admin or financial apps are worth a hardening note. |
| `expire_on_close` | `SESSION_EXPIRE_ON_CLOSE` | `false` | |
| `encrypt` | `SESSION_ENCRYPT` | `false` | Encrypts session payload at rest in the store. Hardening for DB/Redis stores holding sensitive data. |
| `secure` | `SESSION_SECURE_COOKIE` | `null` | `null` means the Secure flag is set only when Laravel sees the request as HTTPS. Behind a TLS-terminating proxy without correct `trustProxies`, the request looks like HTTP and the cookie is **sent without Secure**. Recommend `SESSION_SECURE_COOKIE=true` in production. |
| `http_only` | `SESSION_HTTP_ONLY` | `true` | `false` → JavaScript can read the session cookie; with any XSS, session theft becomes trivial. |
| `same_site` | `SESSION_SAME_SITE` | `lax` | `none` requires `secure=true` and removes SameSite CSRF defense-in-depth. `strict` is fine but can break inbound links. |
| `domain` | `SESSION_DOMAIN` | `null` | `.example.com` shares the cookie with **all** subdomains. A user-controlled or less-trusted subdomain can then read or set it (cookie tossing). |
| `partitioned` | `SESSION_PARTITIONED_COOKIE` | `false` | CHIPS; only relevant to embedded third-party contexts. |
| `serialization` | — | `json` (13 skeleton) | See below. |

The cookie name (`SESSION_COOKIE`) defaults to a slug of `APP_NAME`. Laravel 13 changed the format to hyphenated (`-session`); this is not a security issue.

## Session fixation and regeneration

**How Laravel behaves:** `SessionGuard::login()` (used by `Auth::attempt()`, `Auth::login()`, `Auth::loginUsingId()`) calls `updateSession()`, which runs `$this->session->regenerate(true)`. **The session ID is regenerated on every standard login, even without an explicit `$request->session()->regenerate()` call.** Starter kits call `regenerate()` explicitly as well, which is harmless.

**Real fixation findings come from:**
- Custom authentication that writes identity directly: `session(['user_id' => $user->id])`, `$request->session()->put('admin', true)`, with no `regenerate()` afterwards → **High** (CWE-384).
- Privilege changes within a session (impersonation start/stop, "sudo mode", role switch, tenant switch) that store elevated state in the session without regenerating.
- Session IDs accepted from the URL or a custom header (custom `SessionHandler` / middleware), which makes fixation practical.
- `session()->setId($request->input(...))`.

## Logout and invalidation

**Expected (starter kits):**

```php
Auth::guard('web')->logout();
$request->session()->invalidate();       // flush data + new session ID
$request->session()->regenerateToken();  // new CSRF token
```

`Auth::logout()` alone clears the auth identity and cycles the remember token, but leaves **other session data and the CSRF token** in place.

**Investigate:**
- Logout without `invalidate()`. Severity depends on what else is stored in the session (cart, impersonation flags, "sudo mode" timestamps, OAuth state, tenant context). Usually **Low**. **Medium** if privileged flags stored in the session survive logout.
- Logout reachable via `GET` (`Route::get('/logout', ...)`): CSRF-able logout. Low, but see `csrf.md`.
- API token logout that doesn't revoke the token (`$request->user()->currentAccessToken()->delete()` missing). See `api-security.md`.
- Custom session-based admin auth whose logout only `forget()`s a key.

## Other-device logout and password changes

- `Auth::logoutOtherDevices($currentPassword)` only invalidates other sessions if the `AuthenticateSession` middleware (`auth.session`) is applied to those routes. It stores a password hash in the session and logs out sessions whose hash no longer matches.
- After a password change or reset, other sessions should usually be ended for sensitive apps. A missing `auth.session` on routes means **a stolen session survives a password change**. Classify as Hardening, or **Medium** for apps handling money or PII.
- Database driver: sessions can be revoked by deleting rows from `sessions` by `user_id`. Check whether "log out of all devices" features actually do this.

## Serialization (Laravel 13)

- The Laravel 13 skeleton sets `'serialization' => 'json'` in `config/session.php`. With `php` serialization, an attacker who obtains `APP_KEY` and can write session data (e.g. the cookie driver, or a writable session store) may reach PHP object deserialization gadget chains (RCE).
- Apps upgraded to 13 may still have `'serialization' => 'php'` (or no key). Report as **Hardening**. It's not a vulnerability by itself because it requires `APP_KEY` compromise or store access, but **raise to High** if `APP_KEY` is exposed (committed, shared across environments, default) **and** the `cookie` driver is used.
- Switching to `json` invalidates existing sessions and breaks code that stores objects in the session. Mention this in the remediation.

## Driver and storage

- `file` driver: session files in `storage/framework/sessions`. Ensure `storage/` is not web-accessible (document root must be `public/`).
- `redis`/`memcached`: the store must not be reachable from the internet and should require auth. Session data is readable by anyone with store access unless `encrypt` is on.
- `database`: the `sessions` table includes `ip_address`, `user_agent`, `payload`. Check backup and export exposure.

## Sanctum SPA sessions

- SPA auth uses the `web` guard session through `EnsureFrontendRequestsAreStateful`, enabled with `$middleware->statefulApi()` (11+) or `api` middleware group config (≤10).
- `SANCTUM_STATEFUL_DOMAINS` / `config/sanctum.php` `stateful` must list only your own front-end hosts. Over-broad values (e.g. including domains you don't control) extend cookie-session trust to them.
- Cookie `SESSION_DOMAIN` must cover the SPA and API hosts, and no wider.

## False positives

- No explicit `regenerate()` after `Auth::attempt()`. Not fixation; the guard regenerates.
- `secure => null`. Only a finding when production is behind TLS termination with untrusted proxy config, or serves HTTP. State the precondition and classify as **Likely** or **Hardening**.
- `same_site => 'none'` for an app that genuinely needs cross-site embedding (with `secure => true`). Hardening note only.
- Long `lifetime` for low-risk consumer apps with "remember me" semantics. Informational.

## Verification

```php
it('regenerates session id on login', function () {
    $user = User::factory()->create();
    $this->get('/login');
    $before = session()->getId();
    $this->post('/login', ['email' => $user->email, 'password' => 'password']);
    expect(session()->getId())->not->toBe($before);
});

it('invalidates the session on logout', function () {
    $user = User::factory()->create();
    $this->actingAs($user)->withSession(['impersonating' => 42]);
    $this->post('/logout');
    expect(session()->has('impersonating'))->toBeFalse();
    $this->assertGuest();
});
```

On a running staging environment, check cookie flags with `curl -sI https://staging.example.com/login | grep -i set-cookie` and confirm `secure; httponly; samesite=lax`.

References: OWASP Session Management Cheat Sheet; CWE-384, CWE-613, CWE-614, CWE-1004; https://laravel.com/docs/session, /authentication#invalidating-sessions-on-other-devices.
