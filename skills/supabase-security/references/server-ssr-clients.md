# Supabase — Server, SSR and Client Library Usage

## Contents
- Three kinds of client
- Verifying the user on the server
- Cookie-based sessions with @supabase/ssr
- Secret-key (admin) clients
- PostgREST filter injection
- Mobile and desktop clients
- Library versions and advisories
- Severity
- False positives
- Verification

Framework-general issues (Server Actions, middleware-only auth, route handler CSRF, `server-only` imports) are covered by `nextjs-security` and `nodejs-security`. This file covers what is specific to Supabase clients.

## Three kinds of client

| Client | Created with | Acts as | RLS |
|---|---|---|---|
| Browser / mobile | `createBrowserClient` (`@supabase/ssr`) or `createClient` + publishable key | The signed-in user, else `anon` | Enforced |
| Server, user-scoped | `createServerClient` (`@supabase/ssr`) + publishable key + request cookies, or `createClient` with `global.headers.Authorization: Bearer <user JWT>` | The user from the request | Enforced |
| Server, admin | `createClient(url, secretKey)` | `service_role` (when no user token is attached) | **Bypassed** |

Rules that catch most bugs:

- Use the user-scoped client for anything done on behalf of a user. RLS then backs up your route logic.
- Use the admin client only for actions no user client can do (admin API, cross-tenant jobs), **after** your own authorization check, with filters derived from verified identity.
- Never build a user-scoped `createServerClient` with the secret key: requests without a session cookie then run as `service_role`, and requests with one run as the user. Both are surprising.

## Verifying the user on the server

| Method | Verifies | Use on the server for authorization? |
|---|---|---|
| `auth.getSession()` | Nothing: reads the session from storage (cookies) | **No.** Anyone can forge the cookie |
| `auth.getClaims()` | JWT signature and expiry (locally via JWKS with asymmetric signing keys; via the Auth server with the legacy secret) | Yes. Does not detect sessions revoked before expiry |
| `auth.getUser()` | Calls the Auth server with the token | Yes. Also detects signed-out/revoked sessions, at the cost of a network call |

Investigate:

```text
getSession()   session.user   session?.user.id   session.access_token   (in middleware/proxy, route handlers, server components, server actions, API routes, getServerSideProps, loaders)
user_metadata   user.user_metadata.role   user_metadata?.is_admin
```

- A server that reads `session.user.id` from `getSession()` and then queries with the **admin client** or makes non-Supabase decisions (billing, file access, admin pages) trusts a forgeable value: **High/Critical**.
- If the server only uses `getSession()` to decide what to render and then queries with the user-scoped client, PostgREST still verifies the JWT, so the forged session gets no data. Rate lower (**Low/Medium**) and fix anyway.
- Authorization from `user.user_metadata` (role, is_admin, plan) is user-controlled through `auth.updateUser({ data })`, even after `getUser()`/`getClaims()`. Use `app_metadata`, a hook claim or a roles table.

## Cookie-based sessions with @supabase/ssr

- `@supabase/ssr` stores the session in cookies (`sb-<project_ref>-auth-token`) and uses PKCE by default. Use the `getAll`/`setAll` cookie methods; `get`/`set`/`remove` are deprecated types.
- Next.js: a proxy (`proxy.ts` on Next.js 16, `middleware.ts` before) must call `supabase.auth.getClaims()` to refresh tokens and must return the response object `setAll` built (with its cookies and cache headers). Server Components cannot write cookies.
- The cookies are intentionally readable by JavaScript (not `HttpOnly`); Supabase documents this as by design. XSS in the app therefore exposes tokens; see the framework skill for XSS.
- **Session leakage through caches:** a cached response containing `Set-Cookie` from a token refresh hands one user's session to others. `@supabase/ssr` 0.10.0+ passes `Cache-Control`/`Expires`/`Pragma` headers to `setAll`; they must be applied. Do not use ISR/static caching on routes that touch auth. CDNs with minimum TTL > 0 (for example CloudFront policies) can cache `Set-Cookie` regardless.
- **Shared clients across requests:** a user-scoped client stored at module scope (or reused by warm serverless instances, for example Vercel Fluid compute) can serve one user's session to another. Create the user-scoped client per request. A module-level **admin** client is acceptable because it carries no user session, provided `persistSession: false` and nothing ever signs in on it.
- `@supabase/auth-helpers-*` packages are no longer supported. Migrate to `@supabase/ssr`.

## Secret-key (admin) clients

```text
createClient(  SUPABASE_SECRET_KEY  SERVICE_ROLE  supabaseAdmin  .auth.admin.  .from(  .rpc(  .storage.from(
```

For every admin-client call, trace each filter value:

- `org_id`, `user_id`, `owner_id`, paths, or `id`s from the request body/query, not checked against the verified user → **IDOR/cross-tenant** (RLS will not save you).
- `auth.admin.updateUserById(id, { app_metadata | user_metadata | email | password })` with `id` from input → account takeover or privilege escalation.
- `auth.admin.generateLink`, `inviteUserByEmail`, `createUser` reachable by normal users → account creation/takeover primitives.
- Calling `signInWithPassword`/`setSession` on the admin client attaches a user session; later "admin" calls then run as that user (functional bug) and the client must never be shared.
- Returning admin query results directly (full rows including internal columns) to the browser.

## PostgREST filter injection

`supabase-js` passes some filter strings to PostgREST verbatim. User input concatenated into them can add conditions or change the logic:

```ts
.or(`title.ilike.%${q}%,body.ilike.%${q}%`)        // q = "x%,org_id.neq.00000000-0000-0000-0000-000000000000"
.filter(req.query.col, req.query.op, value)          // column and operator chosen by the user
.order(req.query.sort)  .select(req.query.fields)    // column/embedding chosen by the user
```

Under a user-scoped client, RLS bounds the damage. Under the admin client it can return any row. The `postgrest-js` docs say `.or()` filters are used as-is and must be sanitized by the caller. Fix: allow-list columns and operators, reject values containing PostgREST reserved characters (`,` `.` `:` `(` `)` `"`) or wrap them in double quotes per PostgREST syntax, or call an RPC with typed parameters. Also clamp `limit`/`range` from input (`[api] max_rows` caps responses, default 1000).

## Mobile and desktop clients

- Everything in the app binary is public: only the publishable key and project URL belong there. Secret keys in Expo `extra`, `app.json`, `Info.plist`, `strings.xml`, Flutter `--dart-define` or `.env` bundled assets are extractable.
- Store sessions in secure storage (Keychain/Keystore-backed adapters) rather than plain `AsyncStorage` when the threat model includes device compromise (hardening).
- Deep-link redirect URLs (`myapp://auth/callback`) must be in the Redirect URLs allow-list; custom schemes can be claimed by other apps, so prefer PKCE and universal/app links.

## Library versions and advisories

- `@supabase/auth-js` before 2.70.0: admin functions (`getUserById`, `deleteUser`, `updateUserById`, `listFactors`, `deleteFactor`) did not validate that IDs are UUIDs, allowing path manipulation when user input reaches them (CVE-2025-48370). Fixed in 2.70.0 (the advisory text also cites 2.69.1). Upgrade to 2.70.0 or later and validate IDs.
- `getClaims()` exists in `@supabase/auth-js` 2.69.0 and later (current `@supabase/supabase-js` 2.x includes it).
- Read installed versions from the lock file (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), not `package.json`.

## Severity

- Admin client with request-controlled tenant/user filters, reachable by any signed-in user: **High/Critical**.
- Server authorization from `getSession()` gating admin-client actions or admin pages: **High/Critical**; gating only user-scoped queries: **Low/Medium**.
- Authorization from `user_metadata`: **Critical/High**.
- Shared user-scoped client or cached `Set-Cookie` responses: **High** (session mix-ups across users) when confirmed in the deployment.

## False positives

- `getSession()` in **browser** code (reading local state) or used only to get the access token for a call that the server verifies.
- Module-level admin client in server-only code with `persistSession: false`.
- `createServerClient` with the publishable key per request, plus `getClaims()` in the proxy/middleware.
- `.eq('id', input)` on a user-scoped client: RLS decides; check the policy rather than the call.

## Verification

- Forge the session cookie in a local test (copy a valid cookie and edit the embedded user ID) and confirm protected server routes reject it (`getClaims()`/`getUser()` fail).
- As user B, call the API route with user A's `org_id`/`id`: expect 403/404 and no data.
- Search the production build output for `sb_secret_`, `service_role` (see `api-keys-secrets.md`).

References: https://supabase.com/docs/guides/auth/server-side/creating-a-client, https://supabase.com/docs/guides/auth/server-side/advanced-guide, https://supabase.com/docs/guides/getting-started/api-keys, https://github.com/supabase/auth-js/security/advisories/GHSA-8r88-6cj9-9fh5, https://postgrest.org/en/stable/references/api/tables_views.html; CWE-287, CWE-639, CWE-943, CWE-524.
