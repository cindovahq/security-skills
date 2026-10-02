# NestJS — GraphQL (`@nestjs/graphql`)

## Contents
- Versions and drivers
- Authentication and guards in resolvers
- Field-level authorization
- Introspection and IDE
- Query cost: depth, complexity, batching, aliases
- CSRF and cross-origin behavior
- Subscriptions
- Errors and data exposure
- False positives
- Verification

## Versions and drivers

`@nestjs/graphql` 14 + `@nestjs/apollo` 14 (Nest 12; Apollo Server 5, peer `graphql` 16 or 17); 13.x is Nest 11 only: 13.0 to 13.1 use Apollo Server 4 (EOL), 13.2+ use Apollo Server 5. Nest 10 uses 12.x (Apollo Server 4). Read the installed `@apollo/server` version rather than inferring it from the Nest wrapper. Nest 12 removed `subscriptions-transport-ws` (use `graphql-ws`) and the Playground; GraphiQL is the built-in IDE, and `playground` remains only as a deprecated alias for `graphiql`. Mercurius (Fastify) is the alternative driver.

## Authentication and guards in resolvers

Guards, pipes, interceptors and filters work in resolvers, but the execution context is GraphQL. A guard written for HTTP fails or silently misbehaves:

```ts
canActivate(context: ExecutionContext) {
  const req = GqlExecutionContext.create(context).getContext().req;   // not context.switchToHttp()
  ...
}
```

- `context.switchToHttp().getRequest()` in a GraphQL resolver returns the wrong object (`undefined` headers). A guard that reads it and falls back to `return true` or `@Public()` logic is fail-open. Passport's `AuthGuard` needs `getRequest()` overridden to use `GqlExecutionContext`.
- `GraphQLModule.forRoot({ context: ({ req }) => ({ req }) })`: without exposing `req`, guards have nothing to read. A `context` given as a static object is shared by all requests.
- Global `APP_GUARD` guards run for root `@Query`/`@Mutation`/`@Subscription` resolvers. The guard must get the request through `GqlExecutionContext`; `Reflector` lookups with `context.getHandler()`/`context.getClass()` (for `@Public()`, `@Roles()`) work as in HTTP.

## Field-level authorization

Per the Nest docs, enhancers (guards, interceptors, filters) do not run for `@ResolveField()` methods by default; they run only for top-level queries and mutations unless `fieldResolverEnhancers: ['guards']` (or `'interceptors'`, `'filters'`) is set in `GqlModuleOptions`. Consequences:

- `@Roles('admin')` / `@UseGuards(AdminGuard)` on a field resolver does **nothing** by default. A field such as `internalNotes`, `costPrice`, `email` reachable through a relation (`order { customer { email } }`) is readable by anyone who can query the parent.
- Every path to an object type is an authorization path: `Query.me`, `Query.order`, `Mutation.updateX { returning }`, subscriptions, `node(id)`/`search` interfaces and union types. Protecting one root query does not protect the type.
- Enabling `fieldResolverEnhancers` has a cost (guards run per field per row); alternatives: `@Field({ middleware })` field middleware (cannot inject providers, per docs), `@Extensions({ roles })` with field middleware reading the user from context, or loading sensitive relations only in authorized services.
- Resolvers must scope data by the authenticated user in the service (`orders(user)`) rather than filter on a client-supplied `userId` argument.
- DataLoader batching functions that key only by ID can return other users' entities; scope loaders per request.

## Introspection and IDE

- Apollo Server: `introspection` defaults to `true` unless `NODE_ENV=production`; `includeStacktraceInErrorResponses` defaults to `true` unless `NODE_ENV` is `production` or `test`. Findings: `introspection: true` hard-coded, `NODE_ENV` unset in containers (so production behaves as development), `includeStacktraceInErrorResponses: true`.
- GraphiQL: with the Apollo driver it is enabled automatically when `NODE_ENV` is not `production` (landing page off in production by default); `graphiql: true` forces it on. On publicly reachable staging environments set `graphiql: false`.
- Disabling introspection is Hardening: it hides the schema from casual clients but does not replace authorization.

## Query cost: depth, complexity, batching, aliases

Nest ships no limits by default. The documented approach is a plugin using `graphql-query-complexity` (`@Plugin()` `ComplexityPlugin` with `fieldExtensionsEstimator`, `simpleEstimator`, a `maximumComplexity`). Depth: community rules (for example `graphql-depth-limit`) as `validationRules`.

- Missing depth and complexity limits on recursive types (`User.posts.author.posts...`) or list fields without pagination caps: DoS (Medium/High if unauthenticated).
- Aliases and field duplication multiply cost in one request (brute-force 100 logins in one mutation document); batching: Apollo's `allowBatchedHttpRequests` defaults to `false`.
- Rate limit by cost, per user, and authenticate before parsing expensive documents.
- Pagination arguments need `@Max`/`@Min` via `ValidationPipe` (pipes work on `@Args()`).

## CSRF and cross-origin behavior

Apollo Server's `csrfPrevention` is enabled by default (it requires non-simple requests, such as a `Content-Type: application/json` or a custom header, to block form-based CSRF and XS-Search). Look for `csrfPrevention: false`. If cookies authenticate the API, also apply CORS properly (`cors-csrf-headers.md`) and Nest 12.1 `enableCsrfProtection()`.

## Subscriptions

With `graphql-ws`, authenticate in `onConnect` (receives the connection context including `connectionParams`) and per operation: the docs' "Authentication over WebSockets" section. Check: no `onConnect` at all, tokens read from `connectionParams` but never verified, authorization only on connect (revocation never enforced), subscription `filter` functions that do not check the subscriber's permission for the payload object (`filter(payload, variables, context)` should compare against the context user). Guards on `@Subscription()` resolvers run at subscribe time only.

## Errors and data exposure

- Resolver exceptions are returned to the client; custom `formatError` that forwards `originalError` or database messages leaks internals.
- Entity classes decorated as `@ObjectType()` expose every `@Field()`: separate output types for sensitive entities (`serialization-data-exposure.md`).
- Do not enable `debug`/`sandbox` landing pages in production.

## False positives

- Introspection enabled in non-production or on an intentionally public API.
- Missing field-level guards where the field is not sensitive or the parent resolver already ensures the caller may see the whole object.
- Root-level global guard + service-level user scoping with `fieldResolverEnhancers` not set: fine unless a field needs *different* permissions than its parent.
- Playground/GraphiQL flagged when `NODE_ENV=production` is verified in deployment and `graphiql` is not forced.

## Verification

```ts
it('hides admin-only field from regular users', async () => {
  const res = await request(app.getHttpServer()).post('/graphql').set(auth(user))
    .send({ query: '{ orders { id customer { internalNotes } } }' });
  expect(res.body.errors?.length ?? 0).toBeGreaterThan(0);
  expect(JSON.stringify(res.body.data ?? {})).not.toContain('internalNotes');
});
it('rejects deeply nested queries', async () => {
  const deep = '{ me { friends { friends { friends { friends { friends { id } } } } } } }';
  const res = await request(app.getHttpServer()).post('/graphql').set(auth(user)).send({ query: deep });
  expect(res.body.errors).toBeDefined();
});
```

References: https://docs.nestjs.com/graphql/quick-start, /graphql/complexity, /graphql/guards-interceptors (other features), https://www.apollographql.com/docs/apollo-server/security/cors, OWASP GraphQL Cheat Sheet, OWASP API4/API1; CWE-639, CWE-400, CWE-200.
