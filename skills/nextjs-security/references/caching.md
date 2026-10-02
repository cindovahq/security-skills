# Next.js — Caching, Revalidation and Draft Mode

## Contents
- Cache layers and version defaults
- Cross-user and cross-tenant leaks
- Static rendering of personalized pages
- CDN / shared caches and `Set-Cookie`
- Revalidation endpoints
- Draft mode and preview secrets
- `generateStaticParams` and `dynamicParams`
- Cache advisories
- Severity notes, false positives, verification

## Cache layers and version defaults

| Layer | Default (15.x/16.x) | Keyed by |
|---|---|---|
| `fetch` data cache | **Not cached** ("auto no cache"); opt in with `cache: 'force-cache'` or `next.revalidate` | URL, method, headers, body |
| `unstable_cache` (replaced by `'use cache'` in 16) | Cached until revalidated | Function arguments + function source + `keyParts` |
| `'use cache'` (Cache Components, `cacheComponents: true` in 16; experimental in 15) | Cached per `cacheLife` | Build ID, function ID, serialized arguments, **closed-over variables** |
| Full route cache / ISR | Static unless the route uses request-time APIs (`cookies()`, `headers()`, `searchParams`, `connection()`) | Path |
| `GET` Route Handlers | Dynamic since 15.0 (cached by default in 14.x) | Path |

Next.js 14.x cached `fetch` and `GET` handlers by default. Review 14.x apps with that in mind.

## Cross-user and cross-tenant leaks

```ts
// investigate: teamId is captured from the closure but NOT in keyParts → one entry for all teams
const user = await requireUser()
const getStats = unstable_cache(
  async () => db.invoice.aggregate({ where: { teamId: user.teamId }, _sum: { total: true } }),
  ['team-stats'],
  { revalidate: 3600 },
)
```

The `unstable_cache` docs: arguments are part of the key automatically, but "it is important to add closures used within the function if you do not pass them as parameters." Fix: pass the tenant as an argument or add it to `keyParts` (`['team-stats', user.teamId]`).

Also check:

- `fetch(url, { cache: 'force-cache', headers: { Authorization } })`: headers are part of the key, so different tokens get different entries, but the response is persisted in the shared data cache. A token-less URL that returns per-user data (session forwarded some other way, or keyed by a query param an attacker can guess) is shared. Docs: caching is opt-in and applies even to requests with `authorization`/`cookie` headers.
- `'use cache'` cannot call `cookies()`/`headers()` (it errors). Leaks happen when user identity is read *outside* and something *other* than the identity is passed in, or when a cached helper reads identity from a module-level variable, `AsyncLocalStorage` or a global. Every input that changes the output must be an argument or a closed-over variable.
- File-level `'use cache'` modules: their exports can be called from Client Components and run on the server like Server Functions. A cached `getAccount(accountId)` exported this way is an unauthenticated endpoint unless it authorizes (and authorization can't read cookies inside the cache scope, so it must happen outside).
- `'use cache: private'` entries aren't stored in a shared server cache (they're reused only within a request and in browser memory per `stale`). The docs frame it as an escape hatch for when runtime values can't be passed as arguments, not a general per-user cache; `'use cache: remote'` stores entries in a shared platform cache.
- `React.cache` is per-request memoization, not a cross-request cache. Not a leak vector by itself.

## Static rendering of personalized pages

A page that reads the user from somewhere Next.js can't see as request-time (a module-level singleton, a header forwarded by proxy then read via a custom store, `export const dynamic = 'force-static'`, `revalidate = 60` on a page that calls an auth SDK in a way that doesn't touch `cookies()`) can be prerendered once and served to everyone. Look for `force-static`, `revalidate` exports and `generateStaticParams` on routes under `/dashboard`, `/account`, `/settings`. Confirm with the `next build` route table (static vs dynamic markers).

## CDN / shared caches and `Set-Cookie`

- Responses with `Cache-Control: public, s-maxage=...` (set in `headers()`, a Route Handler, or proxy) on routes that read cookies or return `Set-Cookie` → a CDN may cache one user's response or session cookie for others. Supabase warns that a cached response carrying refreshed auth cookies signs the next user in as the wrong person.
- Self-hosted behind Cloudflare/Fastly/nginx: check `Vary` and cache rules for `/_next/data`, RSC requests and API routes. Several advisories covered cache poisoning (CVE-2025-49005 missing `Vary`, fixed 15.3.3; CVE-2026-44576 RSC response poisoning and CVE-2026-44572 middleware redirect poisoning, fixed 15.5.16 / 16.2.5).

## Revalidation endpoints

```ts
// app/api/revalidate/route.ts — investigate
export async function GET(req: NextRequest) {
  revalidatePath(req.nextUrl.searchParams.get('path') ?? '/')   // anyone can purge any path
  return Response.json({ revalidated: true })
}
```

Unauthenticated `revalidatePath`/`revalidateTag`/`res.revalidate()` lets anyone force regeneration (load amplification against the origin and CMS, cost) and, combined with a CMS write or race, publish content early. Usually **Low/Medium**. Fix: `POST` only, shared secret in a header compared with `crypto.timingSafeEqual`, allow-list of paths/tags.

## Draft mode and preview secrets

- `(await draftMode()).enable()` sets the `__prerender_bypass` cookie. Requests with it bypass `fetch` cache, `'use cache'` and ISR.
- The official guide requires checking a shared secret **and** looking up the slug in the CMS, then redirecting to the CMS's slug ("not from searchParams, to avoid open redirect vulnerabilities").
- Investigate: draft routes with no secret, a secret in client code or the repo, `secret !== process.env.X` where the env var may be unset, redirect to the raw `slug` param, and pages that switch to a **privileged** CMS token or include unpublished records when `isEnabled` is true. Anyone enabling draft mode then reads unpublished content → Medium/High depending on the content.
- 16.3.x before 16.3.8: overlapping draft and regular requests could leak draft content through pending `'use cache'` fills (CVE-2026-94544, fixed in 16.3.8).

## `generateStaticParams` and `dynamicParams`

- `generateStaticParams` returning private records (unpublished posts, other tenants' slugs) prerenders them into public static files at build time.
- `dynamicParams` defaults to `true`: params not returned are rendered on demand. With `dynamicParams = false` they 404. Neither is authorization: a page must still check access to the record.
- `notFound()` for unauthorized records is fine (and hides existence); the check must still run.

## Cache advisories

16.3.8 / 15.5.27 (2026-09-30) fixed several cache issues: SSG/ISR cache poisoning in self-hosted Pages Router apps (CVE-2026-94543), cross-user content substitution in SSG/ISR (CVE-2026-94484), and in 16.3.x only, nested `'use cache'` keys omitting root params (CVE-2026-103004). Earlier: CVE-2026-64648/CVE-2026-64647 cache confusion for requests with bodies (fixed 15.5.21 / 16.2.11). See `dependencies.md`.

## Severity notes, false positives, verification

- One user's or tenant's private data served to others → **High** (Critical for regulated data at scale).
- Unauthenticated revalidation → Low/Medium. Draft mode without secret → Medium/High by content.
- **Not findings:** `force-cache`/`'use cache'` on public data (catalogs, exchange rates, CMS published content); `React.cache` in the DAL; static marketing pages.
- **Verify:** log in as user A, load the page; log in as user B (different tenant), load it; compare. Use `NEXT_PRIVATE_DEBUG_CACHE=1 next start` on staging to see cache hits and keys. Check `curl -s -D - -o /dev/null <url> | grep -iE 'cache-control|set-cookie|x-nextjs-cache'`.

References: OWASP A01:2025 Broken Access Control; CWE-524, CWE-525, CWE-359; https://nextjs.org/docs/app/api-reference/functions/unstable_cache, https://nextjs.org/docs/app/api-reference/directives/use-cache, https://nextjs.org/docs/app/api-reference/functions/fetch, https://nextjs.org/docs/app/guides/draft-mode.
