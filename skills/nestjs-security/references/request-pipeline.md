# NestJS — Request Pipeline, Guards and Adapter Differences

## Contents
- Execution order
- Where security checks should live
- Binding scope: global, controller, route
- What global guards do not cover
- Fail-open guard patterns
- Middleware path matching
- Express vs Fastify adapter differences
- False positives
- Verification

Nothing is authenticated by default in Nest. Every control is a guard, pipe, interceptor or middleware someone registered. Map what actually runs before judging a handler.

## Execution order

Per the official request lifecycle: middleware (global, then module-bound) → guards (global, controller, route) → interceptors (pre) → pipes (global, controller, route, parameter; parameter pipes run last parameter first) → handler → interceptors (post, reverse order) → exception filters (route, controller, global; the only component that resolves most-specific first).

Consequences:
- Pipes (validation) run **after** guards. A guard cannot rely on validated DTOs; it sees the raw request.
- Exceptions from middleware reach **global** exception filters only.
- Interceptors run after guards, so authorization in an interceptor is too late for side effects done in guards, and too early for data loaded by pipes.

## Where security checks should live

Put authentication and authorization in **guards**, not middleware. Guards know the target handler and class (`ExecutionContext`, `Reflector` metadata) and are bound to a handler, so there is no path string to mismatch. Path-scoped middleware (`MiddlewareConsumer.forRoutes('admin')`) re-implements routing with a second matcher, which has repeatedly diverged from the router (see Fastify advisories in `dependencies.md`).

## Binding scope: global, controller, route

| Binding | How | Notes |
|---|---|---|
| Global, no DI | `app.useGlobalGuards(new G())` | Cannot inject providers. Per the `@nestjs/authorization` docs these run after every `APP_GUARD` guard. |
| Global, DI | `{ provide: APP_GUARD, useClass: G }` in any module | Can be registered several times; runs in registration (module scan) order. Not retrievable with `app.get()`. |
| Controller | `@UseGuards(G)` on the class | |
| Route | `@UseGuards(G)` on the handler | Runs after global and controller guards. |

Order matters: a `RolesGuard` or `ThrottlerGuard` registered before the authentication guard sees an unauthenticated request. Check the order of `APP_GUARD` providers and module imports.

**Default-deny pattern (recommended):** register the auth guard globally and opt out with a `@Public()` decorator. Review every `@Public()` usage; it is the new attack surface.

## What global guards do not cover

| Surface | Behavior | See |
|---|---|---|
| Hybrid app microservices (`connectMicroservice`) | Do **not** inherit global pipes, interceptors, guards, filters unless `{ inheritAppConfig: true }`; call `useGlobal*()` before `connectMicroservice()` | `websockets-microservices.md` |
| GraphQL field resolvers (`@ResolveField`) | Enhancers run only on root `@Query`/`@Mutation` unless `fieldResolverEnhancers` is set | `graphql.md` |
| WebSocket `handleConnection()` | Called directly, no guards, pipes or interceptors | `websockets-microservices.md` |
| Swagger UI and JSON/YAML | Served by `SwaggerModule.setup` on the HTTP adapter, not by controllers, so Nest guards never run | `secrets-config.md` |
| Static files (`ServeStaticModule`, `useStaticAssets`) | Adapter-level, not controller routes | `file-uploads.md` |
| Endpoints using `@Res()` (non-passthrough) | Guards still run; interceptors/serialization do not shape the response | `serialization-data-exposure.md` |

## Fail-open guard patterns

Verified against `@nestjs/passport` and `@nestjs/core` source.

1. **`handleRequest` override that does not throw.** `AuthGuard.canActivate` assigns the return value of `handleRequest` to `request.user` and then `return true`. Overriding `handleRequest(err, user) { return user; }` makes every anonymous request pass with `req.user` falsy. The default implementation throws `UnauthorizedException` when `err || !user`.
2. **`getAllAndMerge` for a boolean flag.** It returns an **array** (`[]`, `[true]`, `[false]`), which is always truthy. `if (isPublic) return true` then makes every route public. Use `getAllAndOverride<boolean>(KEY, [handler, class])`, which returns the first non-undefined value.
3. **`reflector.get(KEY, context.getHandler())` only.** A class-level `@Public()` or `@Roles()` is ignored; the check silently falls through to default. Check both targets.
4. **Roles guard that allows when metadata is absent** (`if (!required) return true`) is correct *only* if an authentication guard is also global. Verify.
5. **Guard calls `super.canActivate(ctx)` without `return`/`await`**, then `return true`.
6. **`try { ... } catch { return true; }`** around token parsing.
7. **Decorator without guard.** `@Roles('admin')` / `@Permissions()` only attach metadata through `SetMetadata`/`Reflector.createDecorator`; nothing enforces them unless a guard that reads them is bound (or global). Very common on admin controllers.
8. `canActivate` returning a Promise from non-async code is fine (Nest awaits it). Returning `undefined` is falsy and denies.

## Middleware path matching

- Nest 11+ on Express 5 / `path-to-regexp` v8: wildcards must be named, e.g. `'admin/*splat'`. Per the docs, `abcd/*splat` does **not** match `abcd/` itself; use `'admin/{*splat}'` to include the base path. A protected prefix written `forRoutes('admin/*splat')` leaves `/admin` unprotected.
- `exclude()` and `forRoutes()` with string paths interact with the global prefix and versioning; test the actual URLs.
- Fastify: see the adapter table below. Never use path-scoped middleware as the only authorization layer.
- Route declaration order matters on order-sensitive adapters: `@Get(':id')` declared before `@Get('me')` shadows it. Nest 12 adds opt-in `routeConflictPolicy` and `routeResolutionStrategy: 'specificity'` to `NestFactory.create`.

## Express vs Fastify adapter differences

| Topic | Express adapter (`@nestjs/platform-express`) | Fastify adapter (`@nestjs/platform-fastify`) |
|---|---|---|
| Underlying | Express 5 on Nest 11 and 12 (Express 4 on Nest 10) | Fastify 5 (Fastify 4 on Nest 10); Nest middleware runs through `@fastify/middie` (a bundled copy in some versions, see `dependencies.md`) |
| Middleware matching | Express router | Separate matcher on `req.originalUrl`; has had bypasses (trailing slash, HEAD, URL encoding, absolute-form targets). Pin patched versions |
| Request object in guards | Express `Request` | `FastifyRequest`; header names lowercase; use `request.raw` for the Node request |
| Body limit | `express.json()` default 100kb; raise with `app.useBodyParser('json', { limit })` | Fastify `bodyLimit` (1 MiB default) |
| Multipart | multer, **no default size or count limits** | `@fastify/multipart` interceptors (Nest 12.1+), default `fileSize` = `bodyLimit`, 1000 parts |
| CORS default methods | `GET,HEAD,PUT,PATCH,POST,DELETE` | `GET,HEAD,POST` only; set `methods` explicitly |
| Security headers | `helmet` or Nest 12.1 `useSecurityHeaders()` | `@fastify/helmet` or `useSecurityHeaders()` |
| Trust proxy | `app.set('trust proxy', ...)` | `new FastifyAdapter({ trustProxy: ... })` |
| Cookies | `cookie-parser` or built-in (12.1+) | `@fastify/cookie` or built-in (12.1+) |

## False positives

- Public routes (`@Public()` on login, register, health, webhooks with signature checks) are by design. Report only if they expose sensitive data or state change without another control.
- Absence of `@UseGuards` on a controller when a global `APP_GUARD` authenticates and the route is not `@Public()`.
- Middleware-based auth on the Express adapter with correct paths and no `*` wildcard gaps: Hardening at most (prefer guards).

## Verification

```ts
it('rejects anonymous access to every non-public route', async () => {
  for (const [method, path] of PROTECTED_ROUTES) {
    await request(app.getHttpServer())[method](path).expect(401);
  }
});
it('is not bypassed by trailing slash or HEAD (Fastify)', async () => {
  await app.inject({ method: 'GET', url: '/admin/users/' }).then(r => expect(r.statusCode).toBe(401));
});
```

Enumerate routes with `DiscoveryService` or `app.getHttpAdapter().getInstance().printRoutes()` on Fastify.

References: https://docs.nestjs.com/faq/request-lifecycle, https://docs.nestjs.com/guards, https://docs.nestjs.com/middleware; CWE-284, CWE-306, CWE-862, CWE-436.
