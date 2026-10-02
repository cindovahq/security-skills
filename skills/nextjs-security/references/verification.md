# Next.js — Verifying Findings and Fixes

## Contents
- Ground rules
- Static checks
- Build output inspection
- Unit and integration tests
- End-to-end tests (Playwright)
- Safe HTTP checks
- Calling Server Actions directly
- Checklist per finding type

## Ground rules

Only test applications you are authorized to assess, on local or staging environments, with test accounts. Use harmless markers, not exploit payloads. Never run destructive actions (deletes, role changes) against shared data; create the target records yourself.

## Static checks

```bash
# Entry points
grep -rlE "^['\"]use server['\"]" app src lib 2>/dev/null
find . -path ./node_modules -prune -o \( -name 'route.ts' -o -name 'route.js' \) -print
ls pages/api 2>/dev/null; ls middleware.* proxy.* src/middleware.* src/proxy.* 2>/dev/null

# Actions/handlers that never read a session (review each hit manually)
for f in $(grep -rlE "['\"]use server['\"]" app lib src 2>/dev/null); do
  grep -qE "requireUser|verifySession|auth\(\)|getUser\(|getClaims\(|currentUser\(" "$f" || echo "NO AUTH CALL: $f"
done

# Client components and what they import
grep -rlE "^['\"]use client['\"]" app components src | xargs grep -nE "from '@/lib/(db|dal|supabase/admin)"
```

Absence of an auth call in a file is a lead, not a finding: the auth may live in a called DAL function. Trace it.

## Build output inspection

```bash
next build                                   # route table shows static vs dynamic routes
grep -rl "<first 8+ chars of a server secret>" .next/static && echo "SECRET IN CLIENT BUNDLE"
grep -rhoE "NEXT_PUBLIC_[A-Z0-9_]+" app components lib src | sort -u   # review every public var
ls .next/static/chunks/*.map 2>/dev/null     # production source maps present?
cat .next/server/server-reference-manifest.json | head   # Server Action IDs and their modules (internal format)
```

Personalized routes (`/dashboard`, `/account`) marked static in the route table point to a cache leak; confirm in code (see `caching.md`).

## Unit and integration tests

Call Server Actions, Route Handlers and DAL functions directly with Vitest/Jest, mocking the session:

```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/dal', () => ({ requireUser: vi.fn() }))
import { requireUser } from '@/lib/dal'
import { updateMemberRole } from '@/app/team/team-actions'
import { GET } from '@/app/api/invoices/[id]/route'

describe('authorization boundaries', () => {
  it('non-owner cannot change roles', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u2', teamId: 't1', role: 'member' } as any)
    await expect(updateMemberRole('u3', 'owner')).rejects.toThrow()
  })
  it('handler hides other teams\' invoices', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u2', teamId: 't2', role: 'member' } as any)
    const res = await GET(new Request('http://test/api/invoices/inv-t1'), { params: Promise.resolve({ id: 'inv-t1' }) })
    expect(res.status).toBe(404)
  })
})
```

Also test: mass-assignment fields are ignored (`role` in FormData), DTO keys are exactly the allowed set, the redirect helper rejects `//evil` and `https://evil`, the sanitizer neutralizes `<img onerror>`, and the proxy matcher covers intended paths (`unstable_doesMiddlewareMatch` from `next/experimental/testing/server`, 15.1+; it also works with `proxy.ts`, although the proxy docs page calls it `unstable_doesProxyMatch`, a name the package doesn't export).

## End-to-end tests (Playwright)

```ts
test('user B cannot open user A invoice', async ({ browser }) => {
  const b = await browser.newContext({ storageState: 'auth/userB.json' })
  const page = await b.newPage()
  const res = await page.goto(`/invoices/${invoiceOfUserA}`)
  expect([403, 404]).toContain(res!.status())          // or assert redirect / not-found UI
  expect(await page.content()).not.toContain('INV-A-MARKER')
})
```

Also useful: log in as A and B in separate contexts and diff responses of cached pages; assert no `Set-Cookie` on publicly cacheable responses; assert security headers.

## Safe HTTP checks

```bash
BASE=https://staging.example.com
# Middleware-only protection: the page must refuse on its own (also try the RSC variant)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $BASE/admin
curl -s -o /dev/null -w "%{http_code}\n" -H "RSC: 1" $BASE/admin
# Headers
curl -s -D - -o /dev/null $BASE/ | grep -iE 'content-security|strict-transport|x-frame|x-powered-by|set-cookie|cache-control'
# CORS reflection
curl -s -D - -o /dev/null $BASE/api/export -H "Origin: https://attacker.invalid" | grep -i access-control
# Open redirect
curl -s -o /dev/null -w "%{redirect_url}\n" "$BASE/auth/callback?next=//example.org"
# Image optimizer host allow-list (expect 400)
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/_next/image?url=https%3A%2F%2Fexample.org%2Fa.png&w=64&q=75"
```

## Calling Server Actions directly

A Server Action is a `POST` to the page that uses it with a `Next-Action: <action id>` header; the ID and body encoding are internal and change between versions. The reliable way is to perform the action once in the browser, copy the request from the network tab as cURL, then replay it on staging:

- with **no cookie** (authentication check),
- with **another test user's cookie** and the first user's object ID (authorization/IDOR),
- with extra fields added to the form body (mass assignment),
- with a different `Origin` header (expect rejection; CSRF protection).

## Checklist per finding type

| Finding | Proof of fix |
|---|---|
| Missing auth in action/handler | Direct call without session fails in a unit test and a replayed request |
| IDOR | Second user gets 403/404 for the first user's ID; object unchanged |
| Middleware-only auth | Page/action denies when called without proxy; `next` upgraded past bypass advisories |
| Data exposure | Sentinel value absent from HTML/RSC payload and action responses |
| Secret in bundle | `grep` of `.next/static` finds nothing; credential rotated |
| Cache leak | Two users/tenants see their own data; cache key includes identity |
| XSS | Marker renders inert; sanitizer/serializer unit test |
| SSRF / redirect | Internal and external targets rejected; allowed targets still work |
| Dependency | `npm ls next` shows fixed version; lock file updated |

References: https://nextjs.org/docs/app/guides/testing, https://nextjs.org/docs/app/api-reference/file-conventions/proxy#unit-testing-experimental, OWASP Web Security Testing Guide.
