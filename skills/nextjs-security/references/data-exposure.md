# Next.js — Server Data Leaking to the Client

## Contents
- How data crosses the server/client boundary
- What to investigate
- Fix pattern
- `server-only`, `client-only` and taint APIs
- Pages Router
- Errors and logs
- Severity notes, false positives, verification

## How data crosses the server/client boundary

Server Components can read databases and secrets. Everything they pass as **props to a Client Component** (`'use client'`) is serialized into the RSC payload and sent to the browser, even fields the component never renders. The same applies to:

- Server Action **return values** and thrown error messages in development.
- Data in the initial HTML (the RSC payload is inlined in the page for hydration).
- `getServerSideProps`/`getStaticProps` props in the Pages Router.
- Values closed over by inline Server Actions (encrypted) and `.bind()` arguments (not encrypted).

Functions and class instances can't be passed to Client Components (they error), which is why the Next.js docs suggest classes for data-access records.

## What to investigate

```tsx
// app/profile/[username]/page.tsx — investigate
const user = await db.user.findUnique({ where: { username } })   // all columns
return <ProfileCard user={user} />                                 // 'use client' component

// components/profile-card.tsx
'use client'
export function ProfileCard({ user }: { user: User }) { return <h1>{user.name}</h1> }
```

1. Find every `'use client'` component and read its props types. Broad types (`User`, `Account`, Prisma model types, `any`, `Record<string, unknown>`) are the signal. Then find who renders it and what they pass.
2. Find DB queries without `select`/column lists whose results flow into JSX props, action returns or `Response.json`.
3. Look for sensitive columns in the schema (`passwordHash`, `resetToken`, `mfaSecret`, `apiKey`, `stripeCustomerId`, `email`/`phone` of other users, internal notes) and trace whether any query that returns them reaches the client.
4. Context providers: a Server Component passing the whole session/user object into a client `<SessionProvider value={...}>`.
5. `generateMetadata` and Open Graph routes that render private fields into public metadata/images.
6. Public pages (profiles, shared documents) that show another user's record: field-level authorization is needed, not just "the page is public".

## Fix pattern

Return DTOs from the Data Access Layer and type client props narrowly:

```ts
// lib/dto/user.ts
import 'server-only'
export async function getPublicProfile(username: string) {
  return db.user.findUnique({
    where: { username },
    select: { username: true, displayName: true, avatarUrl: true, bio: true },
  })
}
```

```tsx
'use client'
type Props = { profile: { username: string; displayName: string; avatarUrl: string | null; bio: string | null } }
```

For actions, return `{ ok: true }` or the minimal fields the UI renders.

## `server-only`, `client-only` and taint APIs

- `import 'server-only'` at the top of a module makes the **build fail** if a Client Component imports it. Use it in the DAL, DB clients, privileged SDK clients and anything reading secret env vars. Missing `server-only` is a Hardening finding by itself, and a real finding when a client module already imports it (secrets or code ship in the bundle).
- React taint APIs (`experimental_taintObjectReference`, `experimental_taintUniqueValue`) are still experimental, enabled with `experimental.taint: true` in `next.config`. They block passing a tainted object/value to the client but not derived values or copied fields. They are an extra layer, not a replacement for DTOs.

## Pages Router

- `getServerSideProps`/`getStaticProps` return values are serialized into the page as JSON (`__NEXT_DATA__`), visible in view-source. Returning a full user/session object → same issue as RSC props.
- `getStaticProps` data is public to everyone, including anything fetched with a privileged key at build time.
- `pages/api` handlers returning ORM objects: same as Route Handlers.

## Errors and logs

- In production, React sends a digest instead of the server error message to the client. In **development mode** messages and stacks are sent in plain text. A production deployment running `next dev` (check Dockerfiles, `package.json` `start` scripts, PM2 configs) leaks errors and source → High.
- Handlers that return `error.message`/`error.stack` in JSON bypass that protection.
- `console.log` of tokens, sessions or full request bodies in actions/handlers ends up in hosting logs (Low/Medium depending on log access).
- The source-code exposure advisory (CVE-2025-55183, App Router on 15.x/16.x before 15.0.7 … 16.0.10) returned compiled Server Function source; hardcoded secrets in that source were exposed. See `dependencies.md`.

## Severity notes, false positives, verification

- Secrets or credentials (hashes, reset tokens, MFA secrets, API keys) in the payload → **High**. Other users' PII → High. The current user's own non-sensitive fields → Informational.
- **Not findings:** passing the current user's own display fields; passing IDs needed for actions (still authorize the action); Server Components rendering sensitive data server-side into HTML that only the authorized user receives.
- **Verify:** load the page as an anonymous/other user and search the HTML/RSC payload for a sentinel value (e.g. a test user's hash prefix): `curl -s https://staging.example.com/profile/alice | grep -c '\$2b\$'` should be `0`. For RSC navigations, repeat with the `RSC: 1` header. Add a unit test asserting the DTO's keys.

References: OWASP API3:2023 (Broken Object Property Level Authorization); CWE-200, CWE-213, CWE-209; https://nextjs.org/docs/app/guides/data-security, https://react.dev/reference/react/experimental_taintObjectReference.
