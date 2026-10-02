# Authentication, Sessions and Tokens

## Contents
- Credentials and password storage
- Login, brute force and enumeration
- Account recovery
- MFA and passkeys
- Sessions (cookie-based)
- Tokens (JWT, opaque, API keys)
- OAuth 2.0 / OIDC / social login
- Managed auth providers
- Verification

## Credentials and password storage

**Expected:** a slow, salted password hash: Argon2id, scrypt, bcrypt (cost ≥ 10), or PBKDF2 with high iterations. Via framework helpers: `password_hash`, `bcrypt`/`argon2` packages, Django `make_password`, Spring `PasswordEncoder`, ASP.NET Identity `PasswordHasher`, Devise.

**Findings:**
- MD5/SHA-1/SHA-256 (even salted) or unsalted hashes for passwords → High (CWE-916).
- Reversible encryption or plaintext storage → Critical/High.
- Comparing hashes with `==` instead of the library's verify function.
- bcrypt truncation: inputs > 72 bytes are truncated. Pre-hashing with a fast hash without encoding issues, or concatenating secrets before bcrypt, can weaken it.
- Passwords in logs, analytics, error trackers, URLs or emails.

## Login, brute force and enumeration

- Rate limiting / lockout on login, OTP, password reset, registration, and any "verify code" endpoint. Key by account **and** IP. Beware IP keys behind proxies that trust `X-Forwarded-For` from anyone.
- Generic errors for wrong user vs wrong password. Comparable timing (perform a dummy hash for unknown users).
- Credential-stuffing defenses for public apps: breached-password checks (HIBP k-anonymity), bot protection, MFA.
- Login endpoints added for mobile/API clients often lack the throttling the web login has. Check every login path.
- Auth bypass patterns: `login(userId)` reachable from input, "remember me" cookies containing raw user IDs, debug backdoors (`if password == "master"`), feature flags that skip auth in non-prod but are mis-set in prod, auth middleware skipped for path variants (`/admin` vs `/admin/` vs `/ADMIN`, `;` path params, URL-encoded slashes).

## Account recovery

- Reset tokens: CSPRNG, ≥ 128 bits, stored hashed, single-use, short expiry (≤ 1 hour), invalidated on use and on password change.
- **Host-header poisoning:** reset links built from the request `Host` / `X-Forwarded-Host` → token sent to an attacker domain. Use a configured base URL.
- Reset must not log the user in on a different account (token lookup by token, not by a client-supplied user ID).
- Security questions, SMS-only recovery for high-value accounts, and email change without re-authentication are weak.
- After reset or password change: revoke other sessions and refresh tokens (at least offer it).

## MFA and passkeys

- TOTP secrets stored encrypted. Verification throttled (6 digits = 10⁶ space). Codes single-use within their window if replay matters.
- Recovery codes hashed, single-use.
- MFA enforced on **every** auth path (API token creation, OAuth, "remember device" cookies, password reset → auto-login).
- Enabling/disabling MFA and changing email or password require recent re-authentication.
- WebAuthn/passkeys: RP ID and allowed origins fixed to production domains. Challenge random, single-use, server-stored. User-verification policy matches risk.

## Sessions (cookie-based)

- Session ID: framework-generated, ≥ 128 bits of entropy, **regenerated on login and privilege change** (fixation, CWE-384). Many frameworks regenerate automatically on their standard login call, so check before reporting.
- Cookie flags: `Secure`, `HttpOnly`, `SameSite=Lax` or `Strict` (`None` only with a reason, and then CSRF protection matters more), narrowest `Domain` and `Path`. A `__Host-` prefix is ideal.
- Timeouts: idle and absolute. Proportionate to risk.
- Logout invalidates the server-side session (not just deleting the cookie client-side). For JWT-in-cookie designs, logout needs a denylist or short expiry.
- Session data stored client-side (signed cookies) can't be revoked. Note it for high-risk apps.
- Session stores (Redis, DB) not exposed and authenticated.

## Tokens (JWT, opaque, API keys)

**JWT verification:**
- Algorithm pinned on verify (reject `none`; no RS/HS confusion: never verify RS256 tokens with the public key as an HMAC secret).
- Signature always verified (`jwt.decode` without verify, `verify=False`, `ignoreExpiration: true` → Critical/High).
- `exp` enforced with small clock skew. `iss`/`aud` checked when tokens cross services.
- Secrets: strong (≥ 256-bit random for HS256), not committed, not shared across environments. `kid`/`jku`/`x5u` headers not used to fetch keys from attacker-controlled URLs or file paths.
- Sensitive data not placed in JWT payloads (they're only base64-encoded).

**Lifecycle:**
- Short-lived access tokens with refresh-token rotation and reuse detection.
- Revocation path for logout, password change and compromise.
- Storage: browser `localStorage` is readable by any XSS. HttpOnly cookies avoid that but need CSRF defenses. State the trade-off; don't treat either as automatically a vulnerability.

**API keys:**
- Random, prefixed (for secret scanning), stored hashed, scoped, revocable, compared with constant-time functions.
- Not in URLs (they leak via logs and referrers).

## OAuth 2.0 / OIDC / social login

- Authorization code flow **with PKCE** for public clients (SPA, mobile). Implicit and password grants are deprecated (RFC 9700).
- `state` parameter (or PKCE plus nonce) validated to prevent login CSRF. OIDC `nonce` validated for ID tokens.
- Redirect URIs registered exactly. No wildcard or open-redirect-based bypass.
- ID token signature, `iss`, `aud`, `exp` verified by a maintained library.
- **Account linking:** don't link or log in by email unless the provider asserts the email is verified (`email_verified=true`). Otherwise an attacker registers the victim's email at a lax IdP → account takeover.
- Client secrets server-side only. Tokens from the provider not exposed to the front-end unnecessarily.

## Managed auth providers

Auth0, Clerk, Cognito, Firebase Auth, Supabase Auth, WorkOS, Keycloak:
- The backend must **verify** the provider's token/session on every request (SDK middleware), not trust a client-sent user ID.
- Check that authorization (roles, tenant) comes from verified claims or server-side lookups, not client-editable metadata (e.g. Supabase `user_metadata` is user-editable, while `app_metadata` isn't; Firebase custom claims are set server-side).
- Webhook endpoints from the provider are signature-verified.

## Verification

- Tests: login throttling triggers; session ID changes on login; logout invalidates server session; expired/tampered/`alg:none` JWTs rejected; reset token single-use and expiring; cross-account reset impossible.
- Manual (staging): inspect `Set-Cookie` flags; replay a logged-out session cookie (expect rejection).

References: OWASP Authentication, Session Management, Password Storage, Forgot Password, MFA, JSON Web Token (Java) Cheat Sheets; RFC 9700 (OAuth 2.0 Security BCP); RFC 8725 (JWT BCP); NIST SP 800-63B; CWE-287, CWE-307, CWE-384, CWE-521, CWE-613, CWE-640, CWE-916, CWE-347.
