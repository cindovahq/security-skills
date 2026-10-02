# Next.js — Middleware / Proxy as an Authorization Layer

## Contents
- Version map
- Why proxy is not sufficient
- Bypass advisories
- What to investigate
- Fix pattern
- Layouts and other non-boundaries
- Severity notes and false positives
- Verification

## Version map

| Next.js | File | Notes |
|---|---|---|
| 12.2–15.x | `middleware.ts` exporting `middleware` (or default) | Edge runtime by default; Node.js runtime experimental in 15.2, stable in 15.5 |
| 16.x | `proxy.ts` exporting `proxy` (or default) | `middleware.ts` is deprecated but still works (and is the only option for the Edge runtime). `proxy` always runs on Node.js. `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`. Codemod: `npx @next/codemod@canary middleware-to-proxy .` |

Both live at the project root (or `src/`), next to `app/`/`pages/`. Only one is active. Check which file exists and which function name it exports.

## Why proxy is not sufficient

The Next.js docs say proxy "should not be your only line of defense in protecting your data" and recommend only **optimistic** checks there (read the session cookie, redirect), with **secure** checks in a Data Access Layer. Reasons:

- **Matchers decide coverage.** Paths outside `config.matcher` never run proxy. The official examples exclude `api`, `_next/static`, `_next/image` and metadata files, so Route Handlers under `/api` are often unprotected.
- **Server Functions are POSTs to the page route.** "A Proxy matcher that excludes a path will also skip Server Function calls on that path." Moving an action or changing a matcher silently removes coverage.
- **Path-based logic is fragile:** `pathname === '/admin'` misses `/admin/users`, `/Admin`, trailing slashes, locale prefixes, `.rsc`/prefetch variants and rewrites.
- **Framework bugs** have repeatedly let crafted requests skip or mis-match middleware (table below).
- Proxy can't see what data a page or action will touch, so it can't do object-level authorization.

## Bypass advisories

Check the installed version against these (from the Next.js GitHub advisories):

| Advisory | Issue | Affected | Fixed |
|---|---|---|---|
| CVE-2025-29927 | Internal `x-middleware-subrequest` header from the client made middleware skip | 11.1.4–<12.3.5, 13.0.0–<13.5.9, 14.0–<14.2.25, 15.0–<15.2.3 | 12.3.5, 13.5.9, 14.2.25, 15.2.3 |
| CVE-2024-51479 | Pathname-based middleware authorization bypass | 9.5.5–14.2.14 | 14.2.15 |
| CVE-2026-44573 | Bypass in Pages Router apps using i18n | 12.2.0–<15.5.16, 16.0.0–<16.2.5 | 15.5.16, 16.2.5 |
| CVE-2026-44575 / CVE-2026-45109 | Bypass via `.rsc` and segment-prefetch URL variants (follow-up fixed Turbopack `middleware.ts`) | 15.2.0–<15.5.18, 16.0.0–<16.2.6 | 15.5.18, 16.2.6 |
| CVE-2026-44574 | Bypass through dynamic route parameter injection | 15.4.0–<15.5.16, 16.0.0–<16.2.5 | 15.5.16, 16.2.5 |
| CVE-2026-64642 | Bypass in App Router apps built with Turbopack and a single i18n locale | 16.0.0–<16.2.11 | 16.2.11 |

Vercel-hosted deployments were automatically protected against CVE-2025-29927 and CVE-2024-51479 per those advisories; self-hosted ones were not. The official workaround for CVE-2025-29927 was to strip `x-middleware-subrequest` at the edge. Every advisory's workaround is the same: **enforce authorization in the page, action or handler, not only in middleware.** 14.x is unsupported, so 14.x apps don't receive the 2026 fixes.

Related, not a bypass: CVE-2025-57822 (SSRF when request headers are passed into `NextResponse.next({ headers })` in self-hosted apps, fixed 14.2.32 / 15.4.7) and CVE-2026-44572 (cache-poisonable middleware redirects, fixed 15.5.16 / 16.2.5).

## What to investigate

```ts
// middleware.ts — investigate: the only place /admin is protected
export function middleware(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (req.nextUrl.pathname.startsWith('/admin') && !isAdmin(session)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
```

1. List every protected area the proxy is supposed to cover (`/admin`, `/dashboard`, `/api/...`).
2. For each page, layout, action and handler in those areas, check whether it **also** checks the session and role. If not, the proxy is the sole control → finding.
3. Compare the matcher against the routes. Excluded prefixes (`api`), missing nested paths, `has`/`missing` conditions that a client can satisfy (e.g. skipping on a header the client sends).
4. Look for `NextResponse.next({ headers: requestHeaders })`: that sends request headers **to the client** in the response. The intended form is `NextResponse.next({ request: { headers } })`.
5. Look for proxies that set trust headers (`x-user-id`, `x-role`) for downstream code. Downstream code must not trust such headers if a client can send them on a path proxy doesn't cover.
6. Auth-library wrappers: `clerkMiddleware()` does not protect any route by default, and Clerk says "Middleware is not the best place to protect routes". Clerk advisory CVE-2026-41248 (middleware route protection bypass in `@clerk/nextjs` 5.0.0–6.39.1 and 7.0.0–7.2.0; fixed 5.7.6 / 6.39.2 / 7.2.1). Auth.js `auth` used as middleware with `callbacks.authorized` is likewise optimistic.

## Fix pattern

Keep proxy for redirects/UX, and add a DAL check at every data entry point:

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { redirect, forbidden } from 'next/navigation'

export const requireUser = cache(async () => {
  const user = await getVerifiedUser()          // verifies cookie/JWT, or asks the auth server
  if (!user) redirect('/login')
  return user
})
export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'admin') forbidden()        // needs experimental.authInterrupts; otherwise throw or notFound()
  return user
}

// app/admin/page.tsx, app/admin/actions.ts, app/api/admin/**/route.ts
await requireAdmin()
```

Then upgrade `next` to a fixed release. When patching, add a test that the protected page/action/handler refuses requests **without** going through proxy (call it directly, or use `unstable_doesMiddlewareMatch` from `next/experimental/testing/server`, 15.1+; it also works with `proxy.ts`, although the proxy docs page calls it `unstable_doesProxyMatch`, a name the package doesn't export, to assert matcher coverage).

## Layouts and other non-boundaries

- **Layouts don't re-render on client navigation** and "a layout also does not control whether the rest of the route renders": segments and parallel slots still execute and can appear in the RSC payload. A check only in `layout.tsx` → finding for every page/action below it that lacks its own check.
- `return null` in a component for unauthorized users is UI only.
- Client-side guards (`useSession()` redirects, hiding links) are UI only.
- `notFound()` vs `forbidden()` is a disclosure choice; either is fine as long as the check happens.

## Severity notes and false positives

- Sole proxy protection of admin pages/actions, on a version with a bypass advisory → **Critical** (Confirmed if the version is affected and no other check exists).
- Sole proxy protection on a patched version → **High/Medium** (Likely): it depends on matcher gaps and future bypasses. State which routes have no secondary check.
- **Not findings:** proxy used only for redirects, i18n, headers or CSP when the DAL enforces auth; matchers excluding static assets; optimistic cookie checks in proxy when pages and actions re-verify.

## Verification

```bash
# Direct access without a session (expect redirect/401/403 from the page or handler itself)
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/admin
# Prefetch/RSC variant of the same page (expect the same result)
curl -s -o /dev/null -w "%{http_code}\n" -H "RSC: 1" https://staging.example.com/admin
```

Prove defense in depth with a unit/integration test that renders the page or calls the action with no session and expects `redirect`/`forbidden`, independent of proxy.

References: OWASP A01:2021 Broken Access Control; CWE-285, CWE-288, CWE-863; https://nextjs.org/docs/app/api-reference/file-conventions/proxy, https://nextjs.org/docs/app/guides/authentication, https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw.
