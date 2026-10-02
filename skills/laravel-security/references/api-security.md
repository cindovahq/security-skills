# Laravel — API Security

## Contents
- Identify the API auth model
- Sanctum
- Passport
- JWT packages
- Excessive data exposure
- Resource consumption
- Webhooks
- Signed URLs
- Broadcasting and real-time
- GraphQL (Lighthouse)
- Verification

Authorization (BOLA/IDOR) applies to every API route. See `authorization.md`. This file covers API-specific controls.

## Identify the API auth model

| Model | Evidence |
|---|---|
| Sanctum tokens | `HasApiTokens` on User, `auth:sanctum`, `personal_access_tokens` table, `createToken(` |
| Sanctum SPA cookies | `statefulApi()` / `EnsureFrontendRequestsAreStateful`, `/sanctum/csrf-cookie` |
| Passport (OAuth2) | `laravel/passport`, `oauth_*` tables, `auth:api` with passport driver |
| JWT | `tymon/jwt-auth`, `php-open-source-saver/jwt-auth`, `firebase/php-jwt` |
| Custom | `Auth::viaRequest`, middleware reading headers. Review carefully (see `authentication.md`). |

Unprotected routes: list `routes/api.php` routes without `auth:*` middleware (`php artisan route:list --path=api -v`) and confirm each is meant to be public.

## Sanctum

- Tokens are stored **SHA-256 hashed** in `personal_access_tokens`. The plaintext appears only once at creation. Investigate code that stores or logs `$token->plainTextToken`.
- **Abilities:** `createToken('name', ['orders:read'])` only matters if checked with `$request->user()->tokenCan('orders:write')` or `abilities:`/`ability:` middleware. Tokens created with `['*']` (the default) have all abilities. A finding exists when the design depends on scoped tokens but routes don't check abilities.
- **Expiration:** `config/sanctum.php` → `'expiration' => null` (default) means tokens never expire. Hardening for most apps. Medium for high-value APIs without revocation. Per-token expiry: `createToken(..., expiresAt: now()->addDays(7))`. Prune with `sanctum:prune-expired`.
- **Logout/revocation:** `$request->user()->currentAccessToken()->delete()`. Password change should revoke tokens (`$user->tokens()->delete()`) where appropriate.
- **Token prefix** (`SANCTUM_TOKEN_PREFIX`) helps secret scanners detect leaked tokens. Hardening.
- **Stateful domains:** `SANCTUM_STATEFUL_DOMAINS` must contain only first-party front-ends (see `csrf.md`, `sessions.md`).
- Mobile/SPA clients storing tokens in `localStorage`: front-end concern. Note as Informational with the XSS dependency.

## Passport

- Keys: `storage/oauth-private.key` must not be committed (often in `.gitignore`; check history) and should be loaded from env (`PASSPORT_PRIVATE_KEY`) in production.
- Grants: the password grant and implicit grant are legacy (OAuth 2.0 Security BCP discourages both). Recent Passport versions require explicit enabling (`Passport::enablePasswordGrant()` / `enableImplicitGrant()`). Investigate their use for third-party clients.
- Public clients (SPA/mobile) must use authorization code **with PKCE**.
- `Passport::hashClientSecrets()`: client secrets hashed at rest. Hardening.
- Lifetimes: `Passport::tokensExpireIn()`, `refreshTokensExpireIn()`, `personalAccessTokensExpireIn()`. Very long lifetimes → Hardening.
- Scopes: defined with `Passport::tokensCan()` and enforced with `scopes:`/`scope:` middleware or `tokenCan()`. Defined but unenforced scopes are a finding when the authorization design relies on them.
- Redirect URIs: exact-match registration. Wildcard or user-supplied redirect URIs leak codes.

## JWT packages

- `JWT_SECRET` committed, weak, or shared across environments → High.
- Algorithm: HS256 with a strong secret, or RS256/ES256 with key files. Check the library doesn't accept `none` or algorithm switching (keep libraries updated; pin allowed algorithms when verifying with `firebase/php-jwt` by passing a `Key` with an explicit algorithm).
- Logout: stateless JWTs remain valid until expiry. Check the blacklist/denylist is enabled if logout must be immediate, and that `JWT_TTL` is short with refresh rotation.
- Claims: check `exp`, `nbf`, `iss`/`aud` validation where tokens cross services.

## Excessive data exposure

```php
return User::all();                     // every attribute not in $hidden
return $request->user();                // includes columns added later (api_key, stripe_id, two_factor_secret if not hidden)
return response()->json($order->load('user', 'payments'));
return Post::with('author')->paginate();  // author's email, phone...
```

- Models serialize all attributes except `$hidden`. Columns added later aren't hidden automatically. Check `$hidden` covers `password`, `remember_token`, `two_factor_secret`, `two_factor_recovery_codes`, API keys, tokens, PII not meant for clients.
- Prefer **API Resources** (`JsonResource`) with explicit fields, plus `$this->when(...)` / `whenLoaded` for conditional data.
- Inertia shared props (`HandleInertiaRequests::share`) and Livewire public properties are also client-visible.
- Error responses: validation errors are fine. Exception messages with SQL or paths come from debug mode (see `secrets-config.md`).

Severity: exposing password hashes, tokens or 2FA secrets → High. PII of other users → High. Own data with extra internal fields → Low.

## Resource consumption

- `->paginate($request->input('per_page'))` / `->limit($request->limit)` without a maximum → bulk scraping and DoS. Clamp with `min((int) $request->per_page, 100)` or validate `max:100`.
- `->get()` on unbounded queries in API endpoints.
- Expensive endpoints (exports, reports, search, AI calls, SMS/email sending) without `throttle`.
- `with()` / `include` parameters from the client loading arbitrary relations (spatie/laravel-query-builder `allowedIncludes()` restricts this).
- Batch endpoints accepting unbounded arrays (`'ids' => 'array'` with no `max:`).

## Webhooks

- Every webhook route must verify the provider's signature **before** acting:
  - **Stripe / Cashier:** Cashier's webhook controller applies `VerifyWebhookSignature` when the webhook secret (`STRIPE_WEBHOOK_SECRET` → `cashier.webhook.secret`) is configured. **If it's not set, signatures aren't checked.** Confirm the env var exists in production config. Custom Stripe handlers must use `\Stripe\Webhook::constructEvent($payload, $sigHeader, $secret)`.
  - spatie/laravel-webhook-client: `signing_secret` and `signature_validator` per config entry.
  - GitHub (`X-Hub-Signature-256`), Twilio, Paddle, Shopify, Slack: HMAC check with `hash_equals`.
- Unverified webhook that changes payment, subscription or order state → **Critical/High** (free upgrades, fake payments).
- Replay protection: timestamp tolerance (Stripe's default is 300 seconds), and idempotency by event ID.
- Webhook routes excluded from CSRF are expected (see `csrf.md`).

## Signed URLs

- `URL::signedRoute` / `temporarySignedRoute` plus the `signed` middleware (or `$request->hasValidSignature()`). Routes generating signed URLs but not validating them are a finding.
- `hasValidSignatureWhileIgnoring([...])`: the ignored parameters can be tampered with. Check they're not security relevant.
- `signed:relative`: signature excludes the host. Fine, but note it.
- Signed URLs depend on `APP_KEY` secrecy.

## Broadcasting and real-time

- `routes/channels.php`: each private and presence channel callback must authorize the specific resource (see `authorization.md`). Public `Channel` broadcasts are visible to anyone. Check that events broadcasting sensitive data use `PrivateChannel`.
- Event `broadcastWith()`: limit the payload. By default all public properties of the event are broadcast, including full models.
- Reverb/Pusher app secrets in front-end code: only the **key** is public. `PUSHER_APP_SECRET` / `REVERB_APP_SECRET` must stay server-side.

## GraphQL (Lighthouse)

- Authentication via `@guard` and authorization via `@can*` directives on every sensitive field and mutation. Field-level exposure of hidden attributes.
- Query depth and complexity limits (`max_query_depth`, `max_query_complexity` in `config/lighthouse.php`). Introspection disabled in production if the schema is not public (Hardening).
- Batch queries for brute force (multiple login mutations in one request) bypass per-request throttles.

## Verification

```php
it('requires the orders:write ability', function () {
    Sanctum::actingAs(User::factory()->create(), ['orders:read']);
    $this->postJson('/api/orders', [...])->assertForbidden();
});

it('caps page size', function () {
    Sanctum::actingAs(User::factory()->create());
    Post::factory()->count(150)->create();
    $this->getJson('/api/posts?per_page=100000')->assertJsonCount(100, 'data');
});

it('does not leak sensitive attributes', function () {
    Sanctum::actingAs($user = User::factory()->create());
    $this->getJson('/api/user')->assertJsonMissingPath('password')
        ->assertJsonMissingPath('two_factor_secret')->assertJsonMissingPath('remember_token');
});

it('rejects unsigned stripe webhooks', function () {
    config(['cashier.webhook.secret' => 'whsec_test']);
    $this->postJson('/stripe/webhook', ['type' => 'invoice.paid'])->assertForbidden();
});
```

References: OWASP API Security Top 10 (2023); OAuth 2.0 Security Best Current Practice (RFC 9700); CWE-200, CWE-285, CWE-345, CWE-770, CWE-799; https://laravel.com/docs/sanctum, /passport, /eloquent-resources, /broadcasting#authorizing-channels, /billing#handling-stripe-webhooks.
