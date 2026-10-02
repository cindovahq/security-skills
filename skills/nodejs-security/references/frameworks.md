# Node.js — Framework Differences (Express, Fastify, Koa, Hono, node:http)

## Contents
- Quick comparison
- Express 4 → 5 security-relevant changes
- Fastify 5
- Koa 3
- Hono 4 on Node
- Plain `node:http`
- Out of scope

Use this file to translate the generic guidance in the other references to the framework in front of you. Versions checked against npm and source on 2026-10-02: Express 5.2.1 / 4.22.3, Fastify 5.12.5, Koa 3.2.1, Hono 4.13.12, `@hono/node-server` 2.1.3.

## Quick comparison

| Concern | Express | Fastify 5 | Koa 3 | Hono 4 (Node) |
|---|---|---|---|---|
| Body parsing | opt-in `express.json()` etc. (100kb) | built-in JSON + text (1 MiB `bodyLimit`) | none built in (`@koa/bodyparser`, `koa-body`) | `c.req.json()`/`parseBody()` on demand, no size limit unless `hono/body-limit` |
| `__proto__`/`constructor` keys in JSON | kept as own props | rejected by default (`onProtoPoisoning`/`onConstructorPoisoning: 'error'`) | parser-dependent | kept (`JSON.parse`) |
| Input validation | none | JSON Schema (AJV) per route | none | `hono/validator`, `@hono/zod-validator` |
| Output filtering | none | response schema serializes only declared props | none | none |
| Proxy trust | `trust proxy` (false) | `trustProxy` (false) | `app.proxy` (false) | manual (`getConnInfo`) |
| Default 500 body | stack trace unless `NODE_ENV=production` | `err.message` | status text unless `err.expose` | `Internal Server Error` text |
| Async errors | Express 4 not caught; Express 5 caught | caught | caught (`await next()`) | caught (`app.onError`) |
| CSRF / headers | none / none | plugins | packages | `hono/csrf`, `hono/secure-headers` |

## Express 4 → 5 security-relevant changes

From the official migration guide and source:
- **Routing (path-to-regexp 8):** wildcards must be named (`/*splat`), optional segments use braces (`/:file{.:ext}`), regex characters in paths are no longer supported. An upgrade that rewrote `app.get('/admin*', auth)` patterns incorrectly can leave routes unprotected; re-check prefix middleware after migrations.
- **`query parser` default `'simple'`** (no nested objects) and `express.urlencoded` `extended: false` by default. Express 4 apps upgraded with `app.set('query parser', 'extended')` keep the old NoSQL-operator exposure. See `input-validation.md`.
- **`req.body` stays `undefined`** when no parser matched (`{}` in Express 4 with body-parser mounted). Code like `if (req.body.isAdmin)` throws instead of passing; `const { role = 'user' } = req.body` throws on `undefined`.
- **Rejected promises from handlers/middleware go to the error handler** (Express 4: unhandled rejection).
- **Removed:** `req.param()`, `res.redirect('back')` / `res.location('back')` (use `req.get('Referrer')` with validation), `app.del()`, `res.sendfile()` (lowercase).
- **`express.static` `dotfiles` default `'ignore'` also covers files inside dot-directories** (Express 4 served them). `.well-known` needs explicit `dotfiles: 'allow'` on that mount only.
- `res.status()` only accepts integers 100–999; `res.clearCookie` ignores `maxAge`/`expires`.
- Node 18+ required.

Express 5 is current. Express 4 is in maintenance with a published end-of-life goal of no sooner than 2026-10-01 (a goal, not a commitment); check the Express release policy for its current status. Express 3 and older are EOL.

## Fastify 5

- **Validation and serialization:** `schema: { body, querystring, params, headers, response }`. Fastify's AJV defaults include `removeAdditional: true` (strips undeclared props only when the schema says `additionalProperties: false`), `coerceTypes: 'array'`, `useDefaults: true`. Routes without a `body` schema accept anything. Response schemas filter output; a missing one leaks full objects.
- **Content-type parsers:** `addContentTypeParser` with a custom parser bypasses Fastify's safe JSON parsing; check it uses `secure-json-parse` or rejects proto keys. `@fastify/formbody` and `@fastify/multipart` have their own limits.
- **Encapsulation:** hooks and decorators registered inside a plugin apply to that plugin's routes only. Auth hooks registered in a sibling plugin don't protect routes (see `authorization.md`).
- **Defaults to review:** `trustProxy: false` (numeric hop-count values are ignored in Fastify 5: it fails closed and trusts no proxy, so `request.ip` is the socket address), `bodyLimit: 1 MiB`, `requestTimeout: 0` and `connectionTimeout: 0` (set when not behind a proxy), `maxParamLength: 100`, `allowUnsafeRegex: false` for route regex constraints.
- **Logging:** the default pino request serializer logs method, URL (including query string), host and remote address, not headers. Custom `logger.serializers` that add headers or bodies need `redact` for `authorization`, `cookie` and secrets; tokens in query strings end up in logs either way.
- Plugins: `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/csrf-protection`, `@fastify/cookie`, `@fastify/session`/`@fastify/secure-session`, `@fastify/static` (needs `root`), `@fastify/jwt` (its README says all algorithms are accepted by default; pin them with `verify: { algorithms: [...] }`).
- Fastify 4 reached end of LTS on 2025-06-30 (Fastify LTS doc); Fastify 5 supports Node 20+.

## Koa 3

- No body parser, router, CSRF or headers by default: everything comes from packages (`@koa/router`, `@koa/bodyparser`/`koa-body`, `koa-helmet`, `@koa/cors`, `koa-session`).
- `app.proxy` (default `false`), `proxyIpHeader`, `maxIpsCount` (0 = unlimited) control `ctx.ip`/`ctx.ips`/`ctx.protocol`.
- Errors: `ctx.throw(400, 'msg')` sets `expose: true` for 4xx; 5xx messages are hidden by the default handler. Custom `app.on('error')` handlers that write `err.stack` to `ctx.body` leak.
- `ctx.body = string` is sent as `text/html` when the string starts with `<`.
- `ctx.redirect(url)`: no validation. Koa 3 replaced `ctx.redirect('back')` with `ctx.back(alt)`, which only follows a `Referer` with the same host (the scheme isn't compared).
- `@koa/cors` with `credentials: true` reflects any origin unless `origin` is restricted (see `csrf-cors.md`).
- Koa 3 requires Node ≥ 18.
- Middleware order: code after `await next()` runs after downstream handlers; auth checks must come before `await next()`.

## Hono 4 on Node

- Served through `@hono/node-server` (`serve({ fetch: app.fetch })`). Node `http` server timeouts apply; `serve()` returns the Node server, so set `requestTimeout`/`headersTimeout` on it.
- Built-in middleware: `hono/cors`, `hono/csrf` (Origin/Sec-Fetch-Site for form content types), `hono/secure-headers`, `hono/jwt` (requires explicit `alg` since 4.11.4, CVE-2026-22817), `hono/jwk`, `hono/basic-auth`, `hono/bearer-auth`, `hono/body-limit`, `hono/ip-restriction`, `hono/timeout`.
- `c.req.json()` uses `JSON.parse` (proto keys kept); `c.req.parseBody({ dot: true })` builds nested objects (unbounded nesting was a 2026 DoS advisory, GHSA-g6gw-c38x-mqfc). Validate with `zValidator`.
- `c.html()` doesn't escape; the `html` tagged template escapes interpolations, `raw()` doesn't. Hono JSX escapes strings (a 2026 advisory, GHSA-hxh3-vqpv-xpqv, covered unescaped strings in some boundary components: keep Hono current).
- Hono publishes advisories frequently (CORS ReDoS, `serveStatic` double-decoding, query parser differentials in 2026). Treat an old Hono version as a dependency finding and run `npm audit`.

## Plain `node:http`

- Nothing is parsed or limited for you: count bytes while reading the body and stop at a limit; set `server.requestTimeout`/`headersTimeout` deliberately.
- `new URL(req.url, 'http://localhost')` for parsing. Don't make security decisions with the legacy `url.parse()`: it parses differently from WHATWG `URL`, and Node marks it deprecated (DEP0169).
- Header values with CR/LF throw `ERR_INVALID_CHAR`, which crashes the process if not caught in a raw handler.
- `req.headersDistinct` with a `__proto__` header name crashed handlers on unpatched Node (CVE-2026-21710, March 2026 releases).

## Out of scope

- **Next.js** route handlers, middleware and server actions → `nextjs-security` skill.
- **NestJS** guards, pipes and interceptors (built on Express or Fastify) → `nestjs-security` skill. Generic Express/Fastify findings in a Nest app still apply.
- Supabase/Edge runtimes → `supabase-security` skill.
