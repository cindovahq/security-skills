# NestJS — Authorization, IDOR and Tenant Isolation

## Contents
- How authorization is wired in Nest
- Function-level authorization (roles)
- Object-level authorization (IDOR) in services
- Multi-tenancy and request-scoped state
- CASL
- `@nestjs/authorization`
- Severity notes
- False positives
- Verification

Guards decide *whether a route may run*; only service or repository code can decide *whether this user may touch this record*. Most Nest IDORs are a `findOne(id)` in a service that never sees the caller.

## How authorization is wired in Nest

`@Roles('admin')` (built with `SetMetadata` or `Reflector.createDecorator<string[]>()`) only stores metadata. A `RolesGuard` reads it through `Reflector` (`getAllAndOverride` for "most specific wins", `getAllAndMerge` to combine class and handler values) and must be **bound** (`@UseGuards(RolesGuard)` or global `APP_GUARD`, after the authentication guard). See `request-pipeline.md` for fail-open variants.

## Function-level authorization (roles)

Investigate:
- Admin/staff controllers (`/admin/*`, `/internal/*`, `/users` management, exports, impersonation) with `@Roles()` but no bound `RolesGuard`.
- `RolesGuard` ordering before authentication (reads `request.user` that is not set yet): usually fails closed by accident (TypeError), sometimes open (`user?.roles ?? []` then `return true` when no roles are required).
- Role taken from the JWT payload/cookie/header/body instead of the database for privilege-changing operations.
- `role.includes('admin')` on strings (`'superadmin'.includes('admin')`), case-sensitivity mismatches, `some` vs `every` semantics on multi-role routes.
- Routes missing the decorator in an otherwise decorated controller (copy-paste), and `GET` protected while `PATCH`/`DELETE` are not.
- Alternate transports of the same logic: a GraphQL resolver, gateway handler or `@MessagePattern` that calls the same service without the guard (`graphql.md`, `websockets-microservices.md`).

```ts
// Fix: guard bound at controller level, deny by default
@Roles('admin')
@UseGuards(JwtAuthGuard, RolesGuard)   // or register both as APP_GUARD, in this order
@Controller('admin/users')
export class AdminUsersController {}
```

## Object-level authorization (IDOR) in services

```ts
// Vulnerable: any authenticated user can read any invoice
@Get(':id')
findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.invoices.findOneBy({ id });
}

// Fixed: the owner or tenant comes from the verified identity, never from input
@Get(':id')
async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
  const invoice = await this.invoices.findOneBy({ id, ownerId: user.id });
  if (!invoice) throw new NotFoundException();
  return invoice;
}
```

Check every handler taking an ID, including `PATCH`, `DELETE`, bulk endpoints (arrays of IDs), exports, file downloads, nested routes (`/accounts/:accountId/invoices/:id` where only `accountId` is checked), GraphQL field resolvers, and WebSocket messages that name a room or resource. Also:
- `repository.update(id, body)` / `save({ id, ...body })` / `Object.assign(entity, dto)` on an entity loaded by ID only.
- `@Body() dto` containing `userId`, `ownerId`, `tenantId`, `accountId` accepted from the client.
- TypeORM 0.3.x (or 1.x with `invalidWhereValuesBehavior` set to `ignore`) `findOneBy({ id, ownerId: user?.id })` with `user?.id === undefined`: the `ownerId` condition is silently dropped (`injection.md`).
- UUIDs are not access control. Sequential IDs alone are not a finding.

## Multi-tenancy and request-scoped state

- **Singleton state.** Providers are singletons by default. A service/interceptor storing the caller in an instance field (`this.currentUser = req.user`) shares it across concurrent requests: cross-user data exposure under load. Use method parameters, request-scoped providers (`@Injectable({ scope: Scope.REQUEST })`, which bubble up and cost performance) or `AsyncLocalStorage` (`nestjs-cls` or Nest's ALS recipe).
- Tenant from an `x-tenant-id` header, subdomain or body without membership check: cross-tenant access (Critical for sensitive data).
- Row-level scoping via a base repository/subscriber/Prisma extension: read the helper before reporting individual queries.
- Caches (`CacheInterceptor`, `@nestjs/cache-manager`) keyed by URL only return one user's response to another; the default key is derived from the request URL, so authenticated, per-user responses need a custom `trackBy`/key including the user. Check any `@UseInterceptors(CacheInterceptor)` on authenticated routes.

## CASL

- Checking by subject **type** ignores conditions: with `can('update', 'Article', { authorId: user.id })`, `ability.can('update', 'Article')` is `true` (verified in `Rule.matchesConditions`: with a type or no object, a non-inverted conditional rule matches). Only `ability.can('update', subject('Article', article))` (or a class instance) evaluates the condition. A guard that checks types and then lets the service load by ID is an IDOR.
- Use `accessibleBy(ability)` (with the official `@casl/prisma`/`@casl/mongoose` packages, or a community TypeORM adapter) to scope list queries.
- Ability built from claims in the token rather than current database roles: stale permissions.

## `@nestjs/authorization`

Nest 12's docs introduce `@nestjs/authorization` (`@Can(Policy, 'ability')`, policy classes, `AuthorizationService.can/authorize`). It was `0.0.1` on npm on 2026-10-02. Its `@Can()` guard only accepts abilities evaluable from the user alone; record-level checks belong in services via `authorize()`. Import order: `AuthenticationModule` before `AuthorizationModule`.

## Severity notes

| Pattern | Typical severity |
|---|---|
| Admin controller without effective guard | Critical (unauthenticated) / High (any logged-in user) |
| Cross-user or cross-tenant read/write by ID | High; Critical for money, credentials, health or cross-tenant writes |
| Role escalation through PATCH/registration | Critical |
| Singleton request state leak | High (Likely if concurrency is realistic) |
| Authorization by `decode()`d token claims | Critical |
| Missing check on low-sensitivity data | Medium/Low |

## False positives

- IDs validated by `ParseUUIDPipe` that are then looked up **with** an owner/tenant filter in the same call or in a documented base repository.
- Public catalog/listing endpoints returning intentionally public records.
- `RolesGuard` returning `true` when no roles metadata exists, when a global authentication guard guarantees identity and the route is meant for any authenticated user.
- Admin-only IDOR in a single-tenant app: Medium, not High.

## Verification

```ts
it('does not return another user\'s invoice', async () => {
  const invoiceOfA = await createInvoiceFor(userA);
  await request(app.getHttpServer()).get(`/invoices/${invoiceOfA.id}`).set(auth(userB)).expect(404);
});
it('denies admin routes to non-admins', async () => {
  await request(app.getHttpServer()).get('/admin/users').set(auth(regularUser)).expect(403);
});
```

Add a concurrency test for singleton state: fire two authenticated requests in parallel with different users and assert each sees only its own data.

References: OWASP API Security Top 10 (API1 BOLA, API3 BOPLA, API5 BFLA), https://docs.nestjs.com/guards, https://casl.js.org; CWE-285, CWE-639, CWE-862, CWE-863, CWE-362.
