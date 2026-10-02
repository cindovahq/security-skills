# Supabase — Functions (RPC), Views, Triggers and Extensions

## Contents
- Functions are API endpoints
- SECURITY DEFINER review
- Dynamic SQL inside functions
- Views and materialized views
- Triggers
- Extensions and schemas
- Severity
- False positives
- Verification

## Functions are API endpoints

Every function in an exposed schema that a role can `EXECUTE` is callable at `POST /rest/v1/rpc/<name>` (and through `supabase.rpc('<name>', args)`), whether or not the app calls it. Postgres grants `EXECUTE` on new functions to `PUBLIC` by default, and older Supabase projects also grant it to `anon`/`authenticated` through default privileges. **RLS does not apply to functions themselves**, only to the tables they read as the executing role.

| Mode | Runs as | RLS on tables it touches |
|---|---|---|
| `security invoker` (default) | The caller (`anon`/`authenticated`) | Applies |
| `security definer` | The owner (usually `postgres`, which has `BYPASSRLS`) | **Bypassed** |

## SECURITY DEFINER review

For every `security definer` function, check:

1. **Location and grants:** is it in an exposed schema? Can `anon` / `authenticated` execute it? (advisors `0028_anon_security_definer_function_executable`, `0029_authenticated_security_definer_function_executable`). Helpers used only inside policies belong in a non-exposed schema such as `private`.
2. **Authorization inside:** does it check `auth.uid()` against the data it touches (ownership, membership, role)? A definer function that takes `org_id`/`user_id` as a parameter and returns rows without checking is an RLS bypass.
3. **`search_path`:** it must be pinned (`set search_path = ''`, with every object schema-qualified) (advisor `0011_function_search_path_mutable`). Without it, unqualified names resolve via the caller's `search_path`. Exploitation requires the attacker to create objects in a schema on that path, so on Supabase this is usually a hardening fix unless a client role has `CREATE` somewhere on the path.
4. **What it returns:** returning `auth.users` columns (email, phone, `raw_app_meta_data`), password-reset state, or `vault.decrypted_secrets`.
5. **Side effects:** writes, `net.http_post` (SSRF to arbitrary URLs if the URL is a parameter), `pg_notify`, role changes.

```sql
-- Finding: any visitor can list every member's email for any org
create function public.get_org_member_emails(p_org_id uuid)
returns table (user_id uuid, email text)
language sql security definer set search_path = ''
as $$
  select m.user_id, u.email::text from public.org_members m
  join auth.users u on u.id = m.user_id where m.org_id = p_org_id;
$$;
```

Fix:

```sql
create or replace function public.get_org_member_emails(p_org_id uuid)
returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_org_admin(p_org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text from public.org_members m
    join auth.users u on u.id = m.user_id where m.org_id = p_org_id;
end;
$$;
revoke execute on function public.get_org_member_emails(uuid) from public, anon;
grant execute on function public.get_org_member_emails(uuid) to authenticated;
```

Prefer `security invoker` when the function only needs the caller's own RLS-visible data.

## Dynamic SQL inside functions

`EXECUTE` with string concatenation is SQL injection, callable over the API:

```sql
execute 'select * from public.items order by ' || sort_col;              -- injectable
execute format('select * from public.items where name = ''%s''', p_name); -- injectable
execute format('select * from public.items order by %I', sort_col)       -- identifier quoting
  using ...;                                                             -- values via USING / %L
```

Allow-list identifiers (`if sort_col not in ('name','created_at') then raise ...`) and pass values with `using`. In a definer function this injection runs with `BYPASSRLS`.

## Views and materialized views

- Postgres views run with the **owner's** privileges unless `security_invoker = true` (Postgres 15+; Supabase runs 15 and 17). A view over RLS-protected tables, owned by `postgres` and selectable by `anon`/`authenticated`, returns every row (advisor `0010_security_definer_view`).
- Views that join `auth.users` expose emails and metadata (advisor `0002_auth_users_exposed`). Copy needed fields into a `public.profiles` table via a trigger instead.
- Materialized views cannot have RLS. Do not grant them to client roles (advisor `0016`).

```sql
create view public.project_stats with (security_invoker = true) as
  select p.org_id, count(*) as projects from public.projects p group by p.org_id;
-- existing view: alter view public.member_directory set (security_invoker = true);
```

On Postgres versions without `security_invoker`, revoke the view from `anon`/`authenticated` or move it to an unexposed schema.

## Triggers

- Trigger functions (`returns trigger`) cannot be called directly, so they are not RPC endpoints. They often are `security definer` (for example `handle_new_user` writing to `public.profiles` after `insert on auth.users`). Still pin `search_path`.
- **Copying metadata into privileged columns:** a signup trigger that copies `new.raw_user_meta_data ->> 'role'` (or `org_id`, `plan`) into `profiles` lets users choose their own role at sign-up (`signUp({ options: { data: { role: 'admin' } } })`). Only copy display fields.
- Triggers that enforce invariants (set `created_by = auth.uid()`, block changes to `role`) are good controls. Check they are `before` triggers and cover `update` as well as `insert`.
- Webhook triggers (`supabase_functions.http_request`, `net.http_post`) send row data outside the database (see `webhooks-cron-vault.md`).

## Extensions and schemas

- Extensions installed in `public` expose their functions over RPC (advisor `0014_extension_in_public`). Install into `extensions`.
- `pg_net` functions (`net.http_get`, `net.http_post`) are `security definer`. The `net` schema is not exposed, but any exposed function that calls them with caller-controlled URLs is SSRF.
- `pg_graphql` exposes the same functions and tables as GraphQL fields when enabled.

## Severity

- Definer function callable by `anon` that returns or modifies other users' data: **Critical/High**.
- Same, callable only by `authenticated` with open sign-up: **High**.
- SQL injection in a function callable by client roles: **Critical/High** (definer) or **High** (invoker, bounded by RLS and grants).
- Definer view over user data selectable by client roles: **High** (Critical if it includes `auth.users` secrets or PII at scale).
- Mutable `search_path` on a definer function with no client `CREATE` privilege: **Low/Medium (hardening)**.

## False positives

- `security definer` + `set search_path = ''` helpers in `private` used by policies, with `execute` revoked from `public`/`anon`.
- Definer functions that check `auth.uid()` / membership before doing anything, and expose only what the caller may see.
- `handle_new_user`-style triggers copying only display fields.
- Views with `security_invoker = true`, or views not granted to client roles.

## Verification

```sql
-- Definer functions in exposed schemas and who can call them
select p.oid::regprocedure as fn, p.prosecdef as definer, p.proconfig as settings,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by definer desc, fn;

-- Views without security_invoker
select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm');
```

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_org_member_emails" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"p_org_id":"<test-org-uuid>"}'      # expect 401/403/42501, not rows
```

References: https://supabase.com/docs/guides/database/functions, https://supabase.com/docs/guides/database/database-advisors, https://supabase.com/docs/guides/auth/managing-user-data, https://www.postgresql.org/docs/current/sql-createview.html; CWE-89, CWE-269, CWE-426, CWE-200.
