# NestJS — Authentication (Passport, JWT, Sessions, Cookies)

## Contents
- How authentication is wired in Nest
- JWT configuration review
- Passport strategy and guard review
- The `@Public()` pattern
- Passwords and credentials
- Cookies and sessions
- Brute force
- New first-party `@nestjs/authentication`
- False positives
- Verification

## How authentication is wired in Nest

Typical stack: `@nestjs/passport` + `passport-jwt` (a `JwtStrategy` with `validate()`, an `AuthGuard('jwt')` subclass), or `@nestjs/jwt` `JwtService` verified by a hand-written guard. Before Nest 12.1 and the `@nestjs/authentication` package, Nest provides no sessions, CSRF or password hashing out of the box except what you add. Read the installed versions: `@nestjs/jwt` bundles `jsonwebtoken` 9.x, `@nestjs/passport` 11/12 uses `passport`, `passport-jwt` 4.0.1 is unchanged since 2022.

## JWT configuration review

`@nestjs/jwt` (`JwtModule.register/registerAsync`, `JwtService`):
- `JwtService.decode()` is `jsonwebtoken.decode`: **no signature or expiry check**. Any authorization decision based on `decode` output is a finding.
- No default `expiresIn`: tokens never expire unless `signOptions: { expiresIn }` is set (numbers are seconds). No default `issuer`/`audience` checks.
- `verify`/`verifyAsync` take `verifyOptions` from the module; nothing pins `algorithms` for you. With `jsonwebtoken` 9 the allowed algorithms follow the key type (HMAC for a string secret), but pin them anyway: `verifyOptions: { algorithms: ['HS256'], issuer, audience }`.
- Secret sources: `process.env.JWT_SECRET ?? 'dev-secret'`, `configService.get('JWT_SECRET', 'changeme')`, a literal in a `constants.ts` file (`jwtConstants.secret`). `ConfigService.get()` returns `undefined` for missing keys; prefer `getOrThrow()` or schema validation (`secrets-config.md`).
- Same secret for access and refresh tokens, no `typ`/purpose separation, refresh tokens that are not rotated or revocable.
- Token in `localStorage`-style flows: acceptable for bearer APIs; for cookie transport see below.

`passport-jwt` `JwtStrategy` options:
- `ignoreExpiration: true` disables expiry checking (default `false`). Flag it.
- `algorithms` not set (set `['HS256']` or the asymmetric algorithm used); `issuer`, `audience` unset.
- `secretOrKey` undefined: `passport-jwt` throws `JwtStrategy requires a secret or key` at construction, so a missing env var fails loudly *unless* a fallback literal was added.
- `validate(payload)` returns claims straight from the token (`{ id: payload.sub, role: payload.role }`). Roles/permissions in a long-lived token cannot be revoked; for sensitive roles re-load the user (and `isActive`/`tokenVersion`) from the database in `validate()`.
- Custom `ExtractJwt.fromExtractors([...])` reading cookies or query parameters (`fromUrlQueryParameter`) widens CSRF/log exposure.

## Passport strategy and guard review

- A guard class extending `AuthGuard('jwt')` is only effective if bound (global `APP_GUARD`, controller or route). A strategy file alone protects nothing.
- Overriding `handleRequest` must throw when `!user`. `AuthGuard.canActivate` sets `request.user` to whatever `handleRequest` returns and then returns `true`, so `handleRequest(err, user) { return user; }` lets anonymous requests through (`request.user` becomes `false`/`null`).
- `canActivate` overrides that call `super.canActivate(context)` must `return` it (it can return a Promise or Observable).
- `AuthGuard` with `defaultStrategy` and several strategies: confirm an array of strategies is intended (any success passes).
- Custom param decorators such as `@CurrentUser()` read `request.user`; when the guard failed open this is `false`/`undefined` and code often continues (`user?.id` yields `undefined`, which ORMs may drop from filters; see `injection.md`).

## The `@Public()` pattern

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

canActivate(ctx: ExecutionContext) {
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
  if (isPublic) return true;
  return super.canActivate(ctx);
}
```

Review: `getAllAndMerge` (always truthy array), `get` with only the handler, `@Public()` on a controller class that also contains private routes, public routes that accept an ID and return user data, and `@Public()` on GraphQL resolvers or gateways (the guard must use `GqlExecutionContext` to read the request, see `graphql.md`).

## Passwords and credentials

- Acceptable: `argon2` (Argon2id), `bcrypt` (cost >= 10), `scrypt` via `node:crypto` with per-user salt. Findings: `createHash('md5'|'sha1'|'sha256')`, unsalted or fixed salt, bcrypt with cost < 10, plaintext compare, comparing hashes with `===` on secrets that are bearer-like (use `timingSafeEqual`).
- Login must return the same error for unknown user and wrong password; registration enumeration is Low unless login lockouts depend on it.
- Reset/verification tokens: `crypto.randomBytes(32)`, stored hashed, short expiry, single use. `Math.random`/`uuid v1`/`Date.now()` are findings.
- Registration must ignore `role`, `isAdmin`, `emailVerified`, `tenantId` from the body (see `validation-mass-assignment.md`).
- Entities returning `passwordHash`: see `serialization-data-exposure.md`.

## Cookies and sessions

- Nest 12.1+ has built-in cookies (`@Cookies()`, `@SignedCookies()`, `setCookie()`, `cookies: { secret }` application option). `setCookie` options have **no defaults** except `path`: `httpOnly`, `secure`, `sameSite` are all off unless set. `@Cookies()` does not verify signatures. `maxAge` is in seconds there but milliseconds in Express `res.cookie()`.
- `res.cookie('access_token', jwt)` without `httpOnly`, `secure`, `sameSite` is a finding; cookie-borne auth needs CSRF defenses (`cors-csrf-headers.md`).
- A signed cookie containing only a user id is a long-lived bearer credential with no server-side revocation.
- `express-session`/`@fastify/secure-session`: see the `nodejs-security` skill, sessions and cookies reference (secret fallbacks, `MemoryStore` in production, regeneration on login, destroy on logout).

## Brute force

`ThrottlerModule.forRoot()` does nothing until `ThrottlerGuard` is bound (`APP_GUARD`, `@UseGuards(ThrottlerGuard)`). Login, registration, password reset, OTP/MFA verification and token refresh need stricter `@Throttle({ default: { limit, ttl } })` limits (`ttl` in milliseconds). Details in `rate-limiting-dos.md`.

## New first-party `@nestjs/authentication`

Nest 12's docs describe `@nestjs/authentication` (global guard, `@Public()`, `@CurrentUser()`, sessions, scrypt hashing, TOTP, OIDC, refresh-token rotation) and `@nestjs/authorization` (`@Can()`). On 2026-10-02 npm shows both at version `0.0.1`, published days earlier. Do not assume maturity; check the installed version, treat as pre-release, and review store implementations. Its docs state that Nest runs no guards on `handleConnection()`, that field resolvers need `fieldResolverEnhancers`, that `AuthenticationModule` must be imported before `AuthorizationModule`, and recommend `app.enableCsrfProtection()` on 12.1+.

## False positives

- `jwt.verify`/`verifyAsync` with a secret from validated configuration and `expiresIn` set elsewhere, without explicit `algorithms`: Hardening only, since `jsonwebtoken` 9 derives allowed algorithms from the key type.
- `JwtService.decode()` on a token this process just signed (for example to read `exp` for a response), or on an already-verified token.
- `@Public()` login/register/refresh/health/webhook routes.
- A fallback secret in a clearly test-only module (`test/`), or a placeholder in `.env.example`.

## Verification

```ts
it('rejects missing, malformed and expired tokens', async () => {
  await request(app.getHttpServer()).get('/invoices').expect(401);
  await request(app.getHttpServer()).get('/invoices').set('Authorization', 'Bearer not.a.jwt').expect(401);
  const expired = jwt.sign({ sub: 'u1' }, secret, { expiresIn: -10 });
  await request(app.getHttpServer()).get('/invoices').set('Authorization', `Bearer ${expired}`).expect(401);
});
it('rejects a token signed with another algorithm or key', async () => {
  const forged = jwt.sign({ sub: 'u1', role: 'admin' }, 'wrong-secret');
  await request(app.getHttpServer()).get('/admin/users').set('Authorization', `Bearer ${forged}`).expect(401);
});
```

References: https://docs.nestjs.com/security/authentication, https://github.com/nestjs/passport/blob/master/lib/auth.guard.ts, OWASP JWT Cheat Sheet, OWASP ASVS V2/V3; CWE-287, CWE-798, CWE-613, CWE-916.
