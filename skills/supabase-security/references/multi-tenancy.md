# Supabase — Multi-Tenant Isolation (Orgs, Teams, Workspaces)

## Contents
- The membership table is the trust anchor
- What to investigate
- Fix pattern
- Invites, joins and role changes
- Server-side code and tenant context
- Severity
- False positives
- Verification

Most B2B Supabase apps model tenancy as `organizations` + a membership table (`org_members`, `team_members`, `memberships`) + tenant-owned tables with an `org_id`. Every tenant policy reduces to "is the caller a member of this row's org?", so the membership table decides everything.

## The membership table is the trust anchor

Review the membership table's policies first. If a user can insert or update membership rows freely, every policy that checks membership is bypassed.

```sql
-- Self-join of any tenant, with any role: tenant isolation is gone
create policy "join" on org_members for insert to authenticated
  with check ( user_id = (select auth.uid()) );

-- Self-promotion: member updates own row to role = 'admin'
create policy "update own membership" on org_members for update to authenticated
  using ( user_id = (select auth.uid()) );
```

Other anchors to check the same way: `profiles.org_id`, `users.tenant_id`, `app_metadata.org_id` written from client input via a server route, and custom access token hook claims derived from user-writable tables.

## What to investigate

1. **Membership writes:** who can `insert`, `update`, `delete` on the membership table? Expected: only org admins (via a helper), an invite-acceptance function, or the server with the secret key.
2. **Tenant column on writes:** `insert`/`update` policies on tenant tables must check membership for the **new** `org_id` (`with check`). Otherwise a user creates rows inside another tenant or moves rows between tenants.
3. **Cross-table consistency:** a `documents` row with both `project_id` and `org_id` where the policy checks `org_id` but the app trusts `project_id` (or the reverse). Either derive `org_id` with a trigger or use a composite foreign key `(project_id, org_id)`.
4. **Helper functions:** `is_org_member(org_id)` / `has_role(org_id, role)` should be `security definer`, `set search_path = ''`, `stable`, in a non-exposed schema, and read `auth.uid()` internally. A helper that takes `user_id` as a parameter and is exposed via RPC is an oracle (and sometimes an IDOR).
5. **JWT-claim tenancy:** `org_id` in `app_metadata` or a hook claim is stale until token refresh. Switching orgs or removing a member takes up to `jwt_expiry` seconds. Acceptable for low-risk data; not for offboarding.
6. **Aggregates and search:** views, materialized views, RPCs and full-text search functions that return counts or snippets across tenants (`security definer` views are the usual culprit).
7. **Storage and Realtime:** object paths (`{org_id}/...`) and channel topics (`org:{id}`) need the same membership check in `storage.objects` and `realtime.messages` policies (see `storage.md`, `realtime.md`).

## Fix pattern

```sql
create schema if not exists private;

create function private.is_org_member(_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_admin(_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

revoke execute on function private.is_org_member(uuid), private.is_org_admin(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid) to authenticated;

-- Membership: only org admins manage rows; nobody self-inserts
create policy "Members see co-members" on public.org_members
for select to authenticated using ( private.is_org_member(org_id) );
create policy "Admins add members" on public.org_members
for insert to authenticated with check ( private.is_org_admin(org_id) );
create policy "Admins change roles" on public.org_members
for update to authenticated using ( private.is_org_admin(org_id) ) with check ( private.is_org_admin(org_id) );
create policy "Admins remove members" on public.org_members
for delete to authenticated using ( private.is_org_admin(org_id) );
```

Creating an org: add the creator as admin in a trigger (`after insert on organizations`, `security definer`, `set search_path = ''`) or in a single RPC, not by letting clients insert membership rows. Consider whether an admin may demote the last admin or promote others to roles above their own.

## Invites, joins and role changes

- **Invite acceptance** should be a function that looks up an unexpired, unused invite by a high-entropy token **and** the caller's verified email, inserts the membership with the invite's role, and marks the invite used. Check that the role comes from the invite row, not from the caller.
- **Domain auto-join** ("anyone with @acme.com joins Acme"): requires confirmed emails. With email confirmation disabled, anyone can claim any address (see `auth-config.md`).
- **Server routes and Edge Functions** that add members with the secret key must verify the caller is an admin of the **target** org (see `edge-functions.md`).

## Server-side code and tenant context

- Code using the secret key bypasses RLS, so it must apply the tenant filter itself, using an org the server verified for the caller, never an `org_id` taken from the request alone.
- Prefer a user-scoped client (the caller's JWT) for tenant reads. RLS then enforces isolation even if the route forgets the filter.
- Background jobs and webhooks have no user. Carry the org ID from trusted data (the triggering row), not from the payload of an unauthenticated request.

## Severity

- Self-join of other tenants, self-promotion to admin, or cross-tenant reads/writes by any signed-up user: **Critical/High** (B2B data of every customer).
- Cross-tenant leak limited to names/counts: **Medium**.
- Stale role claims after removal (bounded by token lifetime): **Low/Medium**, higher for offboarding-sensitive apps.

## False positives

- Membership insert policies limited to admins via a `security definer` helper (the helper bypassing RLS is the point; it avoids recursion).
- Org creation policies that let any user create a **new** org (they become its only member).
- Service-role code that derives `org_id` from a verified membership lookup before querying.

## Verification

pgTAP: create two orgs with one member each. As member A, assert: select of org B rows is empty; insert into `org_members` for org B throws `42501`; update of own membership role is empty or throws; insert of a document with `org_id` = B throws. See `verification.md`.

References: https://supabase.com/docs/guides/database/postgres/row-level-security#use-security-definer-functions, https://supabase.com/docs/guides/local-development/testing/pgtap-extended, https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac; CWE-639, CWE-269, CWE-284; OWASP API1:2023.
