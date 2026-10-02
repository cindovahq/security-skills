# Laravel — Authentication

## Contents
- Identify the auth stack
- Password storage
- Login flow and brute-force protection
- Password reset
- Email verification, MFA and passkeys
- Remember-me
- Custom and alternative guards
- Social login (Socialite)
- Verification

## Identify the auth stack

Determine which of these the app uses before judging anything. Each has different defaults.

| Stack | Evidence | Where the logic lives |
|---|---|---|
| Breeze / 12.x+ starter kits | `app/Http/Controllers/Auth/*`, `app/Http/Requests/Auth/LoginRequest.php` (or Livewire/Volt auth components) | App code (published, editable) |
| Fortify (incl. Jetstream) | `laravel/fortify` in composer.lock, `config/fortify.php`, `app/Actions/Fortify/*` | Vendor package + `app/Actions/Fortify` |
| Custom | Hand-written controllers calling `Auth::attempt`, `Auth::login`, `Hash::check` | App code |
| API tokens | Sanctum / Passport / JWT package | See `api-security.md` |
| External IdP | Socialite, SAML, WorkOS, Auth0 | Callback controllers |

Published starter-kit code can be modified after install. Review what is in the repo, not what the starter kit originally shipped.

## Password storage

**Expected:** `Hash::make()` / `bcrypt()` or the `hashed` model cast (`'password' => 'hashed'`, Laravel 10+). Driver and cost in `config/hashing.php` and `.env` (`BCRYPT_ROUNDS`, default 12 in recent skeletons). Argon2id is also acceptable.

**Investigate:**
- `md5(`, `sha1(`, `hash('sha256', $password)`, `crypt(` used for passwords → **High** (CWE-916).
- Plaintext password columns, or passwords written to logs, emails or notifications.
- `$user->password == $request->password` or `===` on stored hashes; any comparison other than `Hash::check()`.
- `Hash::make()` applied twice: the `hashed` cast **and** a manual `Hash::make` in the controller. That's a functional bug, not a vulnerability, but it can lead to "fixes" that weaken hashing.
- Very low cost: `BCRYPT_ROUNDS` < 10 in production config. That's Hardening/Low, unless it's paired with a hash leak.
- **Password policy:** `Illuminate\Validation\Rules\Password::defaults()` set in a service provider with `min(8)` or more. `->uncompromised()` (HIBP k-anonymity check) is a good hardening addition. A missing or weak policy is Hardening unless the business context requires more.

## Login flow and brute-force protection

**Expected:**
- Breeze-style `LoginRequest::authenticate()` calls `ensureIsNotRateLimited()` with a `RateLimiter` keyed on `email|ip` (default 5 attempts).
- Fortify uses `config/fortify.php` → `'limiters' => ['login' => 'login', 'two-factor' => 'two-factor']`, defined via `RateLimiter::for('login', ...)` in `FortifyServiceProvider`.
- Generic error messages (`auth.failed`) that don't reveal whether the account exists.

**Investigate:**
- Custom login endpoints (often API/mobile login routes) with **no throttling**. Check route middleware for `throttle:` and controller code for `RateLimiter::hit/tooManyAttempts`. Missing throttling on a public login is typically **Medium**.
- Rate-limiter keys based only on `$request->ip()` when `trustProxies(at: '*')` is configured. The key is spoofable through `X-Forwarded-For` (see `secrets-config.md`).
- Throttling on login but not on **OTP / 2FA verification, password reset requests, email verification resend, or invite acceptance**. A 6-digit OTP without throttling can be brute-forced: **High**.
- **Account enumeration:** different responses or timing for unknown vs known emails on login, registration or reset. Usually Low, or Medium where user existence is sensitive.
- `Auth::loginUsingId($request->input('id'))` or `Auth::login(User::find($request->...))` reachable without proof of identity → **Critical** (authentication bypass, CWE-287).
- "Magic link" / passwordless login: tokens must be random (`Str::random(40+)` or a signed URL), single-use, short-lived and bound to the user. Check that `URL::temporarySignedRoute` is validated with the `signed` middleware.
- Inactive, banned or unverified users able to log in. Check whether the business rule is enforced in `Auth::attempt` callbacks (`Auth::attemptWhen`) or middleware.

## Password reset

**Expected (built-in broker):** tokens are random, stored **hashed** in `password_reset_tokens`, expire (`config/auth.php` → `passwords.users.expire`, default 60 minutes), and are throttled (`throttle` key, default 60 seconds between requests).

**Investigate:**
- **Password-reset poisoning via the Host header.** The reset link is generated with `url(route('password.reset', ...))`, which uses the *request's* host. If the web server routes any `Host` value to the app and no `TrustHosts` middleware restricts it, an attacker can request a reset for a victim with `Host: attacker.tld`. The victim receives a link to the attacker's domain containing a valid token.
  - Laravel ≤10: `\App\Http\Middleware\TrustHosts::class` is commented out in `app/Http/Kernel.php` by default.
  - Laravel 11+: enabled via `$middleware->trustHosts(...)` in `bootstrap/app.php`. It's not enabled by default.
  - Also dangerous: `trustProxies(at: '*')`, because then `X-Forwarded-Host` is honored.
  - Classify as **Likely (High)**. The precondition is server/vhost config: a default server block that forwards unknown hosts. Recommend `trustHosts()` or a fixed root via `URL::forceRootUrl(config('app.url'))` in the reset notification (`ResetPassword::createUrlUsing`).
- Custom reset flows: tokens from `rand()`, `mt_rand()`, `uniqid()`, `time()`, `md5($email)` or sequential IDs → **High**. Tokens stored in plaintext; no expiry; not invalidated after use; the reset form accepts `email` + `token` but looks up the user by a separate, client-supplied `user_id`.
- Reset doesn't invalidate other sessions or remember-me tokens. Hardening, or Medium for high-value apps. The built-in `PasswordReset` flow in starter kits calls `$user->setRememberToken(Str::random(60))`.

## Email verification, MFA and passkeys

- Email verification: `MustVerifyEmail` on the User model plus the `verified` middleware on routes that need it. A finding exists only if a business rule depends on verified email and the route lacks `verified`.
- Verification links use signed URLs (`signed` middleware). Custom verification routes without `signed` or without a hash check → **High** (anyone can verify any email).
- Fortify 2FA: `two_factor_secret` and `two_factor_recovery_codes` are stored encrypted and should be in the model's `$hidden`. Check that the 2FA challenge is throttled and that `confirmPassword` / `password.confirm` protects enabling and disabling 2FA.
- Custom TOTP: the secret is generated with a CSPRNG (e.g. `pragmarx/google2fa`), verified with a small window, and has replay protection if the business needs it.
- Passkeys / WebAuthn (Fortify and starter kits in Laravel 13; packages like `laragear/webauthn`): check that the relying-party ID and origin are configured to the production domain and that the user-verification requirement matches policy.

## Remember-me

- `Auth::attempt($credentials, $remember)` issues a `remember_web_*` cookie. `SessionGuard::logout()` cycles the `remember_token`, which invalidates old cookies.
- Investigate a `remember_token` exposed via API responses (it's in the default `$hidden`; check that custom models keep it there), or custom "remember me" cookies holding a raw user ID.

## Custom and alternative guards

- `Auth::viaRequest(...)` / custom guards in `AuthServiceProvider` or `AppServiceProvider`: check that tokens are compared with `hash_equals()` and looked up by a hashed value, not compared with `==`.
- Static API keys compared with `==` against `env('API_KEY')`. Two problems: timing-unsafe comparison, and **`env()` returns `null` when config is cached**, so a request with no header can satisfy `null == null`. See `secrets-config.md` → `env()`. Severity: **Critical** if the bypass is confirmed.
- Multiple guards (`web`, `admin`, `api`): check that admin routes use the admin guard (`auth:admin`) and that a `web` user can't reach them because of a guard mix-up in middleware.

## Social login (Socialite)

- Account linking by email only (`User::firstOrCreate(['email' => $socialUser->getEmail()])`) lets an attacker who controls an IdP account with the victim's email (some providers don't verify emails) take over the local account. Require a verified email from the provider or explicit linking. **High** when exploitable.
- `->stateless()` disables OAuth state validation. It's legitimate for pure API flows only. In a browser flow it enables login CSRF: Medium.
- Redirect URIs must be fixed in the provider config, not taken from the request.

## Verification

See `verification.md`. Typical tests:

```php
// Throttling
foreach (range(1, 6) as $i) {
    $response = $this->post('/login', ['email' => $user->email, 'password' => 'wrong']);
}
$response->assertSessionHasErrors('email'); // message contains "Too many login attempts"

// Host-header poisoning is fixed
$this->withHeader('Host', 'evil.test')->post('/forgot-password', ['email' => $user->email]);
Notification::assertSentTo($user, ResetPassword::class, function ($n) use ($user) {
    return str_starts_with($n->toMail($user)->actionUrl, config('app.url'));
});
```

References: OWASP Authentication Cheat Sheet, Forgot Password Cheat Sheet; CWE-287, CWE-307, CWE-640, CWE-916; https://laravel.com/docs/authentication, /passwords, /fortify.
