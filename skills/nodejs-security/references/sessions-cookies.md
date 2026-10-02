# Node.js — Sessions and Cookies

## Contents
- express-session configuration
- Session fixation and privilege changes
- Logout
- cookie-parser and signed cookies
- Client-side session stores and tokens in cookies
- Fastify, Koa and Hono equivalents
- False positives
- Verification

## express-session configuration

Read the `session({...})` call and the env values it uses. Defaults from express-session 1.19 source:

| Option | Default | Review |
|---|---|---|
| `secret` | none (deprecation warning; falls back to `req.secret` from cookie-parser, else errors) | Must be a long random value from the environment. Hardcoded strings, README examples (`'keyboard cat'`) or `process.env.X \|\| 'fallback'` → **High/Critical**: anyone who knows it can forge signed session-ID cookies. Arrays support rotation (first signs, all verify). |
| `name` | `connect.sid` | Fingerprinting only. Not a finding. |
| `store` | `MemoryStore` | Leaks memory and isn't shared across processes; the package logs a warning when `NODE_ENV=production`. Reliability/DoS issue; Low/Hardening. |
| `cookie.httpOnly` | `true` | `false` → JS can read the session cookie; XSS becomes session theft. |
| `cookie.secure` | `false` (not set) | Should be `true` (or `'auto'`) in production. With `secure: true`, the cookie is only set when the request is seen as HTTPS: behind a TLS-terminating proxy you need `app.set('trust proxy', ...)` or `proxy: true`, otherwise login "silently" doesn't persist. |
| `cookie.sameSite` | not set | Set `'lax'` (or `'strict'`). Browsers differ in how they treat a missing attribute, so don't rely on browser defaults for CSRF defense. `'none'` requires `secure`. |
| `cookie.maxAge` / `expires` | none (browser-session cookie) | Pick an idle/absolute lifetime; `rolling: true` extends on activity. |
| `cookie.domain` | not set (host-only) | `.example.com` shares the session with every subdomain. |
| `resave` | `true` (deprecated default) | Set explicitly; `false` for most stores. |
| `saveUninitialized` | `true` (deprecated default) | `false` avoids creating sessions (and cookies) for anonymous visitors, which reduces store-flooding DoS and helps consent rules. |
| `proxy` | `undefined` (uses Express `req.secure`) | `true` trusts `X-Forwarded-Proto` directly from any client. |

## Session fixation and privilege changes

express-session does **not** regenerate the ID on login by itself. Custom login code must call `req.session.regenerate()` before storing identity:

```js
// Vulnerable: identity written into the pre-login session
req.session.userId = user.id;

// Fixed
req.session.regenerate((err) => {
  if (err) return next(err);
  req.session.userId = user.id;
  req.session.save((err) => (err ? next(err) : res.redirect('/dashboard')));
});
```

- No `regenerate` after login in custom code → **Medium** (High if session IDs can be planted: subdomain cookie tossing, sessions accepted from URLs or headers).
- Also regenerate on privilege changes: role switch, impersonation start/stop, step-up auth ("sudo mode"), tenant switch.
- Passport ≥ 0.6 regenerates in `req.login()`; see `authentication.md`.

## Logout

```js
req.session.destroy((err) => {
  res.clearCookie('connect.sid'); // match name/path/domain options
  res.redirect('/');
});
```

`req.session.userId = null` or `delete req.session.user` leaves other session data (and the ID) alive. Usually **Low**; **Medium** if privileged flags remain. Logout via `GET` is CSRF-able (Low). Express 5 `res.clearCookie` ignores `maxAge`/`expires` options; pass the same `path`/`domain` used to set it.

Server-side revocation matters for "log out everywhere" and password changes: store sessions in a store you can query by user, or keep a per-user session version.

## cookie-parser and signed cookies

- `cookieParser(secret)` puts verified signed cookies (`s:` prefix) in `req.signedCookies`; a tampered one becomes `false`. Unsigned cookies stay in `req.cookies`. Code that reads `req.cookies.role` instead of `req.signedCookies.role` trusts client input.
- Signed ≠ encrypted: the value is readable by the client. Don't put secrets or PII in it.
- Authorization data in cookies (role, userId, plan) should be server-side state, or a signed and expiring token checked on every request.
- Same secret rules as sessions: no hardcoded or shared fallback values.

## Client-side session stores and tokens in cookies

- `cookie-session` (whole session in a signed cookie) can't be revoked server-side and replays until the signature keys rotate. Fine for low-risk apps; note it for high-risk ones.
- JWTs in cookies: set `HttpOnly`, `Secure`, `SameSite`, and treat the app as cookie-authenticated for CSRF purposes (see `csrf-cors.md`).
- JWTs in `localStorage`: any XSS can exfiltrate them. Hardening note, raised to Medium when the app has XSS findings.
- Never deserialize cookie contents with code-executing serializers (`node-serialize`, `funcster`, `eval`). See `injection.md`.

## Fastify, Koa and Hono equivalents

- Fastify: `@fastify/cookie` (signing via `secret`, `request.unsignCookie()`), `@fastify/session` or `@fastify/secure-session` (encrypted client-side, needs a 32-byte key). Same review points: secret source, `cookie.secure`, `sameSite`, `regenerate()` on login.
- Koa: `ctx.cookies.set(name, value, { signed: true })` signs with `app.keys`; missing `app.keys` with `signed: true` throws. `koa-session` stores the session in a cookie by default unless a `store` is configured.
- Hono: `hono/cookie` `setSignedCookie`/`getSignedCookie`; options mirror cookie attributes. No built-in server-side session.

## False positives

- No explicit `regenerate()` when Passport ≥ 0.6 `req.login()` performs the login.
- `cookie.secure: false` in a development-only config branch that production does not use. Confirm the production branch.
- `MemoryStore` in tests or local scripts.

## Verification

```js
it('issues a new session id at login', async () => {
  const agent = request.agent(app);
  const before = (await agent.get('/login')).headers['set-cookie']?.[0];
  const after = (await agent.post('/login').type('form').send(validCreds)).headers['set-cookie']?.[0];
  expect(after).toBeDefined();
  expect(after.split(';')[0]).not.toBe(before?.split(';')[0]);
});
it('sets hardened cookie attributes', async () => {
  const c = (await request(app).post('/login').type('form').send(validCreds)).headers['set-cookie'][0];
  expect(c).toMatch(/HttpOnly/i); expect(c).toMatch(/SameSite=Lax/i);
});
```

```bash
curl -sk -D - -o /dev/null -d 'email=a@test.local&password=...' https://staging.example.com/login | grep -i set-cookie
```

References: OWASP Session Management Cheat Sheet; CWE-384, CWE-614, CWE-1004, CWE-565, CWE-613; https://github.com/expressjs/session, https://github.com/expressjs/cookie-parser, https://koajs.com/#app-keys-.
