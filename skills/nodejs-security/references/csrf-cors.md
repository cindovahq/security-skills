# Node.js — CSRF and CORS

## Contents
- When CSRF applies
- CSRF options in Node apps
- What to investigate (CSRF)
- CORS with the `cors` package
- What to investigate (CORS)
- Fastify, Koa and Hono
- False positives
- Verification

## When CSRF applies

CSRF matters whenever the browser attaches credentials automatically: session cookies (express-session, cookie-session), JWTs stored in cookies, HTTP Basic auth, or client certificates. APIs authenticated only by an `Authorization: Bearer` header set by JavaScript are not CSRF-able (the attacker's page cannot set that header cross-origin without a CORS grant).

None of Express, Fastify or Koa include CSRF protection. Hono ships `hono/csrf` (Origin and `Sec-Fetch-Site` checks).

## CSRF options in Node apps

- **`csurf` is deprecated and archived** (npm deprecation notice). Existing use still works but gets no fixes; flag it as a dependency/hardening item and recommend a replacement.
- **`csrf-csrf`** (double-submit cookie, v4): `doubleCsrf({ getSecret, getSessionIdentifier, ... })` gives `doubleCsrfProtection` and `generateCsrfToken(req, res)`. Default cookie name uses the `__Host-` prefix, and `GET`/`HEAD`/`OPTIONS` are ignored. `getSessionIdentifier` must return a per-session value (e.g. `req.session.id`) so tokens are bound to the session.
- **`csrf-sync`** (synchronizer token stored in the session) for express-session apps.
- **Origin / Fetch Metadata checks:** reject state-changing requests whose `Origin` (or `Sec-Fetch-Site`) isn't your own origin. A good primary or secondary defense; make sure requests without `Origin` are handled deliberately (older clients, same-origin `GET` navigations).
- **`SameSite=Lax`/`Strict` session cookies:** strong defense-in-depth, but not a full control on its own: same-site attacks (a compromised or user-controlled subdomain) and state-changing `GET` routes still work, and `Lax` permits top-level `GET` navigations.

## What to investigate (CSRF)

- Cookie-authenticated app with no CSRF middleware and no Origin check on `POST`/`PUT`/`PATCH`/`DELETE` handlers → **Medium** (High for account email/password change, money movement, admin actions).
- State changes on `GET` (`/logout`, `/approve?id=`, `/delete/:id`): bypass every token scheme that ignores `GET`.
- CSRF middleware mounted after the routers it should protect, or only on some routers.
- Endpoints that accept `text/plain` or `application/x-www-form-urlencoded` and parse it as JSON (`express.text()` + `JSON.parse`, `express.json({ type: '*/*' })`): forms can send these cross-site without preflight.
- Method override (`method-override` with `_method` in body/query) turning a `POST` form into `DELETE`.
- Login CSRF: login form without a token lets an attacker sign the victim into the attacker's account (Low/Medium).
- `skipCsrfProtection` / ignore lists that cover more than webhook routes.

## CORS with the `cors` package

Behavior from `cors` 2.8 source:

| `origin` option | Result |
|---|---|
| unset / `'*'` (default) | `Access-Control-Allow-Origin: *`. Browsers refuse to expose credentialed responses with `*`, so this is safe for public, non-cookie APIs. |
| `'https://app.example.com'` | Fixed value; non-matching origins can't read responses. |
| `true` | **Reflects any request `Origin`.** With `credentials: true`, any website can make credentialed requests and read the responses → **High** for cookie-authenticated endpoints. |
| `RegExp` / array | `regex.test(origin)` or exact string match per entry. Unanchored or unescaped regexes are the usual bug. |
| function `(origin, cb)` | Whatever the callback decides; `cb(null, true)` for everything = reflection. |

## What to investigate (CORS)

```js
app.use(cors({ origin: true, credentials: true }));                // reflects everything
app.use(cors({ origin: /example\.com/, credentials: true }));       // matches example.com.attacker.net
app.use(cors({ origin: /^https:\/\/.*example.com$/ }));             // matches https://evil-example.com ('.' unescaped)
app.use(cors({ origin: (o, cb) => cb(null, o?.includes('example.com')) }));
```

- Allowing the `null` origin (sandboxed iframes, `file:` pages can send `Origin: null`).
- Trusting all subdomains when some are user-controlled or less trusted.
- Hand-rolled headers: `res.setHeader('Access-Control-Allow-Origin', req.headers.origin)` plus `Access-Control-Allow-Credentials: true`.
- Missing `Vary: Origin` with dynamic origins behind a shared cache (cache poisoning of CORS headers). The `cors` package adds it for non-`*` configurations.

**Fix:** an explicit allow-list of full origins (`['https://app.example.com']`), or an anchored, escaped regex (`/^https:\/\/([a-z0-9-]+\.)?example\.com$/`) only if every subdomain is trusted. Keep `credentials: true` only where cookies are really needed.

Severity: reflection with credentials on endpoints returning personal data or allowing actions → **High**. Without credentials, only data readable anyway by unauthenticated requests is exposed → usually not a finding (internal-network APIs are the exception).

## Fastify, Koa and Hono

- Fastify: `@fastify/cors` (`origin: true` also reflects); `@fastify/csrf-protection` (requires `@fastify/cookie` or a session plugin).
- Koa: `@koa/cors` 5.x defaults `origin` to `*`, but **when `credentials` is true and `origin` is `*` (including the default), it reflects the request `Origin`**. `cors({ credentials: true })` alone is therefore reflection with credentials → High for cookie-authenticated endpoints. Use an `origin(ctx)` function that returns only allow-listed origins.
- Hono: `hono/cors` (`origin` string, array or function); `hono/csrf` validates `Origin` (default: same origin as the request URL) or `Sec-Fetch-Site` (default `same-origin`) for form-type requests (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`). JSON requests rely on CORS preflight.

## False positives

- `cors()` with defaults on a bearer-token or public API: `*` without credentials.
- No CSRF tokens on an API that authenticates only with `Authorization` headers and never with cookies.
- Webhook routes without CSRF protection that verify a provider signature (Stripe, GitHub) over the raw body.

## Verification

```bash
curl -s -D - -o /dev/null -H 'Origin: https://evil.example' https://staging.example.com/api/me | grep -i '^access-control'
# Expect no Access-Control-Allow-Origin echoing evil.example together with Allow-Credentials: true
```

```js
it('rejects cross-site form posts', async () => {
  const agent = request.agent(app); await login(agent);
  await agent.post('/settings/email').set('Origin', 'https://evil.example').type('form').send({ email: 'x@evil.example' }).expect(403);
});
```

References: OWASP CSRF Prevention Cheat Sheet, WSTG-CLNT-07 (CORS); CWE-352, CWE-346, CWE-942; https://github.com/expressjs/cors, https://github.com/Psifi-Solutions/csrf-csrf, https://hono.dev/docs/middleware/builtin/csrf.
