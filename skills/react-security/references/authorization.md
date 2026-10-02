# React — Authorization: Guards, Loaders, Actions and Server Functions

## Contents
- Client-side guards are UX
- What is public in router frameworks
- Parallel loaders and middleware
- What to investigate
- Fix patterns
- Data returned versus data displayed
- Severity, false positives, verification

## Client-side guards are UX

Everything in the browser is user-controlled: route guards, `<RequireAuth>`, `if (!user.isAdmin) return <Navigate to="/" />`, hidden menu items, disabled buttons, roles decoded from a JWT, feature flags in client config, `lazy()` admin chunks. They improve experience and do not protect data or actions. TanStack's own docs say it: "A route guard is not a data authorization boundary." The JavaScript for "hidden" admin screens is downloadable by anyone, along with the API paths it calls.

A SPA's authorization lives in its API. If the backend is in the repo, review it (`nodejs-security`, `laravel-security`, ...). If the API is a BaaS, review its rules (`supabase-security`; Firebase security rules). If only the frontend is in scope, report the client-side-only control as **Likely** and name the unverified server check.

## What is public in router frameworks

| Surface | Why it is a public HTTP endpoint |
|---|---|
| React Router `loader` | Called on SSR and, on client navigation, via a `fetch` to the route's `.data` URL (visible in the network tab). Calling that URL directly runs the loader |
| React Router `action` | `POST`/`PUT`/`PATCH`/`DELETE` to the route URL, with or without the UI |
| Resource routes (route modules without a default component) | Plain API endpoints. The action-origin CSRF check does not apply to them (React Router docs) |
| Remix v2 `loader`/`action` | Same model |
| TanStack Start `createServerFn` | "Same-origin RPC endpoints" (docs): `/_serverFn/<id>`. Docs: apply auth middleware "or an equivalent in-handler check to every server function that reads or writes private data" |
| TanStack Start server routes | Plain HTTP handlers |

`beforeLoad` (TanStack) and a parent route's `loader` redirect do not protect child loaders, server functions or other endpoints.

## Parallel loaders and middleware

React Router runs the loaders of all matched routes **in parallel**, in separate requests on client navigation, so a parent loader cannot short-circuit its children (Remix/React Router FAQ and middleware blog post). Each loader and action authenticates and authorizes on its own, or a shared guard function runs inside each.

Route `middleware` (APIs stabilized in 7.9.0; in 7.x framework mode it is enabled with `future.v8_middleware`, and it is always on in v8, per the changelog) runs parent to child before loaders. Docs caveat: on client-side navigations, server middleware only runs when a `.data` request is made for a `loader`/`action`; a route with middleware but no loader may skip it, and the docs suggest adding a loader. Treat middleware as one layer; keep the check next to the data.

## What to investigate

```ts
export async function loader({ params }: Route.LoaderArgs) {            // no requireUser()
  return db.ticket.findUnique({ where: { id: params.id } });             // IDOR: any id, any user
}
export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  await db.user.update({ where: { id: form.id }, data: form });          // mass assignment + no owner check
}
```

1. List every `loader`, `action`, `createServerFn`, server route and resource route. For each, confirm authentication first, then object-level checks (owner/tenant in the query predicate), then function-level checks (role for admin operations).
2. Admin routes whose component redirects non-admins but whose loader/action return or mutate data without a role check: **High/Critical**. Check `requireAdmin` is called in the loader and every action.
3. Tenant or user IDs taken from `params`, search params, hidden form fields or headers instead of the session.
4. `Object.fromEntries(formData)` or request JSON passed to the ORM: mass assignment of `role`, `orgId`, `isAdmin`, `plan`. Validate with a schema and allow-list fields.
5. Actions that accept IDs for related objects (`projectId`, `assigneeId`) without checking they belong to the caller's tenant.
6. Mutations reachable by `GET` (loaders with side effects): see `csrf-cors.md`.
7. Direct BaaS access from the browser (Supabase, Firebase): the client SDK is the attacker's tool; only rules/RLS enforce access.
8. File and export routes (`api.export.csv`, `/files/:id`): same checks, plus filename and content-type handling.

## Fix patterns

```ts
// app/lib/guards.server.ts
export async function requireUser(request: Request) {
  const session = await getSession(request.headers.get('Cookie'));
  const user = session.get('userId') && (await db.user.findUnique({ where: { id: session.get('userId') } }));
  if (!user) throw redirect('/login');
  return user;
}
export async function requireRole(request: Request, role: 'admin') {
  const user = await requireUser(request);
  if (user.role !== role) throw new Response('Forbidden', { status: 403 });
  return user;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const ticket = await db.ticket.findFirst({ where: { id: params.id, orgId: user.orgId } });
  if (!ticket) throw new Response('Not found', { status: 404 });
  return { ticket: toTicketDto(ticket) };
}
```

Use `404` for objects the caller shouldn't know exist. In TanStack Start, attach an auth middleware to each `createServerFn` or validate in the handler, plus an `inputValidator` schema (named `.validator()` in older docs).

## Data returned versus data displayed

Loader/server-function return values are serialized to the browser (embedded in the HTML and in `.data` responses). Return DTOs with explicit fields, never ORM rows or session user objects containing `passwordHash`, `resetToken`, `apiKey`, MFA secrets or other users' PII. Type component props narrowly and review `useRouteLoaderData('root')` payloads, which every page receives.

## Severity, false positives, verification

- Unauthenticated or any-user access to admin actions, other users' data, or role change: **Critical/High**. Needs a low-privilege account and exposes one user's low-sensitivity data: Medium. Do not downgrade because "the page is behind a guard".
- **Not findings:** public pages and public loaders returning public data; client-side guards that are *also* enforced server-side (note as defense in depth); `requireUser` called inside a shared helper the loader uses (trace it); UI that hides buttons while the server enforces.
- **Verify:** as user A, request B's resource through the browser network tab URL (`.data` URL or API path) and expect 403/404; call the `action` without a session and expect redirect/401; as a non-admin, call each admin loader/action. Add these as tests that call the exported `loader`/`action` with a `Request`, or integration tests with `fetch`.

References: OWASP A01:2025 Broken Access Control, API1/API3/API5:2023; CWE-285, CWE-639, CWE-915, CWE-200; https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes, https://tanstack.com/start/latest/docs/framework/react/guide/server-functions, https://reactrouter.com/how-to/middleware, https://remix.run/blog/middleware.
