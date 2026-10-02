# Next.js — Authentication and Sessions

## Contents
- Where auth lives in a Next.js app
- Custom sessions (`cookies()`, jose, iron-session)
- Auth.js / NextAuth
- Clerk
- Supabase at the Next.js boundary
- Severity notes and false positives
- Verification

## Where auth lives in a Next.js app

Next.js has no built-in auth. The docs recommend a library and split checks into **optimistic** (proxy, reading the cookie only) and **secure** (DAL, verifying the session and permissions close to the data). Review three things for any library:

1. **How the session is verified on the server** (signature/expiry check, or a call to the auth server), and whether every page, action and handler calls that verification.
2. **Cookie attributes** of the session cookie.
3. **Secrets and host trust** the library depends on.

## Custom sessions (`cookies()`, jose, iron-session)

`cookies()` from `next/headers` is async since 15 (synchronous access was removed in 16). Cookies can only be set in Server Actions and Route Handlers (and proxy), not during rendering.

The Next.js guide's recommended options:

```ts
(await cookies()).set('session', token, {
  httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: expiresAt,
})
```

Investigate:

- `httpOnly: false` on a session token readable by the server only → XSS can steal it (Medium; High combined with an XSS finding).
- `sameSite: 'none'` → cookie sent on cross-site requests: CSRF on Route Handlers and credentialed CORS reads (see `route-handlers-api.md`). Often added for iframe embedding.
- Missing `secure`, very long `expires`, no server-side revocation for stateless sessions.
- JWT handling: `jwtVerify` without `algorithms`, `decodeJwt`/`jwt.decode` used where verification is needed, `alg: none` acceptance, secrets from `NEXT_PUBLIC_*` or hardcoded fallbacks (`process.env.SESSION_SECRET ?? 'dev-secret'`).
- Session payloads containing PII or roles that are then trusted without re-reading the DB for sensitive operations (stale role after demotion).
- Login/logout implemented as `GET` Route Handlers (CSRF/prefetch side effects), and logout that only deletes the cookie while a stateless token remains valid.
- No rate limiting on credential-checking actions (login, OTP, password reset).

## Auth.js / NextAuth

Versions: `next-auth` 4.x (latest 4.24.15) and v5 (`next-auth@beta`, latest 5.0.0-beta.32 as of 2026-10), with `@auth/core` underneath.

| Setting | What to check |
|---|---|
| `AUTH_SECRET` (v5) / `NEXTAUTH_SECRET` (v4) | Required; "used to encode the JWT and encrypt things in transit". Must be random, not committed, not `NEXT_PUBLIC_`. |
| `trustHost` / `AUTH_TRUST_HOST` | Makes Auth.js trust `X-Forwarded-Host`. Auto-inferred on Vercel and Cloudflare Pages. Set it only behind a proxy that overwrites the host header; otherwise host-header injection affects callback URLs and emails. |
| Session strategy | JWT by default without an adapter; `database` by default with one. JWT sessions can't be revoked server-side before expiry. |
| `callbacks.redirect` | Default allows only same-origin URLs. A custom callback that returns `url` unchanged → open redirect. |
| `callbacks.session` / `jwt` | By default only `email`, `name`, `image` reach the client. Adding `accessToken`, refresh tokens or internal flags to the session exposes them to the browser via `useSession`/`/api/auth/session`. |
| `callbacks.authorized` | Used with the `auth` middleware wrapper. Optimistic only (see `middleware-proxy.md`). |
| `callbacks.signIn` | Account-linking rules; `allowDangerousEmailAccountLinking` on providers that don't verify email → account takeover. |

Recent advisories (fixed in `next-auth` 4.24.15 / 5.0.0-beta.32 / `@auth/core` 0.41.3, published 2026-07-20): CVE-2026-73420 (email normalizer homoglyph `@` bypass), CVE-2026-73419 (OAuth state/nonce/PKCE cookies not bound to the provider), CVE-2026-73418 (`getToken()` throws on malformed Bearer headers), CVE-2026-73421 (v5 betas: configuration errors could make existence-based checks fail open). Earlier: GHSA-5jpx-9hw9-2fx4 email misdelivery (fixed 4.24.12 / 5.0.0-beta.30). Use `if (!session?.user)`-style checks that can't be satisfied by an error object.

## Clerk

- Server-side: `auth()` from `@clerk/nextjs/server` in pages, actions and handlers; `auth.protect()` for redirects/404. Check `orgId`/`orgRole`/`has({ permission })` for tenant-level authorization, not just `userId`.
- `clerkMiddleware()` protects nothing by default. Clerk deprecates `createRouteMatcher()` for route protection in favor of resource-level checks.
- Advisories: CVE-2026-41248 (middleware route protection bypass, `@clerk/nextjs` fixed 5.7.6 / 6.39.2 / 7.2.1), CVE-2026-42349 (authorization bypass combining organization, billing or reverification checks; `@clerk/nextjs` fixed 6.39.3 / 7.2.4), CVE-2025-53548 (webhook verification, `@clerk/nextjs` fixed 6.23.3). Older: CVE-2024-22206 (`auth()`/`getAuth()` IDOR, fixed 4.29.3).

## Supabase at the Next.js boundary

RLS policies, `SECURITY DEFINER` functions and storage policies belong to the `supabase-security` skill. At the Next.js layer check:

- **`getSession()` on the server.** Supabase: "Never trust `supabase.auth.getSession()` inside server code such as Proxy. It reads the session out of the cookie without revalidating it." Use `getClaims()` (verifies the JWT signature) or `getUser()` (asks the Auth server). Using `getSession().user.id` to authorize, especially before a service-role query, lets a forged cookie impersonate any user → High/Critical.
- **Service-role / secret key** (`SUPABASE_SERVICE_ROLE_KEY`, or new-style secret keys) bypasses RLS. It must only be used in `server-only` modules, never in a `NEXT_PUBLIC_` variable and never imported by a `'use client'` file (Critical if it reaches a bundle). Queries made with it must apply the authorization RLS would have applied.
- **`createServerClient` per request** with `cookies: { getAll, setAll }`; never a module-level shared server client. The proxy refreshes tokens; Supabase warns that a cached response with refreshed auth cookies "served to a different user" signs that user in as the wrong person (see `caching.md`).
- Default `@supabase/ssr` cookie options are `sameSite: 'lax'`, `httpOnly: false` (by design). Overriding to `sameSite: 'none'` widens CSRF/CORS exposure.
- OAuth/magic-link callback routes (`app/auth/callback/route.ts`) that redirect to a `next` parameter → open redirect (see `ssrf-redirects.md`).

## Severity notes and false positives

- Session forgery or verification skipped → Critical/High. Weak cookie flags alone → Medium/Low (raise when chained).
- **Not findings:** `trustHost: true` on Vercel/Cloudflare (auto-inferred anyway); Supabase anon/publishable key in client code; Supabase cookies with `httpOnly: false` (Hardening at most); JWT sessions per se.

## Verification

- Unit-test the DAL: a tampered or unsigned token must yield `null`/redirect; an expired one too.
- Check cookie attributes in the browser devtools or `curl -s -D - -o /dev/null -X POST .../login ... | grep -i set-cookie`.
- For Supabase: grep server code for `auth.getSession(` and confirm each use is display-only.

References: OWASP ASVS 5.0 V6/V7 (authentication, session management); CWE-287, CWE-345, CWE-384, CWE-1004, CWE-1275; https://nextjs.org/docs/app/guides/authentication, https://authjs.dev/reference/nextjs, https://clerk.com/docs/reference/nextjs/clerk-middleware, https://supabase.com/docs/guides/auth/server-side/nextjs.
