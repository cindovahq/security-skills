# NestJS — Secrets, Configuration, Swagger, Errors and Production Settings

## Contents
- `@nestjs/config`
- Secrets in code and containers
- Swagger / OpenAPI exposure
- Devtools, health, metrics and debug surfaces
- Exception filters and error leaks
- Logging
- Database and platform configuration
- False positives
- Verification

## `@nestjs/config`

`ConfigModule.forRoot()` loads `.env` from the working directory (or `envFilePath`, first file wins), merges it with `process.env` (real environment variables win unless `override: true`), and exposes `ConfigService`. Options: `isGlobal`, `ignoreEnvFile`, `load` (factories, `registerAs`), `cache`, `expandVariables`, `validate`/`validationSchema`, `validationOptions`, `skipProcessEnv`. Version 12 (Nest 12) validates through Standard Schema (Zod etc.); Joi needs v18+ with options under `validationOptions.libraryOptions`. By default unknown environment variables do not fail validation and all failing variables are reported.

Investigate:
- **No validation of required secrets:** `ConfigModule.forRoot({ isGlobal: true })` with no `validate`/`validationSchema`, and `configService.get('JWT_SECRET')` returning `undefined` at runtime. Prefer `getOrThrow()` plus a schema with minimum lengths.
- **Fallback defaults:** `config.get('JWT_SECRET') ?? 'secret'`, `config.get<string>('JWT_SECRET', 'changeme')`, `process.env.X || 'dev'` (Critical when the secret signs tokens and could be unset in production).
- `NODE_ENV` defaults in schema (`.default('development')`) in a container image that never sets it: Apollo introspection/stack traces and library debug behavior follow `NODE_ENV` (`graphql.md`).
- `ConfigService` injected into code that logs the whole config; `configService.get()` of nested objects printed on startup.
- `.env`, `.env.production` committed; `docker-compose.yml`/CI with real values (placeholders in `.env.example` are fine). `app.module.ts` with literal DB credentials or `synchronize: true` against production.

## Secrets in code and containers

Same rules as the `nodejs-security` skill (secrets and config reference): redact values in reports, rotate any live secret, never test a found credential. Nest-specific places: `TypeOrmModule.forRoot({ password: '...' })`, `JwtModule.register({ secret: '...' })`, `ClientsModule.register([{ options: { url: 'amqp://user:pass@...' } }])`, `MongooseModule.forRoot('mongodb://user:pass@...')`, `Dockerfile` `ENV`, `nest-cli.json`.

## Swagger / OpenAPI exposure

`SwaggerModule.setup('docs', app, document)` serves the UI and, by default, the definition at `docs-json` and `docs-yaml`, from the **HTTP adapter**, so Nest guards, serializers and your global prefix (unless `useGlobalPrefix: true`) do not apply to it. Options (verified in `@nestjs/swagger` source): `ui` (deprecated alias `swaggerUiEnabled`), `raw` (`boolean | ('json'|'yaml')[]`), `jsonDocumentUrl`, `yamlDocumentUrl`, `swaggerOptions`, `customSiteTitle`. Disabling the UI (`ui: false`) does **not** disable the JSON/YAML; set `raw: false` too.

- Unconditional `setup()` in `main.ts` in production exposes the full API surface, DTO schemas (including internal fields and admin routes) and sometimes example credentials. Severity: Low/Medium for a private business API, Medium/High if it lists internal-only admin or debug endpoints or documents secrets; the UI "Try it out" also helps attackers.
- `@ApiBearerAuth()` / `@ApiSecurity()` only document; they enforce nothing.
- Gate it: `if (process.env.NODE_ENV !== 'production') SwaggerModule.setup(...)`, or protect with a reverse-proxy basic auth/IP allow-list.

## Devtools, health, metrics and debug surfaces

- `@nestjs/devtools-integration`: `DevtoolsModule.register({ http: process.env.NODE_ENV !== 'production' })` is the documented pattern. Unconditional `http: true` opens an introspection server; `CVE-2025-54782` (`GHSA-85cg-cmq5-qjm7`, Critical, fixed in 0.2.1) allowed CSRF-to-sandbox-escape RCE against developers via the `/inspector/graph/interact` endpoint. Flag the package in `dependencies` (not `devDependencies`) or versions <= 0.2.0.
- `@nestjs/terminus` health indicators returning dependency versions, DB hostnames, memory details to the public. Prometheus `/metrics` and `/debug` without auth.
- GraphiQL/Apollo Sandbox in production (`graphql.md`); REPL (`repl.ts`) in deployed images.
- `app.listen(port)` without a host listens on all interfaces; internal admin or debug ports must not be published.

## Exception filters and error leaks

- Built-in behavior: unrecognized (non-`HttpException`) errors return `{ "statusCode": 500, "message": "Internal server error" }` and `HttpException`s return their message. This default is safe.
- Findings: custom `@Catch()` filters returning `exception.message`, `exception.stack`, `exception.query`/`driverError` (TypeORM `QueryFailedError`), request bodies or tokens; `HttpException` messages built from DB errors or user input (reflected content); `ValidationPipe` errors listing constraint text for sensitive fields; different errors for "user not found" vs "wrong password".
- Filters registered per route/controller vs global: a global `@Catch()` that swallows errors and returns 200.
- Exceptions thrown from middleware reach only global filters.
- Nest 12 adds `errorCode` in `HttpExceptionOptions`; it is serialized to clients, keep codes generic.

## Logging

- `Logger`/interceptors logging `req.body`, `Authorization`, cookies, reset tokens, full SQL with parameters (`TypeOrmModule` `logging: true` prints parameters), GraphQL variables. Nest 12's `LogMailTransport` of `@nestjs/mail` logs email text including links (docs warning).
- Log injection through unescaped user input in plain-text logs: Low.

## Database and platform configuration

- TypeORM `synchronize: true` outside throwaway databases; `ssl: false`/`rejectUnauthorized: false` to production databases; superuser DB accounts; Mongoose `autoIndex` in prod: Hardening.
- Docker images running as root, `.git`/`.env` copied into the image, source maps shipped.
- `NestFactory.create(AppModule, { logger: ['debug', 'verbose'] })` in production: noise and leakage risk.

## False positives

- `.env.example` with placeholders; test-only secrets in `test/` or Jest setup.
- `synchronize: true` when guarded by `NODE_ENV !== 'production'` and production verified.
- Swagger enabled in non-production only, or exposed on an internal network behind authentication (state the assumption).
- Default Nest 500 responses.
- `ConfigService.get('PORT', 3000)` style defaults for non-secret values.

## Verification

```ts
it('does not serve API docs in production', async () => {
  process.env.NODE_ENV = 'production';
  const app = await createApp();
  await request(app.getHttpServer()).get('/docs').expect(404);
  await request(app.getHttpServer()).get('/docs-json').expect(404);
});
it('hides internal error details', async () => {
  const res = await request(app.getHttpServer()).get('/boom').expect(500);
  expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|QueryFailedError|SELECT /);
});
it('fails at startup without secrets', async () => {
  delete process.env.JWT_SECRET;
  await expect(createApp()).rejects.toThrow();
});
```

References: https://docs.nestjs.com/techniques/configuration (v12: /application/configuration), https://docs.nestjs.com/openapi/introduction, https://docs.nestjs.com/exception-filters, OWASP ASVS V14, OWASP API8:2023 Security Misconfiguration; CWE-209, CWE-798, CWE-489, CWE-200.
