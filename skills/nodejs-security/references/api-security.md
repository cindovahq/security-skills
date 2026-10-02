# Node.js — API Security, Resource Limits and Availability

## Contents
- Data exposure and output filtering
- Body, upload and parser limits
- Server timeouts and slow clients
- Crashes: unhandled rejections and thrown errors
- ReDoS and event-loop blocking
- Rate limiting and expensive endpoints
- Webhooks
- WebSockets and Socket.IO
- GraphQL
- False positives
- Verification

Node runs application code on one event loop per process. Anything that blocks it, or crashes the process, takes down every concurrent user, so availability bugs rate higher than in thread-per-request stacks.

## Data exposure and output filtering

- `res.json(user)` / `res.json(rows)` of whole DB rows or ORM documents: password hashes, reset tokens, MFA secrets, internal flags, other tenants' fields. Mongoose `select: false` on sensitive paths and `toJSON` transforms help; Prisma returns all scalar fields unless `select`/`omit` is used.
- **Fastify response schemas filter output:** with `schema.response[200]` defined, `fast-json-stringify` serializes only the declared properties (tested: an undeclared `passwordHash` was dropped). Routes without a response schema fall back to `JSON.stringify` of everything.
- Pagination: `limit=1000000` without a cap → data scraping and DoS. Clamp limits.
- Error messages and validation errors echoing internals (see `secrets-config.md`).
- Severity: secrets/hashes of other users exposed → **High**; own data only → Low.

## Body, upload and parser limits

| Parser | Default limit |
|---|---|
| Express `express.json()` / `urlencoded()` / `text()` / `raw()` (body-parser) | `'100kb'` |
| Express `urlencoded` `parameterLimit` | 1000 |
| Fastify `bodyLimit` | 1 MiB |
| multer `limits.*` | Infinity (set them; see `files-paths.md`) |
| Koa `@koa/bodyparser` / `koa-body` | check the installed version's `jsonLimit`/`formLimit` |
| Hono `c.req.json()` | none; use `hono/body-limit` |

- Raised limits (`express.json({ limit: '50mb' })`) on unauthenticated routes → memory DoS (Low/Medium).
- body-parser before 1.20.6 / 2.3.0 silently disabled the size check when `limit` was an invalid value (GHSA-v422-hmwv-36x6, July 2026). Check that `limit` values are valid and versions current.
- `express.json({ type: '*/*' })` parses every body as JSON (CSRF implications in `csrf-cors.md`).

## Server timeouts and slow clients

Node `http.Server` defaults (Node 18+, confirmed on 24): `requestTimeout` 300000 ms, `headersTimeout` 60000 ms, `keepAliveTimeout` 5000 ms, `maxHeaderSize` 16 KiB, `maxHeadersCount` 2000.

- `server.requestTimeout = 0` or `headersTimeout = 0` → slowloris-style exhaustion when exposed without a reverse proxy.
- Fastify sets `requestTimeout: 0` (no limit) and `connectionTimeout: 0` by default; its docs say to set a non-zero `requestTimeout` when deployed without a reverse proxy.
- Outbound calls without timeouts (`fetch` has no total-request deadline; undici's defaults are 300 s each for headers and body) let a slow upstream pile up requests.
- `--max-http-header-size` raised, or `insecureHTTPParser: true` (accepts malformed HTTP; request smuggling risk behind proxies) → finding.

## Crashes: unhandled rejections and thrown errors

- On all supported Node lines an unhandled promise rejection terminates the process by default (`--unhandled-rejections=throw`; tested on Node 24). In Express 4, an `async` handler that rejects is not caught by Express → one crafted request can crash the server (**High** DoS when reachable unauthenticated, if no supervisor restarts it quickly or if it's repeatable). Express 5 forwards rejections to the error handler.
- Throws inside callbacks, event emitters without `'error'` listeners (streams, sockets, `child_process`), and `JSON.parse` on input outside `try` in non-framework code also crash the process.
- `process.on('uncaughtException', () => {})` that swallows and continues leaves the app in an undefined state. Log and exit, and let the supervisor restart.
- Runtime DoS CVEs (TLS, HTTP/2, `req.headersDistinct` `__proto__` header crash CVE-2026-21710) are fixed in Node releases: check the version (see `dependencies.md`).

## ReDoS and event-loop blocking

- Regexes with nested quantifiers or overlapping alternation applied to input: `/^(\w+\s?)*$/`, `/(a|aa)+$/`, `/^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+\.)+([a-zA-Z0-9]{2,4})+$/`. Also `new RegExp(userInput)` (attacker-supplied pattern). Tools: `recheck`, `safe-regex2`, `eslint-plugin-regexp`/`eslint-plugin-security`.
- Fix: rewrite with no ambiguous repetition, cap input length before matching, use the `re2` package (linear time), or `validator.js` functions.
- Router-level ReDoS: `path-to-regexp` advisories. Express 4 (0.1.x line): CVE-2024-45296 (fixed 0.1.10), CVE-2024-52798 (0.1.12), CVE-2026-4867 (0.1.13, routes with 3+ params in one segment like `/:a-:b-:c`). Express 5 (8.x via `router`): CVE-2026-4923 and CVE-2026-4926 (fixed 8.4.0) for patterns with multiple wildcards or sequential optional groups. Check the lockfile's `path-to-regexp` versions.
- Other blockers: synchronous crypto (`pbkdf2Sync`, `scryptSync`, `bcrypt.hashSync`) per request, `fs.*Sync` in handlers, huge `JSON.parse`/`JSON.stringify`, unbounded loops over user-supplied arrays, `zlib` decompression without `maxOutputLength` (zip bombs).

## Rate limiting and expensive endpoints

Covered for auth in `authentication.md`. Also apply limits to search, export, PDF/image generation, email/SMS sending, AI/LLM calls (cost), and webhooks fan-out. Fastify: `@fastify/rate-limit`; Koa: `koa-ratelimit`; Hono: community `hono-rate-limiter` (verify maintenance). Keys must use a correct client IP (see `secrets-config.md`) or the user ID.

## Webhooks

- Verify provider signatures over the **raw** body: `express.raw({ type: 'application/json' })` on the webhook route (registered before `express.json()`), or Fastify `addContentTypeParser` with `parseAs: 'buffer'`. Verifying `JSON.stringify(req.body)` fails or can be bypassed.
- Compare with `crypto.timingSafeEqual`; check timestamps (replay window) and idempotency (event IDs).
- Missing verification on routes that change state (payments, plan upgrades) → **High/Critical**.

## WebSockets and Socket.IO

- Authenticate the handshake (`io.use((socket, next) => ...)`, `ws` `verifyClient`/upgrade handler) and authorize **every event**: `socket.on('join', room)` without membership checks is IDOR.
- Check `Origin` on upgrade for cookie-authenticated sockets (cross-site WebSocket hijacking); Socket.IO `cors` option has the same pitfalls as `cors` (see `csrf-cors.md`).
- Message size limits (`ws` `maxPayload`, Socket.IO `maxHttpBufferSize`), and per-connection rate limits.

## GraphQL

- Introspection and GraphiQL/Apollo Sandbox in production (Informational/Low unless schema reveals hidden admin operations).
- Authorization in resolvers or a directive layer for every field returning sensitive data; field-level IDOR is common.
- Depth/complexity limits (`graphql-depth-limit`, cost analysis), batching/alias abuse (login brute force via aliases), persisted queries for public clients.

## False positives

- No explicit body limit: the default `100kb`/1 MiB applies.
- `res.json(doc)` where the model's `toJSON`/`select: false`/Fastify response schema strips sensitive fields.
- Express 5 `async` handlers without `try/catch`.

## Verification

```bash
npx recheck-cli '/^(\w+\s?)*$/'                  # recheck CLI: reports vulnerable / safe
npm ls path-to-regexp body-parser multer            # versions actually installed
```

```js
it('caps page size', async () => {
  const r = await agent.get('/api/invoices?limit=100000');
  expect(r.body.items.length).toBeLessThanOrEqual(100);
});
it('survives a rejected promise in a handler', async () => {
  await request(app).get('/__test/reject').expect(500);
  await request(app).get('/healthz').expect(200);
});
```

References: OWASP API Security Top 10 (API3, API4), Denial of Service, REST Security, GraphQL, WebSocket Security Cheat Sheets; CWE-400, CWE-770, CWE-1333, CWE-213, CWE-345, CWE-1385; https://nodejs.org/api/http.html#serverrequesttimeout, https://fastify.dev/docs/latest/Reference/Server/#requesttimeout, https://github.com/pillarjs/path-to-regexp/security/advisories.
