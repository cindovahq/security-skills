# NestJS — Verifying Findings and Fixes (Jest / Vitest + supertest)

## Contents
- The test-app trap
- Test harness
- Proving a finding
- Proving a fix
- Route inventory and static checks
- Safe dynamic checks
- Nest 12 test runner notes

## The test-app trap

`Test.createTestingModule({ imports: [AppModule] }).compile()` followed by `moduleRef.createNestApplication()` builds the module graph, but **everything done in `main.ts` is skipped**: `useGlobalPipes`, `useGlobalGuards`, `useGlobalInterceptors`, `useGlobalFilters`, `enableCors`, `helmet`, `setGlobalPrefix`, `enableVersioning`, `rawBody`, body parser limits, `trust proxy`, `enableCsrfProtection()`, Swagger. E2E tests that pass against such an app prove nothing about production, and a missing global `ValidationPipe` can make DTO tests look like they fail or pass for the wrong reason. Fix by moving all bootstrap configuration into `configureApp(app)` and calling it from both `main.ts` and the tests; or register globals through `APP_PIPE`/`APP_GUARD`/`APP_INTERCEPTOR`/`APP_FILTER` providers so they travel with the module.

## Test harness

```ts
import { Test } from '@nestjs/testing';
import request from 'supertest';

let app: INestApplication;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue({ send: jest.fn() })   // external effects only
    .compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);          // shared with main.ts
  await app.init();
});
afterAll(() => app.close());
```

- Do not `overrideGuard(JwtAuthGuard)` in security tests; that removes the control under test. Create real users and real tokens (`JwtService.sign`) or log in through the endpoint.
- Use a throwaway database (SQLite in-memory/testcontainers) and fixtures with obviously fake credentials.
- For Fastify: `await app.getHttpAdapter().getInstance().ready()` and use `app.inject({ method, url, headers, payload })` to control the request line exactly (trailing slash, `HEAD`, encoded paths).

## Proving a finding

| Finding | Test |
|---|---|
| Anonymous access | `request(server).get('/x').expect(401)` fails (returns 200) |
| IDOR | user B requests user A's id and gets 200 with A's data |
| Role escalation | register with `role: 'admin'`, then reload the user and assert `role` |
| Mass assignment | `PATCH` with `isAdmin: true`, assert persisted value |
| Credential exposure | response `JSON.stringify` matches `/passwordHash/` |
| SQL injection | quote characters in a string parameter produce a 500 with SQL text, or boolean-differential results, in a test database only |
| SSRF | point the URL at a local mock server and assert it was contacted |
| Throttling absent | N rapid requests never produce 429 |
| Gateway auth | `socket.io-client` connects without a token and can emit |
| Microservice auth | `ClientProxy` (TCP) `send({ cmd }, payload)` succeeds without credentials |

Keep proofs minimal: one request, benign data, no brute force, no loops beyond a handful of calls.

## Proving a fix

For each fix test three things: the attack fails with the right status (401/403/404/400/429), legitimate use still works, and sibling instances are fixed (other HTTP methods, other transports, other controllers that use the same service).

```ts
describe('invoices authorization', () => {
  it('owner can read', () => request(server).get(`/invoices/${a.id}`).set(auth(userA)).expect(200));
  it('other user gets 404', () => request(server).get(`/invoices/${a.id}`).set(auth(userB)).expect(404));
  it('other user cannot patch', () => request(server).patch(`/invoices/${a.id}`).set(auth(userB)).send({ status: 'paid' }).expect(404));
  it('anonymous gets 401', () => request(server).get(`/invoices/${a.id}`).expect(401));
});
```

Add a regression test for each guard-ordering or fail-open bug: anonymous request to every route (`PROTECTED_ROUTES` list generated from the router), and a test that a `@Public()` route stays public while its neighbors are not.

## Route inventory and static checks

- Express: `app.getHttpAdapter().getInstance()._router.stack` (Express 4) or `.router.stack` (Express 5) lists layers; or use `DiscoveryService` (`@nestjs/core`) to read controllers, handlers and metadata (`Reflect.getMetadata('__guards__', handler)`, `IS_PUBLIC_KEY`) and assert that every handler is public or covered by guards.
- Fastify: `app.getHttpAdapter().getInstance().printRoutes()`.
- Grep signals (investigation only): `@Public()`, `SetMetadata(`, `@Roles(` without `RolesGuard` in `providers`/`APP_GUARD`, `handleRequest(`, `getAllAndMerge`, `ignoreExpiration`, `@Body() ... any`, `query(\``, `createQueryBuilder` with template literals, `FileInterceptor(` without `limits`, `connectMicroservice`, `handleConnection`, `SwaggerModule.setup`, `introspection:`, `ThrottlerModule` without `ThrottlerGuard`.

## Safe dynamic checks

Only against environments you are authorized to test. Use test accounts, a handful of requests, benign payloads (`'`, `"`, `../`, an internal URL pointing at a local mock). Never run load, brute force, destructive SQL, or probe cloud metadata endpoints from production. Do not send credentials found in code to third-party services.

## Nest 12 test runner notes

New Nest 12 projects default to ESM with Vitest; CommonJS projects keep Jest (per the migration guide, Jest loads the ESM-only v12 packages only on Node.js 24.9 or later). Vitest 3 / Vite 7 (esbuild) do not emit decorator metadata: use an SWC plugin (for example `unplugin-swc`). Vitest 5 / Vite 8 (Oxc, the Nest 12 default) emit it only when the test tsconfig sets `experimentalDecorators` and `emitDecoratorMetadata`. Without metadata, `ValidationPipe`, `@Inject()` parameter typing and `Reflect.getMetadata('design:paramtypes')` silently stop working, which also disables DTO validation in tests. `FileTypeValidator` imports `file-type` dynamically; under Jest this logs a warning suggesting `NODE_OPTIONS="--experimental-vm-modules"`, and validation then fails closed unless `fallbackToMimetype` is set.

References: https://docs.nestjs.com/fundamentals/unit-testing, https://github.com/ladjs/supertest, OWASP Web Security Testing Guide; CWE-1059.
