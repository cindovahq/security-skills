# Supabase — API Keys, Secrets and Key Rotation

## Contents
- Key types and the Postgres role each one maps to
- Where each key may live
- What to investigate
- The legacy JWT secret and signing keys
- Secrets in the database (Vault) and in Edge Functions
- Fix and rotation
- Severity
- False positives
- Verification

## Key types and the Postgres role each one maps to

| Key | Format | Postgres role | Bypasses RLS | Where it belongs |
|---|---|---|---|---|
| Publishable | `sb_publishable_...` | `anon` (no user session) or `authenticated` (with a user JWT) | No | Anything you ship: browser, mobile, desktop, CLI |
| Secret | `sb_secret_...` | `service_role` | **Yes** (`BYPASSRLS`) | Servers, Edge Functions, jobs you control |
| `anon` (legacy) | Long-lived JWT (`eyJ...`) | `anon` | No | Same as publishable |
| `service_role` (legacy) | Long-lived JWT (`eyJ...`) | `service_role` | **Yes** | Same as secret |

Facts that change review conclusions:

- The publishable/`anon` key **identifies the app, not the user**. It is public by design. Security comes from grants and RLS, not from hiding it.
- Supabase is deprecating the legacy `anon` and `service_role` keys (removal planned for late 2026, date to be confirmed). Projects created since November 2025 may not have them at all. Creating new keys does **not** revoke the legacy ones. They keep working until disabled under Settings > API Keys.
- New secret keys are rejected (HTTP 401) when sent from a browser, based on `User-Agent`. That is a guard rail, not a control: the key still works from curl or a script. Legacy `service_role` JWTs have no such check.
- **In observed gateway behavior, a secret key bypasses RLS only when the request carries no user access token** (not stated in the official docs; confirm on your stack). If a client built with the secret key also has a user session attached (for example after calling `auth.signInWithPassword` on it, or `createServerClient` reading a session cookie), requests run under that user's RLS. The reverse is the dangerous case: a "user" client built with the secret key acts as `service_role` whenever no session cookie is present.
- Send publishable and secret keys in the `apikey` header. They are not JWTs.

## Where each key may live

A key in any of these is public: client bundles, mobile app binaries, `NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*` (SvelteKit/Astro), `EXPO_PUBLIC_*`, `NUXT_PUBLIC_*`, `REACT_APP_*`, browser extension code, desktop apps, public repos, CI logs, error trackers, URLs and query strings.

## What to investigate

```text
SERVICE_ROLE   service_role   SUPABASE_SECRET_KEY   SUPABASE_SECRET_KEYS   sb_secret_   SUPABASE_JWT_SECRET
NEXT_PUBLIC_.*(SERVICE|SECRET)   VITE_.*(SERVICE|SECRET)   EXPO_PUBLIC_.*(SERVICE|SECRET)   PUBLIC_.*SERVICE
createClient( ... SERVICE   auth: { persistSession: false }   supabaseAdmin   adminClient   .auth.admin.
```

1. **Env names and bundling.** A secret or `service_role` value under a client-exposed prefix is public even if it is "only used on the server". Check `.env*`, `next.config.*` `env:` blocks, Vite `define`, Expo `app.config.*` `extra`, `eas.json`, Dockerfiles and CI workflows.
2. **Import graph.** Find modules that create an admin client and check every importer. In Next.js, anything imported by a `'use client'` file ships to the browser (see `nextjs-security`). A module-level `createClient(url, process.env.SUPABASE_SECRET_KEY!)` imported into client code either leaks the key (if prefixed) or breaks at runtime.
3. **Committed values.** Real keys in migrations (cron/`pg_net` headers, trigger bodies), `seed.sql`, `supabase/functions/.env`, `config.toml`, test fixtures, Postman collections, mobile `google-services`-style config files. Decode any `eyJ...` value you find (header and payload only, never print it in full): `"role":"service_role"` is critical, `"role":"anon"` is expected.
4. **Logs and responses.** Edge Functions or API routes that echo `Deno.env.toObject()`, return error objects containing headers, or log request headers.
5. **The legacy JWT secret.** `SUPABASE_JWT_SECRET` / `JWT_SECRET` in app code means the app verifies or **mints** tokens with the shared secret. Anyone holding it can mint a `service_role` token.

## The legacy JWT secret and signing keys

- Projects can sign user JWTs with asymmetric signing keys (the default for new projects) or the legacy shared JWT secret. With the legacy secret, the same secret signs the `anon`/`service_role` keys and user tokens, so a leak lets an attacker forge any role.
- With asymmetric keys, Supabase exposes the public keys at the JWKS endpoint, and `supabase.auth.getClaims()` verifies tokens locally. Rotation and revocation do not require redeploying backends that use `getClaims()`.
- Custom JWT minting in your backend (third-party auth bridges, "login as" features) needs the same review as a password reset flow: who can request a token for which `sub` and `role`.

## Secrets in the database (Vault) and in Edge Functions

- **Vault:** `vault.create_secret(value, name)` stores encrypted secrets. `vault.decrypted_secrets` decrypts on read, so anyone who can select from it has the plaintext. Never expose it through a view or a `SECURITY DEFINER` function callable by `anon`/`authenticated`.
- **Edge Functions:** secrets come from `Deno.env.get(...)`. The platform injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` (JSON maps keyed by name), `SUPABASE_JWKS`, and the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Custom secret names cannot start with `SUPABASE_`. Locally they come from `supabase/functions/.env`, which must be git-ignored.
- **Separate secret keys per component** (one per Edge Function group, worker or server) limit the blast radius, and `@supabase/server` can accept only a named key (`auth: 'secret:automations'`).

## Fix and rotation

```ts
// server-only module (never imported by client code)
import 'server-only' // Next.js; see nextjs-security
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

Rotation after a leak (removing the value from the code is not enough):

1. Fix the leak path first (bundle, repo, logs).
2. Create a new secret key under Settings > API Keys and deploy it everywhere.
3. Confirm nothing still uses the old one, then delete the leaked secret key, or deactivate the legacy `anon`/`service_role` keys (reversible).
4. If the legacy JWT secret leaked, migrate to signing keys, **disable the legacy `anon` and `service_role` keys first** (they are JWTs signed with that secret), then revoke the legacy secret after the access-token lifetime has passed (immediately during an active incident).
5. Review data changes made while the key was exposed (Postgres logs, API logs).

## Severity

- Secret or `service_role` key in a client bundle, mobile app or public repo: **Critical** (full read/write of every table, Storage object and Auth user, regardless of RLS).
- Legacy JWT secret exposed: **Critical** (forge any role or user).
- Secret key in a private repo, CI log or server log: **High**; rotate.
- Secret key in server-only env with no client path: not a finding.

## False positives

- Publishable or `anon` key in client code, mobile apps or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: **expected**. Review RLS instead.
- Local-stack keys printed by `supabase start`/`supabase status` and committed for local tests: they only work against the local stack. Confirm they are not the hosted project's keys.
- `SUPABASE_SERVICE_ROLE_KEY` read via `Deno.env.get` inside an Edge Function: correct placement (the question is then whether the function authorizes callers, see `edge-functions.md`).

## Verification

```bash
# Built client bundles must not contain secret material (run after a production build)
grep -rEl 'sb_secret_|service_role' .next/static dist build 2>/dev/null
# Decode a found JWT's payload to check its role (do not print the signature)
echo '<payload-part>' | base64 -d 2>/dev/null; echo
```

References: https://supabase.com/docs/guides/getting-started/api-keys, https://supabase.com/docs/guides/auth/signing-keys, https://supabase.com/docs/guides/functions/secrets, https://supabase.com/docs/guides/database/vault; CWE-798, CWE-200, CWE-522; OWASP A02:2025 (Security Misconfiguration).
