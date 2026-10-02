# Authorization and Access Control

## Contents
- Model the access rules
- Object-level authorization (IDOR / BOLA)
- Function-level authorization
- Property-level authorization
- Multi-tenancy
- Indirect entry points
- Backend-as-a-service rules (Supabase, Firebase)
- Verification

Broken access control is consistently the #1 web risk (OWASP A01). Spend proportionate time here.

## Model the access rules

Before hunting, write down who may do what: roles (anonymous, user, org member, org admin, staff, super admin), ownership (user owns record, org owns record), and special states (draft, archived, shared links). Then check each route against that model.

Where the framework enforces authorization:

| Ecosystem | Mechanisms |
|---|---|
| Express/Node | Route middleware, per-handler checks, CASL/Casbin |
| NestJS | Guards (`@UseGuards`, global `APP_GUARD`), `@Roles` + RolesGuard, CASL |
| Next.js | Server-side checks in Route Handlers, Server Actions, server components; `middleware.ts` (not sufficient alone) |
| Django / DRF | `@login_required`, `PermissionRequiredMixin`, DRF `permission_classes`, `get_queryset` scoping, `has_object_permission` |
| Rails | `before_action`, Pundit/CanCanCan, `current_user.records.find` |
| Spring | `SecurityFilterChain` rules, `@PreAuthorize`, method security |
| ASP.NET Core | `[Authorize(Policy=...)]`, `IAuthorizationService`, resource-based handlers, `FallbackPolicy` |
| Laravel | Policies/Gates, `can` middleware (see `laravel-security`) |

**UI checks are not authorization** (hidden buttons, client route guards, disabled fields).

## Object-level authorization (IDOR / BOLA)

For every handler that takes an identifier (path, query, body, header, GraphQL argument, WebSocket message):

1. Find the lookup (`findById(id)`, `get_object_or_404(Model, pk=pk)`, `repo.findOne({ id })`).
2. Check that it's scoped to the caller (`WHERE id = ? AND owner_id = ?`, `request.user.orders.get(pk=pk)`) **or** followed by an explicit ownership/permission check before any data is returned or changed.
3. Repeat for **all verbs and alternate routes**. `GET` is often protected while `PUT`, `PATCH`, `DELETE`, export or "duplicate" endpoints aren't.
4. Check nested routes: `/projects/:pid/tasks/:tid` must verify the task belongs to the project **and** the user may access the project.
5. Check batch operations: `ids: [...]` in a body. Each ID must be authorized.

Unguessable IDs (UUIDs) reduce discoverability but are not a control. IDs leak via URLs, emails, logs and other APIs.

## Function-level authorization

- Admin and staff routes protected only by "is logged in".
- Role checks on page routes but not on the API routes the page calls.
- Global "deny by default": is there a fallback that requires auth for unannotated routes (Spring `anyRequest().authenticated()`, ASP.NET `FallbackPolicy`, NestJS global guard)? Without one, every new route is public by default. Check routes added without annotations.
- HTTP method or path normalization bypasses: rules on `/admin` but not `/admin/`, case differences, `HEAD` vs `GET`, `X-HTTP-Method-Override`, trailing `.json`, framework differences between the security matcher and the router (e.g. Spring `mvcMatchers` vs `antMatchers` history).
- Privilege escalation via role fields writable by the user (mass assignment, profile update accepting `role`), or invite flows letting a user choose the role granted.

## Property-level authorization

- Responses including fields the caller shouldn't see (other users' emails, internal flags, password hashes). Serialize with explicit DTOs/serializers.
- Writes accepting fields the caller shouldn't set (`isAdmin`, `ownerId`, `price`, `status`, `verified`) → mass assignment (CWE-915). Use explicit allow-lists of writable fields.

## Multi-tenancy

- Tenant ID taken from the authenticated session or token claims, **never** from a client-supplied header, body or subdomain without verifying membership.
- Every query is tenant-scoped: ORM global scopes, row-level security, or repository wrappers. Look for escape hatches (raw SQL, `unscoped`, `withoutGlobalScopes`, admin/reporting queries, background jobs without tenant context).
- Caches, search indexes, file storage paths, queues and analytics are tenant-partitioned.
- Cross-tenant reads → **Critical/High** in B2B SaaS.

## Indirect entry points

- **GraphQL:** authorization per resolver and field, including nested relations (`user { orders { ... } }`) and mutations. Schema-level directives must be applied consistently.
- **WebSockets / real-time channels:** authorization on subscribe **and** per message. Channel names containing IDs must be checked.
- **Background jobs / queues:** jobs triggered with user-supplied IDs must re-check permission. Job consumers should not trust message content from shared queues.
- **Signed / shared links:** expiry, scope (one resource), revocation.
- **File/object storage:** private objects not publicly readable; presigned URLs short-lived and issued only after authorization.
- **Server Actions / RPC endpoints** (Next.js Server Actions, tRPC, gRPC): each is a public endpoint. Authorization is needed inside each one.

## Backend-as-a-service rules (Supabase, Firebase)

When clients talk directly to the database or storage, the **rules are the authorization layer**:

- **Supabase:** every table in exposed schemas (`public`) needs **RLS enabled** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) with policies using `auth.uid()`. Tables without RLS are readable and writable by anyone holding the anon key (which is public by design) → **Critical** when they hold user data. Check `USING` and `WITH CHECK` clauses (users can't insert rows for others). The `service_role` key must never reach the client. Policies trusting `auth.jwt() -> 'user_metadata'` are user-editable → bypassable. Storage buckets need policies too. Views can bypass RLS unless created with `security_invoker = true` (Postgres 15+). `SECURITY DEFINER` functions in exposed schemas run with owner privileges.
- **Firebase:** `firestore.rules`, `database.rules.json`, `storage.rules`. `allow read, write: if true;` or `if request.auth != null` (any signed-in user, and anyone can sign up) on user data → **Critical/High**. Rules must compare `request.auth.uid` with document ownership and validate `request.resource.data` fields on write.

## Verification

- Two-user (and two-tenant) tests for every object type: B accessing A's object via every verb and every entry point → 403/404, and the data is unchanged.
- Role tests: lowest-privilege user against admin routes → 403.
- BaaS: test with the anon/public key and a second test user that cross-user reads and writes fail (Supabase: `select` from another user's rows returns 0 rows; Firebase: rules unit tests with `@firebase/rules-unit-testing`).

References: OWASP Authorization Cheat Sheet, IDOR Prevention Cheat Sheet, Mass Assignment Cheat Sheet; OWASP API1/API3/API5:2023; CWE-284, CWE-285, CWE-639, CWE-862, CWE-863, CWE-915; Supabase RLS docs; Firebase Security Rules docs.
