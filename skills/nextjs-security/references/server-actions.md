# Next.js — Server Actions and Server Functions

## Contents
- How Server Actions are exposed
- Built-in protections (and their limits)
- What to investigate
- Fix pattern
- Closures, `.bind()` and encryption
- CSRF and `allowedOrigins`
- Severity notes
- False positives
- Verification

## How Server Actions are exposed

A Server Action is an async function marked `'use server'` (file-level, or inline at the top of a function body). The compiler replaces it in client bundles with a reference (an action ID) and a dispatcher that POSTs to the page that uses it. The Next.js docs are explicit: "you should still treat Server Actions as reachable via direct POST requests and verify authentication and authorization inside each one."

Consequences:

- A page-level or layout-level check does **not** protect the actions rendered on that page. The data security guide: "A page-level authentication check does not extend to the Server Actions defined within it."
- Arguments arrive from the client and are deserialized from the request. TypeScript parameter types are **not** enforced at runtime.
- Return values are serialized to the client, whether or not the UI displays them.
- Files with a top-level `'use cache'` (Cache Components) export functions that Client Components can call directly. Treat them like Server Functions.

| Version | Relevant change |
|---|---|
| 14.0 | Server Actions stable. Closed-over variables encrypted per build. |
| 15.0 | Unguessable, non-deterministic action IDs; unused actions removed from client bundles. Action IDs are rotated at most every 14 days. |
| 16.0 | `updateTag`/`refresh` for actions. Security model unchanged. |

## Built-in protections (and their limits)

- **POST only**, plus an **Origin vs Host check**: the host in `Origin` is compared with `X-Forwarded-Host` or `Host`, and mismatches are rejected. A request with **no** `Origin` header is allowed through with a warning (documented in the `serverActions` config reference).
- **Body size limit:** 1 MB by default (`serverActions.bodySizeLimit`).
- **Encrypted action IDs / dead code elimination** reduce discoverability. They are not access control: action IDs ship in client chunks for every action the UI uses (and CVE-2026-64643 disclosed IDs through public artifacts on versions before 15.5.21 / 16.2.11).

## What to investigate

For every `'use server'` export, answer: **can an unauthenticated user, or a user from another account/tenant, call this with arbitrary arguments and cause harm?**

```ts
'use server'
// 1. No authentication at all
export async function setRole(userId: string, role: string) {
  await db.user.update({ where: { id: userId }, data: { role } })
}

// 2. Authentication but no ownership check (IDOR)
export async function deleteInvoice(id: string) {
  const user = await requireUser()
  await db.invoice.delete({ where: { id } })          // any invoice id
}

// 3. Mass assignment: client controls every column
export async function updateProfile(formData: FormData) {
  const user = await requireUser()
  return db.user.update({ where: { id: user.id }, data: Object.fromEntries(formData) })
}                                                     // + returns the full row (hash, tokens)

// 4. Trusting client-supplied identity or objects
export async function completeItem(item: Item) {      // item.ownerId comes from the client
  await db.item.update({ where: { id: item.id }, data: { done: true } })
}
```

Also check:

- Role checks done in the page (`if (user.role !== 'admin') redirect(...)`) while the action itself checks nothing.
- Actions that accept a `userId`, `teamId`, `orgId` or `ownerId` argument instead of deriving it from the session.
- Actions that call `redirect(input)` (open redirect, see `ssrf-redirects.md`) or `fetch(input)` (SSRF).
- Expensive actions (email, SMS, AI calls) with no rate limiting.
- `try { ... redirect() } catch {}`: `redirect` throws, so a broad `catch` swallows it. A correctness bug, but it sometimes hides auth redirects.

## Fix pattern

Keep actions thin and delegate to a `server-only` Data Access Layer that authenticates, authorizes and validates:

```ts
// app/invoices/actions.ts
'use server'
import { z } from 'zod'
import { requireUser } from '@/lib/dal'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'

const Id = z.string().uuid()

export async function deleteInvoice(rawId: unknown) {
  const id = Id.parse(rawId)
  const user = await requireUser()                     // reads and verifies the session itself
  const { count } = await db.invoice.deleteMany({ where: { id, teamId: user.teamId } })
  if (count === 0) throw new Error('Not found')        // don't reveal existence
  revalidatePath('/invoices')
  return { ok: true }                                  // minimal return value
}

export async function updateProfile(formData: FormData) {
  const user = await requireUser()
  const input = z.object({ name: z.string().min(1).max(80), bio: z.string().max(500) })
    .parse({ name: formData.get('name'), bio: formData.get('bio') })
  await db.user.update({ where: { id: user.id }, data: input })   // allow-listed fields only
  return { ok: true }
}
```

With `experimental.authInterrupts`, `forbidden()`/`unauthorized()` from `next/navigation` can be thrown instead of plain errors.

## Closures, `.bind()` and encryption

- Variables an inline action closes over are **encrypted** before being sent to the client, with a private key generated per action at each build (or `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`). The docs still advise against relying on encryption alone to hide sensitive values.
- Arguments passed with `.bind(null, value)` are **not encrypted** ("These are NOT encrypted", Next.js security blog). They are client-controlled like any other argument: re-validate and re-authorize.
- Self-hosted multi-instance deployments must share `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64, 16/24/32 bytes). A key committed to the repo or reused across environments → see `secrets-config.md`.

## CSRF and `allowedOrigins`

```js
// next.config.js: only the hosts that legitimately front the app
module.exports = { experimental: { serverActions: { allowedOrigins: ['app.example.com'] } } }
```

Investigate:

- `allowedOrigins` containing wildcards that include user-controllable subdomains (`*.example.com` where tenants get subdomains, `**.vercel.app`), or `'null'`.
- Versions 16.0.1 to 16.1.6: `Origin: null` (sandboxed iframes) bypassed the check (CVE-2026-27978, fixed 16.1.7).
- Session cookies set with `SameSite=None` make the "no Origin header" allowance more relevant. Report together with the cookie config.
- Custom servers or proxies that let clients control `Host`/`X-Forwarded-Host`. That defeats the Origin comparison and enabled SSRF in older versions (CVE-2024-34351, fixed 14.1.1; CVE-2026-64649, fixed 15.5.21 / 16.2.11).

## Severity notes

- Unauthenticated action that changes roles, deletes data or moves money → **Critical**.
- Authenticated cross-account read/write (IDOR) → **High** (Critical for cross-tenant B2B data).
- Mass assignment of privilege fields (`role`, `isAdmin`, `teamId`, `plan`) → **High/Critical**.
- Full DB row returned (hashes, tokens, MFA secrets) → **High**. Non-sensitive extra fields → Low.
- Missing rate limit on a costly action → Medium/Low depending on cost.

## False positives

- Forms posting to Server Actions with no CSRF token (framework Origin check covers them).
- Inline closures over server-fetched values *when the action also re-checks authorization*.
- `logout`-style actions without auth.
- Unused exported actions in a `'use server'` file: on 15+, unused actions are removed from the build. Still worth a Hardening note to delete dead code.

## Verification

```ts
// Vitest: call the action directly with a forged context
import { deleteInvoice } from '@/app/invoices/actions'
vi.mock('@/lib/dal', () => ({ requireUser: async () => ({ id: 'u2', teamId: 'team-b' }) }))

it('cannot delete another team\'s invoice', async () => {
  await expect(deleteInvoice(invoiceOfTeamA.id)).rejects.toThrow()
  expect(await db.invoice.findUnique({ where: { id: invoiceOfTeamA.id } })).not.toBeNull()
})
```

For runtime proof (staging only), replay the action request captured in the browser's network tab with another user's cookie or none. See `verification.md`.

References: OWASP API1:2023 (BOLA), API3:2023 (BOPLA), API5:2023 (BFLA); CWE-862, CWE-639, CWE-915, CWE-352; https://nextjs.org/docs/app/guides/server-actions, https://nextjs.org/docs/app/guides/data-security, https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions, https://nextjs.org/blog/security-nextjs-server-components-actions.
