# Next.js — Route Handlers and Pages API Routes

## Contents
- How handlers are exposed
- Authentication and authorization
- CSRF on cookie-authenticated handlers
- CORS
- Webhooks
- Pages Router API routes
- Severity notes and false positives
- Verification

## How handlers are exposed

- **App Router:** `app/**/route.{ts,js}` exports one function per method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. If `OPTIONS` isn't exported, Next.js answers it automatically with an `Allow` header.
- **Pages Router:** every file under `pages/api/` is an endpoint at `/api/*`, handling all methods unless the code checks `req.method`.
- Next.js docs: "Treat Route Handlers with the same security considerations as public-facing API endpoints."
- **Caching:** since 15.0, `GET` handlers are dynamic (not cached) by default. They are cached only with `export const dynamic = 'force-static'`, `revalidate`, or Cache Components. In 14.x, `GET` handlers were **cached by default** unless they used a dynamic function or dynamic config option (Next.js 15 release notes); check exactly what opts a 14.x handler out for the installed version before concluding a per-user `GET` is cached. See `caching.md`.
- Route Handlers have **no built-in CSRF protection**. The Origin check applies only to Server Actions.

## Authentication and authorization

```ts
// app/api/invoices/[id]/route.ts — investigate
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return Response.json(await db.invoice.findUnique({ where: { id } }))   // no session, no owner check
}
```

Check for:

- Handlers with no session read at all. Proxy/middleware matchers commonly exclude `/api` (`'/((?!api|_next/static|...).*)'`, as in the official examples), so "the middleware protects it" is often false. See `middleware-proxy.md`.
- Session checked, but objects fetched by ID without tenant/owner scoping (IDOR).
- Exported methods that do more than intended: a `DELETE` added for an admin UI with only a login check.
- State changes on `GET` (logout, "confirm", "unsubscribe" with side effects beyond the user's own preference). `GET` is reachable by links, `<img>` and prefetching.
- Bearer-token handlers that compare tokens with `===` (timing) or accept tokens in query strings (logged).
- Error responses that echo stack traces or DB errors (`return Response.json({ error: e.message, stack: e.stack })`).

**Fix:**

```ts
import { requireUser } from '@/lib/dal'
export async function GET(_req: Request, ctx: RouteContext<'/api/invoices/[id]'>) {
  const user = await requireUser()                       // 401/redirect inside
  const { id } = await ctx.params
  const invoice = await db.invoice.findFirst({ where: { id, teamId: user.teamId }, select: invoiceDto })
  if (!invoice) return new Response(null, { status: 404 })
  return Response.json(invoice)
}
```

## CSRF on cookie-authenticated handlers

A cookie-authenticated `POST`/`PUT`/`DELETE` handler is CSRF-able when the browser will send the cookie cross-site and the handler accepts a request a cross-site page can send:

- The session cookie is `SameSite=None` (often set for iframe embedding or cross-site SSO), or the handler is a `GET`.
- The handler reads `request.formData()` or `request.text()`, or parses JSON without requiring `Content-Type: application/json` (`text/plain` bodies are "simple" requests with no preflight).

`SameSite=Lax` cookies are not sent on cross-site `POST`, which blocks the classic attack. That is defense in depth, not a reason to skip the check on sensitive handlers.

**Fix options:** keep the session cookie `SameSite=Lax`/`Strict`; verify `Origin` (or `Sec-Fetch-Site: same-origin`) on state-changing handlers; require `Content-Type: application/json` and reject others; or move the mutation to a Server Action, which has the Origin check built in.

```ts
function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (!origin || new URL(origin).host !== req.headers.get('host')) throw new Response(null, { status: 403 })
}
```

## CORS

The App Router docs show `Access-Control-Allow-Origin: '*'`, which is fine for public, unauthenticated data. Investigate:

- Reflecting the request `Origin` (`headers.set('Access-Control-Allow-Origin', req.headers.get('origin'))`) together with `Access-Control-Allow-Credentials: true` → any site can read authenticated responses (High when the endpoint returns personal data and cookies are `SameSite=None`; reduced when cookies are `Lax`, because they aren't sent on cross-site `fetch`).
- Allow-lists checked with `endsWith('example.com')` or `includes(...)` (matches `evil-example.com`).
- CORS headers added globally in `next.config.js` `headers()` or proxy for `/api/:path*`.

Pages API routes "do not specify CORS headers, meaning they are same-origin only by default".

## Webhooks

- Verify the provider signature over the **raw** body (`await request.text()` in Route Handlers; `bodyParser: false` in Pages API routes) with the provider SDK (`stripe.webhooks.constructEvent`, `svix`, `@clerk/backend` `verifyWebhook`). Handlers that parse JSON and act without verification are forgeable by anyone (High/Critical when they mark orders paid or grant access).
- Check replay protection (timestamp tolerance) and idempotency on event IDs.

## Pages Router API routes

- `req.query` values can be `string | string[]`. Code that does `where: { id: req.query.id }` may get an array.
- `bodyParser` is on by default with a `1mb` limit. `bodyParser: false` is expected for webhooks.
- `res.revalidate(path)` endpoints need a secret (see `caching.md`).
- `getServerSideProps` is not an API route, but its props are serialized into the page (see `data-exposure.md`).

## Severity notes and false positives

- Unauthenticated handler returning personal or tenant data → High/Critical. Authenticated IDOR → High.
- CSRF on email/password change, payment or deletion → High when cookies allow it, Medium otherwise.
- **Not findings:** missing CSRF on bearer-token-only handlers; webhook handlers without CSRF that verify signatures; public read-only `GET` handlers with `Access-Control-Allow-Origin: *` and no credentials.

## Verification

```bash
# Unauthenticated access (expect 401/403/404, not data)
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/api/invoices/<id-of-other-team>

# CSRF: a cross-site style form post with a test user's cookie (expect 403)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.example.com/api/account/email \
  -H "Origin: https://attacker.invalid" -H "Cookie: <test session>" --data "email=csrf-test@example.com"

# CORS: arbitrary origin must not be reflected with credentials
curl -s -D - -o /dev/null https://staging.example.com/api/export -H "Origin: https://attacker.invalid" | grep -i access-control
```

References: OWASP API1:2023, API2:2023, API8:2023; CWE-284, CWE-352, CWE-942, CWE-345; https://nextjs.org/docs/app/api-reference/file-conventions/route, https://nextjs.org/docs/pages/building-your-application/routing/api-routes.
