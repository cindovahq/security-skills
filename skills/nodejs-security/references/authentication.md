# Node.js — Authentication

## Contents
- Where authentication lives in Node apps
- Password storage
- Login, registration and reset flows
- JWT verification
- Passport
- Brute force and rate limiting
- False positives
- Verification

Node frameworks ship no authentication. Every app assembles it from packages (Passport, express-session, jsonwebtoken, jose, bcrypt/argon2, a hosted IdP SDK) or hand-written middleware. Read the code that actually runs; don't assume a library's defaults are in use.

## Where authentication lives in Node apps

Find the middleware that sets the identity (`req.user`, `req.session.userId`, `res.locals.user`, `request.user` in Fastify, `ctx.state.user` in Koa, `c.get('jwtPayload')` / `c.set('user', ...)` in Hono), then every place that reads it. Search: `req.user`, `session.userId`, `isAuthenticated`, `passport.authenticate`, `jwt.verify`, `jwt.decode`, `jwtVerify`, `Authorization`, `x-api-key`, `preHandler`, `onRequest`.

**Investigate:**
- Identity taken from something the client controls without verification: `req.headers['x-user-id']`, `req.cookies.userId` (unsigned), `req.query.userId`, a JWT read with `jwt.decode()`.
- API keys compared with `==`/`===` (timing) or against a value that can be `undefined` (`req.headers['x-api-key'] === process.env.API_KEY` passes when both are `undefined`). Use a non-empty check plus `crypto.timingSafeEqual` on equal-length buffers.
- Auth middleware that calls `next()` on error paths (`catch (e) { next(); }`) or treats a verification failure as "anonymous" and later code assumes a user.

## Password storage

| Algorithm | Guidance (OWASP Password Storage Cheat Sheet) |
|---|---|
| Argon2id (`argon2` package) | First choice. Minimum m=19 MiB, t=2, p=1. |
| scrypt (`node:crypto` `scrypt`) | If Argon2id is unavailable. N=2^17, r=8, p=1. |
| bcrypt (`bcrypt`, `bcryptjs`) | Work factor ≥ 10. **Input is limited to 72 bytes**; longer passwords are truncated, so enforce a max length or pre-hash deliberately. |
| PBKDF2-HMAC-SHA256 | 600,000 iterations (FIPS contexts). |

Findings: `md5`/`sha1`/`sha256` of the password (with or without salt) → **High**. Plaintext or reversible encryption → **Critical/High**. Comparing a hash with `===` against a hash you computed is fine for slow hashes via the library's `compare`/`verify`; a custom compare of raw digests should use `timingSafeEqual`.

## Login, registration and reset flows

- **Registration mass assignment:** `INSERT ... VALUES (..., req.body.role)`, `User.create(req.body)`, `{ ...req.body }` into an ORM. Any client-settable `role`, `isAdmin`, `emailVerified`, `tenantId` → **Critical/High** privilege escalation. See `input-validation.md`.
- **Reset and verification tokens** must come from `crypto.randomBytes(32)` / `crypto.randomUUID()` (for identifiers) and be stored hashed, single-use and short-lived. `Math.random()`, `Date.now()`, `uuid` v1 or sequential IDs as secrets → **High** (CWE-338).
- **Reset link host:** links built from `req.headers.host`, `req.hostname` or `req.host` are poisonable with a forged `Host` or, with permissive `trust proxy`, `X-Forwarded-Host`. Build links from a configured `APP_URL`.
- **User enumeration** through different messages or timing: Low/Informational unless the business context makes it sensitive.
- **Session handling after login** (regenerate, logout): see `sessions-cookies.md`.
- **MFA:** OTP checks must be rate-limited and bound to the pending login; a "remember device" cookie must be signed and server-verifiable.

## JWT verification

**`jsonwebtoken` (9.x):**
- `jwt.decode(token)` **does not verify the signature**. Its README says not to use it for untrusted tokens. Any authorization decision based on `decode` → **Critical**.
- `jwt.verify(token, key)` without `algorithms`: v9 derives the allowed list from the key type (HS* for a secret, RS/PS for RSA keys, ES for EC keys) and rejects HS* with a public key. Still pin `algorithms: ['RS256']` (or the one you issue) explicitly. Versions before 9.0.0 had weaker defaults (CVE-2022-23540 et al.): report `< 9` as a dependency finding.
- Tokens without `exp` never expire. `verify` only checks `exp` if present; issue tokens with `expiresIn` and pass `maxAge` when you need a hard cap. `ignoreExpiration: true` → finding.
- Check `audience`/`issuer` when the same key signs tokens for different purposes (email verification vs session).

**`jose` (6.x):** `jwtVerify(token, key, { algorithms, issuer, audience })`. It refuses unsecured (`alg: none`) tokens; those need the separate `UnsecuredJWT` API. Use `createRemoteJWKSet` for IdP keys and still pass `algorithms`.

**Secrets:** HS256 secrets must be long random values from the environment. Hardcoded or fallback secrets (`process.env.JWT_SECRET || 'secret'`) → **Critical** when the fallback can be reached in production; see `secrets-config.md`.

**Hono:** `hono/jwt` middleware requires an explicit `alg` since 4.11.4 (CVE-2026-22817 was algorithm confusion from an unsafe default). Older Hono → upgrade.

## Passport

- `passport.authenticate('local', ...)` then `req.login()`. Since **Passport 0.6.0**, `req.login()` and `req.logout()` regenerate the session (fix for session fixation CVE-2022-25896), and `req.logout()` requires a callback. `< 0.6.0` → dependency finding plus a fixation risk.
- `keepSessionInfo: true` copies the old session data into the new session. That's fine for a return-to URL, but not for anything an attacker could pre-seed.
- Custom `verify` callbacks: check they compare the password with the hash library and don't return a user on lookup errors.
- OAuth strategies: `state: true` (or PKCE) should be on; account linking by unverified email from the IdP → account takeover.

## Brute force and rate limiting

- Login, OTP, reset, registration, and any expensive or paid endpoint (email, SMS, AI calls) need a limiter. `express-rate-limit` defaults to a 60-second window and `limit: 5` (v8); check the configured values.
- IP-keyed limiters are only as good as `req.ip`. With `app.set('trust proxy', true)`, `req.ip` is the left-most `X-Forwarded-For` value, which the client controls, so the limiter is bypassable (**Medium**, High on OTP). express-rate-limit logs `ERR_ERL_PERMISSIVE_TRUST_PROXY` for this case. See `secrets-config.md` for correct `trust proxy` values.
- The default memory store is per process. In a cluster or multiple containers, limits multiply. Use a shared store (Redis, etc.) for security-relevant limits.
- Also key on the account (username/email) for credential-stuffing protection.

## False positives

- `jwt.decode()` used only to read `kid`/`iss` **before** a `verify` with a key chosen from an allow-list.
- Passport ≥ 0.6 `req.login()` with no explicit `req.session.regenerate()`: Passport already regenerates.
- `bcrypt.compare` result checked with `if (!ok)`: that is the correct API, not a timing issue.

## Verification

```js
// jwt.decode bypass: an unsigned token must be rejected
const forged = Buffer.from('{"alg":"none"}').toString('base64url') + '.' +
  Buffer.from('{"sub":"1","role":"admin"}').toString('base64url') + '.';
await request(app).get('/api/admin/users').set('Authorization', `Bearer ${forged}`).expect(401);

// Registration ignores role
const res = await request(app).post('/register').send({ email: 'a@test.local', password: 'x'.repeat(12), role: 'admin' });
expect((await db.query('select role from users where email=$1', ['a@test.local'])).rows[0].role).toBe('member');
```

References: OWASP Authentication, Password Storage, JWT for Java (concepts apply) Cheat Sheets; CWE-287, CWE-307, CWE-338, CWE-347, CWE-640, CWE-916; https://github.com/auth0/node-jsonwebtoken, https://github.com/panva/jose, https://www.passportjs.org/, https://express-rate-limit.mintlify.app/.
