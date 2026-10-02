---
name: supabase-security
description: Security review and secure-coding guidance for Supabase apps (Postgres with RLS, Auth, Storage, Edge Functions, Realtime), with web, mobile and SSR clients. Use when auditing or hardening a Supabase project, or when writing migrations, RLS policies, grants, database functions (RPC), views, storage buckets, Edge Functions, Realtime channels, auth settings, or client code using supabase-js or @supabase/ssr. Triggers on a supabase/ directory, supabase/migrations/*.sql, supabase/config.toml, supabase/functions/, @supabase/supabase-js or @supabase/ssr in package.json, and SUPABASE_URL or Supabase key env vars. Covers publishable, secret, anon and service_role keys, Data API exposure and grants, RLS policy bugs, multi-tenant isolation, SECURITY DEFINER functions and views, Storage policies, auth configuration (redirect URLs, email confirmation, MFA, anonymous users), getSession vs getClaims, Edge Function auth and SSRF, Realtime authorization, pg_net, cron and Vault, and advisor and pgTAP verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "@supabase/supabase-js 2.x (checked 2.117), @supabase/ssr 0.10-0.12, Supabase CLI 2.x (checked 2.119), Postgres 15 and 17"
  last-verified: "2026-10-02"
---

# Supabase Security

Find, explain, fix and verify security issues in Supabase-backed applications, and write Supabase schema, policies, functions and client code that do not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: audit, security review, "is my RLS right?", pre-launch check. Follow the workflow below and produce findings.
- **Build mode**: writing migrations, policies, functions, buckets, Edge Functions or client code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change and load only the reference for the area you touch.

If the `appsec-review` skill is installed, it owns the overall methodology and report format; this skill supplies the Supabase knowledge. For framework-general issues in the app around Supabase, use `nextjs-security` or `nodejs-security` if installed.

## The Supabase security model in one paragraph

Clients talk to Postgres directly through the Data API with a **public** key, so **grants and RLS policies are the authorization layer**. The publishable/`anon` key identifies the app, not the user, and is meant to be public. Each request runs as `anon`, `authenticated` (any signed-in user, including anonymous users) or `service_role` (secret key, **bypasses RLS**). A table in an exposed schema that a client role can reach without correct RLS is an open database. Everything else (Storage, Realtime, RPC functions, views) inherits from, or bypasses, that same model.

## Review workflow

### 1. Confirm the stack and versions

1. Confirm Supabase: `supabase/` with `config.toml` and `migrations/`, `supabase/functions/`, `@supabase/*` packages, `SUPABASE_URL`/`*_SUPABASE_*` env vars, or a self-hosted `docker-compose` with `supabase/*` images.
2. Read installed versions from the lock file: `@supabase/supabase-js`, `@supabase/ssr` (or deprecated `@supabase/auth-helpers-*`), `@supabase/server`, `@supabase/auth-js`. For self-hosted, read image tags for `supabase/gotrue`, `supabase/realtime`, `supabase/storage-api`, `supabase/postgres`.
3. Note which key generation is in use (`sb_publishable_`/`sb_secret_` vs legacy `anon`/`service_role` JWTs; legacy keys are being deprecated, with removal planned for late 2026 (date to be confirmed); projects created since November 2025 may not have them) and the project age: new tables are no longer auto-granted to client roles on new projects (from 2026-05-30) and on all projects from 2026-10-30. See `references/data-api-exposure.md`.
4. Note what is not in the repo: hosted Dashboard settings (auth, Realtime public access, exposed schemas) and changes made outside migrations. Findings that depend on them are **Likely** until confirmed.

### 2. Map the attack surface

- **Data API:** every table, view, materialized view and function in exposed schemas (`[api] schemas`, default `public`, `graphql_public`), with grants and RLS. Also GraphQL if `pg_graphql` is enabled.
- **Storage:** buckets (`storage.buckets` inserts, `[storage.buckets.*]`, `createBucket`) and `storage.objects` policies.
- **Realtime:** `realtime.messages` policies, `.channel(` usage, `supabase_realtime` publication.
- **Edge Functions:** `supabase/functions/*/index.ts`, `[functions.*] verify_jwt`, deploy flags.
- **Server code with the secret key:** API routes, Server Actions, workers, cron, webhook handlers.
- **Auth configuration:** `config.toml [auth*]`, redirect URLs, hooks, providers; database jobs (`cron.schedule`, `net.http_*`, webhooks).

### 3. Review each area

Load the reference for each area as you reach it.

| Area | Reference | Start by looking for |
|---|---|---|
| Keys and secrets | `references/api-keys-secrets.md` | `SERVICE_ROLE`/`sb_secret_`/`SECRET_KEY` under `NEXT_PUBLIC_`/`VITE_`/`EXPO_PUBLIC_`, admin clients imported by client code, `eyJ` values, legacy JWT secret |
| Data API exposure | `references/data-api-exposure.md` | `create table` without `enable row level security`, `grant ... to anon`, `on all tables in schema`, materialized views, extra exposed schemas |
| RLS policies | `references/rls-policies.md` | `using (true)`, missing `to`, `user_metadata`, update policies without column limits, `share_token is not null`, permissive OR |
| Multi-tenancy | `references/multi-tenancy.md` | Membership table insert/update policies, `org_id` on writes, membership helpers, JWT tenant claims |
| Functions, views, triggers | `references/functions-views-triggers.md` | `security definer` in `public`, missing `set search_path`, `execute` grants, views without `security_invoker`, `auth.users` in views, dynamic SQL |
| Storage | `references/storage.md` | `public = true` buckets with private files, bucket-only policies, `storage.foldername`, signed URL expiry, MIME/size limits |
| Auth configuration | `references/auth-config.md` | `enable_confirmations`, redirect wildcards, `site_url`, anonymous sign-ins, MFA enforcement, hooks |
| Server and SSR clients | `references/server-ssr-clients.md` | `getSession()` on the server, admin client with request filters, `.or(` with input, shared clients, cached `Set-Cookie` |
| Edge Functions | `references/edge-functions.md` | `verify_jwt = false`, service role + body IDs, missing caller check, `fetch(body.url)`, webhook signatures |
| Realtime | `references/realtime.md` | Channels without `private: true`, `realtime.messages` policies, `replica identity full`, broadcasts from triggers |
| Webhooks, cron, Vault | `references/webhooks-cron-vault.md` | Literal keys in `cron.schedule`/`net.http_post`, URLs from input, `vault.decrypted_secrets` exposure |
| Verification | `references/verification.md` | Advisors, catalog queries, pgTAP tests, safe curl checks |

### 4. Classify and report

Every finding needs evidence: the migration file and line (or code file:line), the exact SQL/code, which role can reach it (`anon`, any `authenticated`, members, admins), and what the attacker gets. Read migrations in order; later ones can undo earlier fixes.

### 5. Remediate and verify (when asked to fix)

Write the fix as a **new migration** (never edit applied migrations), with grants, RLS and policies together. Prove it with a pgTAP test that fails before and passes after, rerun the security advisors, and fix siblings. See `references/verification.md`.

## High-signal patterns

These are **investigation signals, not findings**. Trace each one.

```text
# Exposure and grants (SQL)
create table   (no matching "enable row level security")   disable row level security   grant all   grant .* to anon
on all tables in schema public to   alter default privileges .* grant   create materialized view   schemas = [

# Policies (SQL)
using (true)   with check (true)   create policy ... (no "to")   for all   user_metadata   raw_user_meta_data
auth.role()   auth.email()   is not null)   ->> 'email') like   for update ... using (...)  (no with check, privileged columns)
on org_members for insert   on profiles for update   as permissive   (multiple permissive policies per command)

# Functions, views, triggers (SQL)
security definer   (no "set search_path")   language plpgsql ... execute   format('%s'   || p_   create view   (no security_invoker)
join auth.users   from auth.users   raw_user_meta_data ->> 'role'   vault.decrypted_secrets   net.http_post(   cron.schedule(

# Storage (SQL / client)
insert into storage.buckets   public = true   'public', true   on storage.objects   bucket_id = '   createSignedUrl(   expiresIn

# Client and server code
SERVICE_ROLE   sb_secret_   SUPABASE_SECRET_KEY   NEXT_PUBLIC_.*(SERVICE|SECRET)   createClient(.*SERVICE   .auth.admin.
auth.getSession()   (server-side)   user_metadata   .or(`   .filter(req   .eq('org_id', req   createServerClient(.*SECRET
.channel(   (no private: true)   track(

# Edge Functions / config.toml
verify_jwt = false   --no-verify-jwt   SUPABASE_SERVICE_ROLE_KEY   await req.json()   fetch(body   enable_confirmations = false
additional_redirect_urls   *.vercel.app   **   enable_anonymous_sign_ins = true
```

## Common false positives

Do not report these without further evidence:

- **Publishable or `anon` key in client code, mobile apps or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.** Public by design. Review RLS instead.
- **RLS enabled with no policies.** Deny-all for client roles; correct for server-only tables (advisor `0008` is INFO).
- **`to anon, authenticated using (true)` on intentionally public, read-only data** (announcements, published content, catalogs) with no write policies.
- **`security definer` functions with `set search_path = ''`** in a non-exposed schema (`private`) with `execute` revoked from `public`/`anon`, used as policy helpers. Also definer functions that check `auth.uid()`/membership first.
- **Trigger functions** (`returns trigger`) such as `handle_new_user`: not callable over RPC. A finding only if they copy user-controlled metadata into privileged columns.
- **Views with `security_invoker = true`** (Postgres 15+), or views not granted to client roles.
- **`verify_jwt = false`** on webhook receivers that verify a provider signature, or on deliberately public endpoints.
- **`Access-Control-Allow-Origin: *` on Edge Functions** that authenticate with bearer headers rather than cookies.
- **Public buckets for public assets** (avatars, product images) when uploads are restricted to the owner's folder.
- **`auth.uid()` not wrapped in `(select ...)`**: a performance issue, not a vulnerability.
- **Secret/`service_role` key read from server-only env** (`Deno.env.get`, non-prefixed `process.env` in server modules).
- **`config.toml` local defaults** (`enable_confirmations = false`, localhost redirect URLs) when nothing indicates the hosted project uses them and nothing trusts the email claim.

## Severity calibration

| Who can exploit it | Typical severity for data access or privilege bugs |
|---|---|
| Anyone with the public key (`anon`), including unauthenticated visitors | Critical/High |
| Any signed-up user (`authenticated`) while sign-up is open (the default), including anonymous users if enabled | High (Critical for cross-tenant data or privilege escalation) |
| Members of the same tenant | Medium/High (by data and action) |
| Tenant or platform admins | Usually Low, unless it crosses tenants |

Common under-ratings to avoid:

- **"Requires authentication"** is not a mitigation when anyone can sign up. Check `enable_signup` and email confirmation before lowering severity.
- **Self-join of tenants, self-promotion via a role column, and `user_metadata` trust** are privilege escalations: rate the resulting access (usually **Critical**), not the "policy typo".
- **A `SECURITY DEFINER` function or definer view** over user data exposed to client roles is an RLS bypass for every row it can return.
- **Secret key exposure** is Critical regardless of RLS quality.

## Build-mode guardrails

When writing Supabase code, default to:

1. **Every exposed table in one migration:** `create table` → `alter table ... enable row level security` → explicit minimal `grant`s per role → one policy per command with `to authenticated` (or `to anon` only for public data). No blanket `grant ... on all tables`.
2. **Policies:** `using` for reads/targets, `with check` for new values; `(select auth.uid())`; no `user_metadata`, no `auth.role()`; restrictive policies for MFA (`aal2`) and anonymous-user limits.
3. **Privileged columns** (`role`, `org_id`, `user_id`, `plan`, `credits`) are not client-updatable: column grants, a separate admin-managed table, or a guard trigger.
4. **Tenancy:** membership rows are written only by admins or a validated invite function. Helpers are `security definer`, `set search_path = ''`, `stable`, in `private`, executable by `authenticated` only.
5. **Functions:** prefer `security invoker`. For `security definer`, pin `search_path = ''`, check the caller inside, `revoke execute ... from public, anon`, and grant to the narrowest role. No string-built dynamic SQL.
6. **Views:** `with (security_invoker = true)`; never expose `auth.users`; no materialized views to client roles.
7. **Storage:** private buckets by default, per-user or per-tenant path policies on every command, `file_size_limit` and exact `allowed_mime_types`, short-lived signed URLs issued after an authorization check.
8. **Keys:** publishable key in clients; secret keys only in server-only modules and Edge Function env, never under a client-exposed prefix, never in migrations (use Vault). Separate named secret keys per component.
9. **Server code:** user-scoped `createServerClient` per request with the publishable key; authorize with `getClaims()`/`getUser()`, never `getSession()`; admin client only after an explicit authorization check, with filters derived from verified identity; no user input in `.or()`/`.filter()` strings.
10. **Edge Functions:** keep `verify_jwt` on for user-called functions and still verify the user in code (`@supabase/server` `auth: 'user'`); webhooks verify signatures on the raw body; validate input; block private-network URLs on outbound fetches.
11. **Realtime:** `private: true` channels, `realtime.messages` policies that check membership for the topic, public access disabled.
12. **Auth:** email confirmation on, exact production redirect URLs, Site URL set, CAPTCHA on public sign-up, leaked-password protection where available, MFA enforced in RLS where required.
13. Add a **pgTAP test** per table and function you secure (anon, owner, other user, other tenant), and run `supabase db advisors --local --type security` before merging.

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the path from the attacker's role to the data or action is fully traced in migrations/code (grants, RLS state, policies, function body), or safely demonstrated on a local stack.
- **Likely**: one condition could not be verified (hosted settings, whether a migration was applied, Dashboard-made changes). Name it.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `supabase/migrations/20260801_init.sql:42` (policy "..." on public.documents)
- **Evidence:** the SQL/code, and which role reaches it (anon / any authenticated / member)
- **Impact:** what the attacker reads, changes or becomes
- **Preconditions:** sign-up open? hosted setting? key in use?
- **Fix:** new migration or code change (snippet)
- **Verify:** pgTAP test, advisor result, or curl with the publishable key
- **Refs:** CWE / OWASP / Supabase docs link
```

**Rules:** never invent tables, policies, settings or versions. Redact keys (`sb_secret_****`; for JWTs show only the `role` claim). Say explicitly when runtime verification was not performed. Only test projects the user is authorized to assess, prefer the local stack, and never use production data or destructive requests to prove a finding.

## References

- Supabase security docs: https://supabase.com/docs/guides/security/product-security
- Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Securing the Data API: https://supabase.com/docs/guides/api/securing-your-api
- API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Advisors (database linter): https://supabase.com/docs/guides/database/database-advisors
- Production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Default grants change (2026): https://github.com/orgs/supabase/discussions/45329
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
