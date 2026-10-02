# Node.js — Authorization, IDOR and Middleware Ordering

## Contents
- How access control is wired in Node frameworks
- Middleware ordering and mounting mistakes
- Object-level authorization (IDOR)
- Function-level authorization (admin routes)
- Multi-tenancy
- Async errors and `next()` misuse
- False positives
- Verification

Broken access control is the most common serious finding in Node APIs because nothing is enforced by default: every check is a middleware or an `if` someone remembered to write.

## How access control is wired in Node frameworks

| Framework | Where checks run |
|---|---|
| Express 4/5 | `app.use(mw)`, `router.use(mw)`, per-route `router.get(path, mw, handler)`; order of registration is execution order |
| Fastify 5 | `onRequest`/`preHandler` hooks, encapsulated per plugin (`fastify.register`); a hook added inside a plugin does **not** apply to sibling plugins |
| Koa 3 | Middleware stack order (`app.use`), `koa-router` route middleware |
| Hono 4 | `app.use(path, mw)`, route middleware; order matters as in Express |

Map it out before judging individual handlers: list every router/plugin, where it is mounted, and which auth middleware is active at that point.

## Middleware ordering and mounting mistakes

```js
app.use('/api/reports', reportsRouter);     // registered BEFORE the auth middleware → unauthenticated
app.use('/api', requireAuth);
app.use('/api/invoices', invoicesRouter);
```

**Investigate:**
- Routers or routes registered before `app.use(requireAuth)` (Express/Koa/Hono execute in registration order).
- Auth applied with a path prefix that doesn't cover the router: `app.use('/api/v1', requireAuth)` but a router mounted at `/api/v2` or `/internal`.
- Fastify: auth hook registered inside one plugin while routes live in another; `fastify-plugin` (`fp`) wrapping breaks encapsulation on purpose, so check which hooks really reach which routes. `printRoutes()` / `printPlugins()` help.
- Static and file routes (`express.static`, upload download routes) mounted before auth when the files are private.
- `router.param()` / `app.param()` loaders that fetch a record by ID before any ownership check.
- Case or trailing-slash differences between the protected prefix and the route. Express routing is case-insensitive and non-strict by default; a hand-written `if (req.path.startsWith('/admin'))` check is not (`/Admin/users` bypasses it).
- Allow-list middleware that skips auth for "public" paths with `req.url.includes('/public')` or a regex that matches more than intended.

## Object-level authorization (IDOR)

For every route that takes an identifier (`/:id`, `?invoiceId=`, body `userId`), ask: can user A read or change user B's record by changing it?

```js
// Vulnerable: authenticated, but no ownership check
router.get('/invoices/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
});

// Fixed: scope the query by the owner (or tenant) from the session/token, never from input
const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 AND owner_id = $2',
  [req.params.id, req.session.userId]);
if (!rows[0]) return res.sendStatus(404);
```

Also check: update/delete handlers (often missed when `GET` is protected), bulk endpoints taking ID arrays, exports, GraphQL resolvers, WebSocket/Socket.IO events (`socket.on('join', room)`), and ORM calls like `Model.findById(req.params.id)` / `prisma.x.findUnique({ where: { id } })` without an owner filter. UUIDs make guessing harder but are not access control.

Severity: cross-user read of personal or financial data → **High**; cross-tenant or write/delete → **High/Critical**.

## Function-level authorization (admin routes)

- Admin routers protected only by "is logged in".
- Role read from an unverified source: `jwt.decode()`, a cookie, a header, or a client-sent field.
- Role checks on a mutable object: `if (req.user.isAdmin)` where `req.user` is a plain object loaded from a session or JSON is a **prototype-pollution gadget** (a polluted `Object.prototype.isAdmin` makes every user an admin). Prefer `Object.hasOwn(user, 'role') && user.role === 'admin'` or a value from the database. See `input-validation.md`.
- Hiding admin links in templates is not a control.

## Multi-tenancy

Every query on tenant data needs the tenant from the authenticated identity: `WHERE tenant_id = $1` with the session's tenant, Prisma middleware/extensions, Mongoose plugins, or Postgres RLS with `SET app.tenant_id`. Taking `tenantId` from a header, subdomain or body without checking membership → **Critical** cross-tenant access.

## Async errors and `next()` misuse

- **Express 4:** a rejected promise from an `async` handler or middleware is **not** passed to the error handler. The request hangs and Node reports an unhandled rejection (which crashes the process under the default `--unhandled-rejections=throw`). In auth middleware this can also leave security checks unreached. Express 5 forwards rejected promises to `next(err)` automatically. For Express 4: wrap handlers, or use `express-async-errors`/a wrapper, and check every `async` middleware has `try/catch` → `next(err)`.
- Calling `next()` and then continuing to run code, or calling `next()` in a `catch` (fail open): `catch (e) { return next(); }` in auth middleware → **High**.
- Missing `return` after `res.status(403).send()` so the handler keeps executing (and may perform the action). Look for `res.status(4xx)...` without `return` followed by more logic.
- Koa: forgetting `await next()` changes ordering; a check placed after `await next()` runs after the handler.

## False positives

- Routes registered before `requireAuth` that are intentionally public (health check, login, public catalog) and expose nothing sensitive.
- Lookups by ID that are scoped by owner/tenant inside a repository or ORM extension used by the handler. Read the helper before reporting.
- Express 5 `async` handlers without `try/catch`: errors reach the error handler. Not a finding on its own.

## Verification

```js
it('denies access to another user\'s invoice', async () => {
  const agentB = request.agent(app);
  await agentB.post('/login').type('form').send({ email: 'b@test.local', password: 'pw-b-123456' });
  await agentB.get(`/invoices/${invoiceOfUserA}`).expect(404);
});
it('protects reports without a session', () => request(app).get('/api/reports/export').expect(401));
```

Also list effective routes and their middleware: for Express, walk `app.router.stack` (5.x) / `app._router.stack` (4.x) in a test; for Fastify, `fastify.printRoutes({ includeHooks: true })`.

References: OWASP Authorization Cheat Sheet, OWASP API Security Top 10 (API1 BOLA, API5 BFLA); CWE-284, CWE-285, CWE-639, CWE-862, CWE-863; https://expressjs.com/en/guide/using-middleware.html, https://fastify.dev/docs/latest/Reference/Encapsulation/.
