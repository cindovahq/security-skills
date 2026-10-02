# Supabase — Verifying Findings and Fixes

## Contents
- Principles
- Static inventory from migrations
- Advisors (database linter)
- Catalog queries
- pgTAP tests for RLS
- Safe HTTP checks with the publishable key
- Fix-verification checklist

## Principles

- Prefer the **local stack** (`supabase start`, `supabase db reset` to apply migrations and seed) or a **preview branch** over production. Never run writes, `db reset` or tests against a production database.
- Use the **publishable key and test users** you created to prove access. Do not use the secret key to demonstrate a client-side bug (it bypasses RLS by design).
- Prove access with harmless markers (a row your second test user created), not real customer data. Redact keys in reports (`sb_secret_****`, JWT payload role only).
- When you cannot run anything, mark the finding **Likely** and name the missing condition (hosted grants, hosted auth settings, whether a migration was applied).

## Static inventory from migrations

For each table/view/function/bucket in `supabase/migrations/*.sql` (and `supabase/schemas/`, `seed.sql`), record:

| Object | Exposed schema? | Client grants | RLS on? | Policies (cmd, roles, using, with check) | Notes |
|---|---|---|---|---|---|

Read migrations **in order**: a later migration may disable RLS, drop a policy, `grant ... on all tables`, or `alter view ... set (security_invoker = false)`. For hosted projects, migrations may not reflect the live schema; `supabase db pull`/`db diff` (read-only against a linked project) shows drift, and the Dashboard shows applied policies.

## Advisors (database linter)

```bash
supabase start
supabase db advisors --local --type security            # flags: --type all|security|performance, --level info|warn|error, --fail-on none|info|warn|error
supabase db advisors --linked --type security --fail-on error   # linked project (read-only), useful in CI
```

Security checks to read first: `0013_rls_disabled_in_public`, `0023_sensitive_columns_exposed`, `0007_policy_exists_rls_disabled`, `0015_rls_references_user_metadata`, `0024_permissive_rls_policy`, `0010_security_definer_view`, `0002_auth_users_exposed`, `0028`/`0029` (`SECURITY DEFINER` functions executable by `anon`/`authenticated`), `0011_function_search_path_mutable`, `0014_extension_in_public`, `0016_materialized_view_in_api`, `0019_insecure_queue_exposed_in_api`, `0025_public_bucket_allows_listing`, `0026`/`0027` (GraphQL exposure), `0012_auth_allow_anonymous_sign_ins`.

Advisors are deterministic pattern checks. They miss logic bugs (wrong column compared, self-join of tenants, `share_token is not null`) and can flag intended designs. Confirm each against the access model. Note: `supabase db lint` is a different command (plpgsql_check for function errors), not the security advisor.

## Catalog queries

```sql
-- Policies, in one place
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage', 'realtime') order by tablename, cmd;

-- Client grants per table
select table_schema, table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public'
group by 1, 2, 3 order by 2, 3;

-- Column-level update grants (privileged columns)
select table_name, column_name, grantee from information_schema.column_privileges
where table_schema = 'public' and privilege_type = 'UPDATE' and grantee = 'authenticated';
```

See `data-api-exposure.md` (RLS status), `functions-views-triggers.md` (definer functions, views), `storage.md` (buckets) and `webhooks-cron-vault.md` (jobs, Vault) for targeted queries.

## pgTAP tests for RLS

`supabase test new <name>` creates `supabase/tests/<name>.sql`; `supabase test db` runs every file with `pg_prove` against the local stack, each in its own transaction. Switch identity with `set local role` and the JWT claims that `auth.uid()` and `auth.jwt()` read:

```sql
begin;
select plan(5);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.test');
insert into public.organizations (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A', '11111111-1111-1111-1111-111111111111');
-- seed membership/rows as the table owner here, before switching roles

set local role anon;
select throws_ok($$ select * from public.documents $$, '42501', null, 'anon has no grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}';
select is_empty($$ select * from public.documents where org_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'non-member reads nothing from org A');
select throws_ok(
  $$ insert into public.org_members (org_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'admin') $$,
  '42501', null, 'non-member cannot join org A');
select is_empty($$ update public.profiles set role = 'admin'
  where id = '22222222-2222-2222-2222-222222222222' returning id $$, 'cannot self-promote');
select ok(not has_function_privilege('anon', 'public.get_org_member_emails(uuid)', 'execute'),
  'anon cannot call the email lookup');

select * from finish();
rollback;
```

Assertion rules (from Supabase's RLS guide):

- Missing grant or failed `with check` → `throws_ok(..., '42501', ...)`.
- `using` filtering a row out → no error: assert `is_empty` on the statement with `returning`, then prove the target row is unchanged.
- Never prove an allowed write with `lives_ok` alone (it passes on zero rows); use `returning` and `results_eq`.
- Test every command (`select`, `insert`, `update`, `delete`) for `anon`, the owner, another user, a member of another tenant, an anonymous user (`"is_anonymous": true`) and, where relevant, `aal1` vs `aal2`.
- `supabase-test-helpers` (`tests.create_supabase_user()`, `tests.authenticate_as()`, `tests.rls_enabled()`) shortens setup.

## Safe HTTP checks with the publishable key

Only against the local stack (`http://127.0.0.1:54321`) or a project you are authorized to test, using test accounts:

```bash
API=http://127.0.0.1:54321; KEY=$PUBLISHABLE_KEY
# Table read as anon: expect 42501 or []
curl -s "$API/rest/v1/invoices?select=id&limit=1" -H "apikey: $KEY"
# As test user B (get a token by signing in a test account)
TOKEN=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"user-b@example.test","password":"<test password>"}' | jq -r .access_token)
curl -s "$API/rest/v1/documents?select=id,org_id" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
# RPC as anon
curl -s -X POST "$API/rest/v1/rpc/<function>" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'
# Public bucket object
curl -sI "$API/storage/v1/object/public/<bucket>/<path>"
```

## Fix-verification checklist

1. The pgTAP test (or curl check) fails before the fix and passes after; positive cases still pass.
2. Advisors show no new ERROR/WARN for the fixed objects (`supabase db advisors --local --type security`).
3. Grants, RLS enablement and policies ship in the **same migration**, and the migration is applied to every environment (local, branches, production).
4. Sibling objects with the same pattern are fixed or listed (other tables with the same policy shape, other definer functions, other buckets, other Edge Functions with the admin client).
5. Alternate paths are closed: Data API, GraphQL, RPC, Storage, Realtime, Edge Functions and server routes using the secret key.
6. Leaked keys were **rotated**, not just removed; hosted Auth/Realtime settings were changed in the Dashboard or with `supabase config push` and confirmed with `supabase config diff`.

References: https://supabase.com/docs/guides/database/database-advisors, https://supabase.com/docs/guides/database/testing, https://supabase.com/docs/guides/local-development/testing/pgtap-extended, https://supabase.com/docs/guides/database/postgres/row-level-security#policy-tests, https://github.com/usebasejump/supabase-test-helpers.
