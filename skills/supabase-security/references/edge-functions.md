# Supabase — Edge Functions

## Contents
- Two authentication layers
- What to investigate
- Fix patterns
- CORS
- Secrets and environment
- Outbound requests (SSRF) and webhooks
- Severity
- False positives
- Verification

Edge Functions are public HTTPS endpoints at `https://<ref>.supabase.co/functions/v1/<name>`. Treat each one as an API route. Node/Deno-general issues (input validation libraries, injection in other sinks) are in `nodejs-security`.

## Two authentication layers

1. **Platform `verify_jwt` check** (default **on**; per function in `supabase/config.toml` as `[functions.<name>] verify_jwt = false`, or `--no-verify-jwt` on deploy/serve). It only checks that the `Authorization` header carries a JWT signed for the project. It does **not** prove a user is signed in:
   - The legacy `anon` key **is** a valid project JWT (`role: anon`), and it ships in every client.
   - For migration compatibility, the check also accepts publishable and secret keys on either header.
2. **Your handler.** It must establish who the caller is and what they may do: verify the user (`supabase.auth.getUser(token)` / `getClaims(token)`, or `@supabase/server` with `auth: 'user'`), or verify a secret key (`auth: 'secret'`), or verify a webhook signature.

`@supabase/server`'s `withSupabase({ auth })` supports `'user'`, `'secret'` (optionally `'secret:<name>'`), `'publishable'`, `'none'`, or an array. It hands the handler `ctx.supabase` (RLS-scoped to the user), `ctx.supabaseAdmin` (bypasses RLS), `ctx.userClaims`, `ctx.authMode`, and handles CORS preflight.

## What to investigate

```text
verify_jwt = false   --no-verify-jwt   Deno.serve(   export default { fetch   withSupabase(   auth: 'none'   auth: 'publishable'
SUPABASE_SERVICE_ROLE_KEY   SUPABASE_SECRET_KEYS   createClient(Deno.env.get('SUPABASE_URL')
await req.json()   body.user_id   body.org_id   body.role   body.url   fetch(   Access-Control-Allow-Origin
```

1. **Caller identity.** Functions with `verify_jwt` on that never read the user from the token (or read `user_id` from the body) are effectively callable by anyone with the public key.
2. **Admin client + request IDs.** The common critical pattern: create a client with the service role / secret key, then act on `user_id`, `org_id`, `role`, `email` from the request body without checking that the verified caller owns or administers them.
3. **`verify_jwt = false`** functions: each must authenticate in code (secret key, webhook signature, or deliberate public endpoint). List them from `config.toml` and from deploy scripts (`--no-verify-jwt`).
4. **User-scoped client done right?** `createClient(url, publishableKey, { global: { headers: { Authorization: req.headers.get('Authorization')! } } })` makes PostgREST enforce RLS for that user. Mixing it with an admin client in the same function needs care about which client each query uses.
5. **Input validation** on every body field (types, enums for roles, lengths), and limits on batch sizes, file sizes and outbound calls (cost abuse: LLM calls, emails, SMS).
6. **Error handling** that returns stack traces, upstream responses or env values.

## Fix patterns

```ts
import { withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@3'

const Body = z.object({ orgId: z.string().uuid(), email: z.string().email(), role: z.enum(['member']) })

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return Response.json({ error: 'invalid input' }, { status: 400 })
    const { orgId, email, role } = parsed.data

    // Authorize with the caller's own RLS-scoped client before using admin powers
    const { data: me } = await ctx.supabase
      .from('org_members').select('role')
      .eq('org_id', orgId).eq('user_id', ctx.userClaims!.id).single()
    if (me?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 })

    const { data: invited, error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email)
    if (error) return Response.json({ error: 'invite failed' }, { status: 400 })
    await ctx.supabaseAdmin.from('org_members').insert({ org_id: orgId, user_id: invited.user.id, role })
    return Response.json({ ok: true })
  }),
}
```

Without `@supabase/server`, verify explicitly:

```ts
const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
const { data, error } = await userClient.auth.getUser(token)   // or getClaims(token)
if (error || !data.user) return new Response('unauthorized', { status: 401 })
```

## CORS

- Browser calls need preflight handling. Supabase's own examples use `Access-Control-Allow-Origin: *` with the headers `authorization, x-client-info, apikey, content-type` (plus `x-retry-count` and trace headers in newer SDKs); `supabase-js` 2.95.0+ exports `corsHeaders` from `@supabase/supabase-js/cors`.
- Because auth uses a bearer token in a header (not cookies), `*` does not let other sites act as the user. It becomes a problem only if the function authenticates via cookies or returns data based on network position (internal callers, IP allow-lists).
- Reflecting `Origin` together with `Access-Control-Allow-Credentials: true` on cookie-authenticated functions is the real misconfiguration.

## Secrets and environment

- Read secrets with `Deno.env.get`. Set them with `supabase secrets set` or the Dashboard; locally in `supabase/functions/.env` (git-ignored). Names cannot start with `SUPABASE_`.
- Injected: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` (JSON maps), `SUPABASE_JWKS`, plus legacy `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.
- Never return or log `Deno.env.toObject()`, headers, or upstream error bodies that may contain keys.
- Service-to-service callers (cron, `pg_net`, workers) should send a dedicated **named** secret key on `apikey` and the function should accept only that key (`auth: 'secret:<name>'`), not the general admin key.

## Outbound requests (SSRF) and webhooks

- `fetch(body.url)` (link previews, image import, webhook testers) is SSRF. Allow-list schemes (`https:`) and hosts, resolve and block private, loopback, link-local and metadata ranges, cap redirects and response size, and do not return raw upstream bodies. Rate by what the runtime can reach and whether the response is returned.
- Webhook receivers (`verify_jwt = false`, `auth: 'none'`) must verify the provider signature over the **raw** body (`await req.text()`) before parsing. On Deno, Stripe needs `constructEventAsync` with `Stripe.createSubtleCryptoProvider()`. Make handlers idempotent (store event IDs).
- Auth HTTP hooks and Database Webhooks calling functions should authenticate with a secret (Standard Webhooks signature or a named secret key).

## Severity

- Admin-client function acting on request-supplied user/org/role without authorization: **Critical** if callable with only the public key (verify_jwt on or off), **High** if it needs any signed-in user.
- `verify_jwt = false` with sensitive actions and no in-code authentication: **Critical/High**.
- Unauthenticated SSRF returning response bodies: **High** (Medium if blind and egress is restricted).
- Unsigned webhook that changes billing or entitlement state: **Critical/High**.
- CORS `*` on bearer-token functions: not a finding.

## False positives

- `verify_jwt = false` on webhook receivers that verify signatures, and on deliberately public, read-only endpoints (health checks).
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEYS` read inside the function: correct location.
- `Access-Control-Allow-Origin: *` with header-based auth.

## Verification

```bash
supabase functions serve                    # local; respects [functions.*] in config.toml
# Only the publishable/anon key, no user token: must be rejected by a function that acts for users
curl -s -X POST http://127.0.0.1:54321/functions/v1/invite-member \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"orgId":"<other-org-uuid>","email":"test-user@example.test","role":"member"}'
# As user B with B's JWT against org A: expect 403
```

References: https://supabase.com/docs/guides/functions/auth, https://supabase.com/docs/guides/functions/auth-headers, https://supabase.com/docs/guides/functions/function-configuration, https://supabase.com/docs/guides/functions/cors, https://supabase.com/docs/guides/functions/secrets, https://github.com/supabase/server; CWE-306, CWE-639, CWE-918, CWE-345.
