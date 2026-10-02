# Supabase — Writing and Reviewing RLS Policies

## Contents
- Policy semantics that matter
- Identity inside a policy
- Common policy bugs
- Fix patterns
- Anonymous users and MFA
- Severity
- False positives
- Verification

## Policy semantics that matter

| Clause | Applies to | Meaning |
|---|---|---|
| `for select ... using (...)` | Rows read (and rows targeted by `update`/`delete`) | Filters existing rows silently |
| `for insert ... with check (...)` | New rows | Rejects rows that fail (`42501`) |
| `for update ... using (...) with check (...)` | `using`: which rows may be changed; `with check`: what the row may become | If `with check` is omitted, the `using` expression is applied to the new row too |
| `for delete ... using (...)` | Rows deleted | Filters silently |
| `for all` | Every command | Hides which rule was meant for which command; avoid |
| `to authenticated` / `to anon` | Roles the policy applies to | **Omitted = `public` = every role, including `anon`** |
| `as permissive` (default) | | Permissive policies for the same command are **OR**-ed |
| `as restrictive` | | Restrictive policies are **AND**-ed with the permissive result. A restrictive policy alone grants nothing |

Consequences:

- One loose permissive policy defeats every strict one on the same table and command (the closest security advisor rule is `0024_permissive_rls_policy`; `0006_multiple_permissive_policies` is a performance lint that also surfaces overlapping policies).
- `UPDATE` needs a matching `SELECT` policy to find the rows.
- RLS is row-level. A user allowed to update their row can update **every granted column** of it, including `role`, `org_id`, `user_id`, `plan`, `credits` (see `data-api-exposure.md` → Column-level privileges).
- Subqueries inside a policy are themselves subject to the RLS of the tables they read (unless they go through a `SECURITY DEFINER` function). Two tables whose policies read each other fail with `42P17` infinite recursion.

## Identity inside a policy

| Expression | Source | Trust |
|---|---|---|
| `auth.uid()` | `sub` claim of the verified JWT | Trusted. `null` for `anon` |
| `auth.jwt() ->> 'role'`, `'aal'`, `'is_anonymous'`, `'session_id'` | Verified JWT | Trusted |
| `auth.jwt() -> 'app_metadata'` | `auth.users.raw_app_meta_data` | Trusted (users cannot change it; only the secret key / admin API can). Stale until the token refreshes |
| `auth.jwt() -> 'user_metadata'` | `auth.users.raw_user_meta_data` | **User-controlled.** `supabase.auth.updateUser({ data: { role: 'admin' } })` changes it |
| `auth.jwt() ->> 'email'` | Verified JWT | The user's address, but only proves ownership if email confirmation is enforced (see `auth-config.md`) |
| Claims added by a custom access token hook | Your hook, at token issue | Trusted if the hook reads trusted tables |
| `current_setting('request.headers', true)` | HTTP request | Client-controlled except where the platform sets it |
| `auth.role()`, `auth.email()` | | Deprecated. Use `to <role>` and `auth.jwt() ->> 'email'` |

`auth.uid()` returning `null` makes `auth.uid() = user_id` false, so anon is blocked by accident. State it explicitly with `to authenticated`.

## Common policy bugs

```sql
-- 1. Always-true or "any signed-in user" on private data (advisor 0024_permissive_rls_policy)
create policy "read" on documents for select using (true);
create policy "read" on documents for select to authenticated using (true);   -- anyone who signs up

-- 2. Trusting user_metadata (advisor 0015_rls_references_user_metadata)
using ( (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' )

-- 3. Checking that a column is set instead of matching it to the caller
using ( share_token is not null )            -- every shared row is public; the token is never compared
using ( org_id is not null )

-- 4. Insert/update without ownership on the new row
create policy "insert" on org_members for insert to authenticated
  with check ( user_id = (select auth.uid()) );   -- user joins ANY org, with ANY role
create policy "update own" on profiles for update to authenticated
  using ( id = (select auth.uid()) );             -- can set role = 'admin' on own row

-- 5. Missing TO clause on a policy meant for signed-in users
create policy "comment" on comments for insert with check ( true );   -- applies to anon too

-- 6. Policy subqueries that trust a client-writable table
using ( exists (select 1 from team_members where user_id = auth.uid() and team_id = docs.team_id) )
-- safe only if team_members itself cannot be written by the user (see bug 4)
```

Also check:

- **Tenant checks against the wrong column**: comparing a child row's `org_id` to the caller's membership but letting the caller choose `org_id` on insert, or checking `project.org_id` while the row has its own unverified `org_id`.
- **Stale claims**: authorization from `app_metadata` or hook claims persists until the access token expires (`jwt_expiry`, default 3600 s). Revoking an admin role is not immediate. Read membership from tables for sensitive actions.
- **Policies on views** do not exist; views need `security_invoker` (see `functions-views-triggers.md`).
- **Realtime and Storage** reuse RLS on `realtime.messages` and `storage.objects` (see `realtime.md`, `storage.md`).

## Fix patterns

```sql
alter table public.documents enable row level security;

create policy "Members read org documents" on public.documents
for select to authenticated
using ( (select private.is_org_member(org_id)) is true );

create policy "Members create documents in their orgs" on public.documents
for insert to authenticated
with check ( created_by = (select auth.uid()) and (select private.is_org_member(org_id)) );

create policy "Authors update their documents" on public.documents
for update to authenticated
using ( created_by = (select auth.uid()) )
with check ( created_by = (select auth.uid()) and (select private.is_org_member(org_id)) );
```

- Wrap helper calls as `(select auth.uid())` / `(select private.f())` so Postgres evaluates them once per statement (advisor `0003_auth_rls_initplan`). Only valid when the result does not depend on the row. Index the columns policies filter on.
- Share links: look the token up in a `SECURITY DEFINER` function (`get_shared_document(token text)`) that compares the supplied token to the stored one, rather than a table policy.
- Privileged columns: column grants, a `before update` trigger that rejects changes to `role`/`org_id` unless the caller is allowed, or keep roles in a separate table writable only by admins.
- Role data for policies: `app_metadata` (set server-side) or a custom access token hook, never `user_metadata`.

## Anonymous users and MFA

- Anonymous sign-ins (`enable_anonymous_sign_ins`) create real users with the **`authenticated`** role and an `is_anonymous: true` claim. Every `to authenticated` policy applies to them. Distinguish with a restrictive policy:

```sql
create policy "Only permanent users can post" on public.posts as restrictive
for insert to authenticated
with check ( (select (auth.jwt() ->> 'is_anonymous')::boolean) is false );
```

- MFA is only enforced where you check `aal`. A UI-only MFA prompt does nothing for direct API calls:

```sql
create policy "Require MFA for billing" on public.billing_settings as restrictive
to authenticated using ( (select auth.jwt() ->> 'aal') = 'aal2' );
```

## Severity

- Policy lets any signed-up user read or modify other tenants' data: **High/Critical** (sign-up is usually open; check `enable_signup`).
- Privilege escalation via `user_metadata`, self-assigned role columns or self-join of an org as admin: **Critical/High**.
- Policy without `to` that unintentionally includes `anon` on writes: **High** if it allows unauthenticated writes to user data.
- `auth.uid()` not wrapped in `select`: performance, not security (**Info**).
- Deprecated `auth.role()` used correctly: **Info/Hardening**.

## False positives

- `using (true)` on intentionally public read-only data (catalogs, published content) with no write policy.
- `auth.uid() = user_id` without `(select ...)`: correct, just slower.
- Multiple permissive policies that are each correctly scoped (owner OR org admin).
- A single restrictive policy combined with permissive ones: intended AND semantics.
- `security definer` helper functions in a non-exposed schema used inside policies to avoid recursion (see `functions-views-triggers.md`).

## Verification

Write pgTAP tests per table (`supabase/tests/<table>_rls.test.sql`) that assert allow **and** deny for `anon`, the owner, another user, and a member of another tenant. See `verification.md` for templates. Quick manual check:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select count(*) from public.documents;                                   -- expect only that user's org rows
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222' returning role;  -- expect 42501 or no row
rollback;
```

References: https://supabase.com/docs/guides/database/postgres/row-level-security, https://supabase.com/docs/guides/troubleshooting/deprecated-rls-features-Pm77Zs, https://supabase.com/docs/guides/auth/auth-anonymous, https://supabase.com/docs/guides/auth/auth-mfa, https://www.postgresql.org/docs/current/sql-createpolicy.html; CWE-639, CWE-863, CWE-269.
