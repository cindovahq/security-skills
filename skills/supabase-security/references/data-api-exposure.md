# Supabase — Data API Exposure, Grants and RLS Enablement

## Contents
- How a table becomes reachable
- Default privileges and the 2026 change
- What to investigate
- Fix pattern
- Column-level privileges
- GraphQL and schema discovery
- Severity
- False positives
- Verification

## How a table becomes reachable

The Data API (PostgREST at `/rest/v1/`, plus `pg_graphql` at `/graphql/v1` when enabled) serves tables, views and functions in the **exposed schemas** (`public` and `graphql_public` by default; `[api] schemas` in `supabase/config.toml`, or Settings > Data API on hosted projects). A request runs as `anon` (publishable key, no session), `authenticated` (with a user JWT) or `service_role` (secret key).

Postgres checks two layers, in order:

1. **Grants:** does the role have `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the table (or `EXECUTE` on the function)? Missing grant → error `42501`.
2. **RLS:** if enabled, which rows the operation may see or produce. Missing matching policy → zero rows (reads) or `42501` (a failed `WITH CHECK`).

So: **table in an exposed schema + grant to `anon`/`authenticated` + RLS disabled = anyone holding the public key can read and write every row.** Adding policies does not revoke grants, and policies do nothing while RLS is disabled (advisor `0007_policy_exists_rls_disabled`).

Superusers and roles with `BYPASSRLS` (`postgres`, `service_role` on Supabase) always bypass RLS. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` only subjects the **table owner** to RLS. It does not affect `BYPASSRLS` roles, so it rarely changes anything for Data API access on Supabase.

## Default privileges and the 2026 change

| Project | New tables in `public` |
|---|---|
| Created before 2026-05-30 (and not opted in) | `SELECT, INSERT, UPDATE, DELETE` granted automatically to `anon`, `authenticated`, `service_role`; new functions get `EXECUTE` |
| Created on or after 2026-05-30 (gradual rollout), or opted out of "Automatically expose new tables and functions" | **No automatic grants.** Tables are unreachable until an explicit `GRANT` |
| All existing projects from **2026-10-30** | New tables need explicit grants. Existing tables keep their current grants |
| Local stack (recent CLI) | Not auto-exposed unless `[api] auto_expose_new_tables = true` (deprecated, removed 2026-10-30) |

Consequences for review:

- **Old tables keep broad grants.** The change is not retroactive, so audit existing grants.
- **Blanket fixes reintroduce the risk.** Developers (and AI tools) who hit `42501` often paste `grant ... on all tables in schema public to anon, authenticated`. That re-exposes every table, including ones without RLS.
- Postgres itself grants `EXECUTE` on new functions to `PUBLIC`, independent of Supabase's default privileges. Revoke from `public` **and** `anon` (see `functions-views-triggers.md`).
- Tables created in the Dashboard Table Editor have RLS enabled by default. Tables created by SQL, migrations, ORMs (Prisma, Drizzle) or AI tools do not, unless an event trigger enables it.

## What to investigate

```text
create table   (then search the same and later migrations for "enable row level security" on that table)
disable row level security   no force row level security (only matters for owner-run code)
grant .* to anon   grant all   on all tables in schema   alter default privileges ... grant
schemas = [   (config.toml [api])   create schema   (new schemas exposed in settings?)
create materialized view   create foreign table   create view   (views: see functions-views-triggers.md)
```

1. Build a table inventory per exposed schema: RLS on/off, grants per role, policies per command. Migrations are the source of truth; also check `supabase/schemas/*.sql` (declarative schemas) and `seed.sql`.
2. Flag any exposed table without `enable row level security`, then rate it by its data and grants.
3. Check grants on tables that hold internal data (rate limits, audit logs, webhook events, job queues, `pgmq` queues; advisor `0019_insecure_queue_exposed_in_api`). Better: move them to a non-exposed schema such as `private`.
4. Materialized views and foreign tables cannot use RLS. If `anon`/`authenticated` can select them, all rows are exposed (advisors `0016_materialized_view_in_api`, `0017_foreign_table_in_api`).
5. Additional exposed schemas: anything added to `[api] schemas` or the Dashboard setting is fully reachable under the same rules.

## Fix pattern

Grants and RLS belong in the **same migration** as the table:

```sql
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  amount_cents integer not null
);

alter table public.invoices enable row level security;
revoke all on table public.invoices from anon, authenticated;
grant select on table public.invoices to authenticated;   -- only what the app needs

create policy "Members read their org invoices"
on public.invoices for select to authenticated
using ( (select private.is_org_member(org_id)) );
```

Opt an existing project into the new defaults before 2026-10-30 (future objects only):

```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
-- EXECUTE granted to PUBLIC can only be removed globally (per-schema default privileges
-- can't revoke a global grant). This affects every client role, so test before applying:
alter default privileges for role postgres
  revoke execute on functions from public;
```

Supabase's published opt-in SQL covers tables and sequences only. Functions still need per-function `revoke execute ... from public, anon, authenticated` (see `functions-views-triggers.md`) unless the global statement above is applied.

Internal tables: `revoke all on table public.x from anon, authenticated;` or move them to an unexposed schema. If the app never uses the Data API, disable it (Integrations > Data API).

## Column-level privileges

RLS is row-level only. To stop users changing `role`, `plan`, `org_id` or `is_verified` on rows they may otherwise update, use column grants or a trigger:

```sql
revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;
```

Revoking a column privilege does nothing while a table-level privilege remains. Restricted roles cannot `select *` on the table after column-level `SELECT` restrictions. Supabase recommends RLS plus a separate roles table over column privileges for most cases.

## GraphQL and schema discovery

- `pg_graphql` follows the same grants and RLS. It is no longer enabled by default on new projects (from 2026-05-18). If enabled, every table/view the role can select is in the schema (advisors `0026`/`0027`). Introspection is off by default on pg_graphql 1.6.0+ (shipped on projects created from 2026-06-29). Older projects keep introspection on until pg_graphql is upgraded.
- Since 2026-03-11 (new projects) and 2026-04-08 (all projects), the `anon` key can no longer fetch the OpenAPI document at `/rest/v1/`. Secret and `service_role` keys still can. Verify behavior for publishable keys on your project. Do not treat "the schema is hidden" as protection: table names are in the client bundle anyway.

## Severity

- Exposed table without RLS, granted to `anon`, holding personal, financial or auth data: **Critical** (unauthenticated read/write).
- Same, granted only to `authenticated` with open sign-up: **High/Critical** (anyone can register).
- Exposed table without RLS holding low-value public data, writable by `anon`: **Medium/High** (defacement, spam, storage abuse).
- Broad grants on tables that do have correct RLS: **Hardening**.
- Materialized view with tenant data selectable by `authenticated`: **High** for cross-tenant data.

## False positives

- RLS enabled with **no policies**: deny-all for `anon`/`authenticated` (advisor `0008` is INFO). Correct for server-only tables used with the secret key.
- Tables in schemas that are not exposed (`private`, `internal`) and are reached only through properly written functions.
- `to anon using (true)` read policies on genuinely public data (published posts, announcements, product catalog) with no write policies.
- A table without RLS whose grants to `anon`/`authenticated` were revoked (check the grant, not just the RLS flag).

## Verification

```sql
-- RLS status and client grants for every table in exposed schemas
select n.nspname, c.relname, c.relkind, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('anon', c.oid, 'insert,update,delete') as anon_write,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'graphql_public') and c.relkind in ('r', 'p', 'v', 'm', 'f')
order by rls, c.relname;
```

```bash
# Against a local stack or a project you are authorized to test, with the publishable key only
curl -s "$SUPABASE_URL/rest/v1/invoices?select=*&limit=1" -H "apikey: $PUBLISHABLE_KEY"
# Expect: 42501 (no grant) or [] (RLS); any row means the table is exposed
```

Also run `supabase db advisors --local --type security` (or the Dashboard Security Advisor) and look for `0013_rls_disabled_in_public` and `0023_sensitive_columns_exposed`.

References: https://supabase.com/docs/guides/api/securing-your-api, https://supabase.com/docs/guides/database/postgres/row-level-security, https://supabase.com/docs/guides/database/postgres/column-level-security, https://github.com/orgs/supabase/discussions/45329, https://www.postgresql.org/docs/current/ddl-rowsecurity.html; CWE-284, CWE-862; OWASP API1:2023 (BOLA).
