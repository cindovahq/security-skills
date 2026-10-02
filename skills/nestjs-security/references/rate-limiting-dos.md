# NestJS — Rate Limiting and Availability

## Contents
- `@nestjs/throttler`
- Behind proxies, GraphQL and WebSockets
- Body, upload and query limits
- Crash-on-input DoS
- Streaming and SSE
- False positives
- Verification

## `@nestjs/throttler`

Version 6.x (6.7.1 on 2026-10-02, supports Nest 7 to 12). `ttl` is in **milliseconds**. Since v5 `@Throttle()` takes an object keyed by throttler name: `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.

```ts
ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
// and then it must be bound:
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```

Investigate:
- `ThrottlerModule.forRoot()` imported but `ThrottlerGuard` never bound (not `APP_GUARD`, no `@UseGuards(ThrottlerGuard)`): **no limiting at all**. Common.
- `@SkipThrottle()` on auth, upload, search, export or webhook controllers; `skipIf` callbacks keyed on headers; `ignoreUserAgents`.
- One generous global limit and no stricter limits on login, registration, password reset, OTP/MFA verification, token refresh, email-sending endpoints (cost and enumeration). Add `@Throttle({ default: { limit: 5, ttl: 60_000 } })` there, plus per-account limits (tracker = normalized email/username) for credential stuffing across many IPs.
- Default storage is **in-memory per process**: multiple replicas multiply the limit and restarts reset it. Use a shared store (a Redis storage implementing `ThrottlerStorage`).
- Guard order: `ThrottlerGuard` before authentication throttles by IP (good for login); after it, `getTracker` can use the user id.
- `blockDuration` option for lockout after exceeding the limit.

## Behind proxies, GraphQL and WebSockets

- Without proxy trust the tracker is the proxy's IP (everyone shares one bucket); with `trust proxy: true` clients can forge `X-Forwarded-For` and pick a fresh bucket per request. Set the real hop count or CIDR list (`cors-csrf-headers.md`). Overriding `getTracker(req)` to read `req.ips[0]` or a raw header needs the same trust assumption. The built-in tracker groups IPv6 addresses by prefix per the docs, so rotating addresses inside a subnet does not evade it; a custom `getTracker` loses that.
- GraphQL: override `getRequestResponse(context)` to take `req`/`res` from `GqlExecutionContext`, otherwise the guard errors or does not limit as intended. Limit by operation cost, not requests (`graphql.md`).
- WebSockets: the stock guard needs a custom subclass overriding `handleRequest()`; per the docs do not register it globally because global guards also run for HTTP routes. Unprotected gateway messages are common.

## Body, upload and query limits

- Express: JSON/urlencoded bodies default to 100kb; `app.useBodyParser('json', { limit: '50mb' })` or `NestFactory.create(AppModule, { bodyParser: false })` plus a permissive custom parser removes the guard. Fastify: `bodyLimit` (1 MiB default). `rawBody: true` buffers an extra copy of every body.
- multer (`FileInterceptor`) has **no default file size or count limit** and stores in memory unless `dest`/`storage` is set; `MaxFileSizeValidator` runs after the upload is buffered. Set `limits: { fileSize, files, fields, parts }` (`file-uploads.md`).
- Pagination: `@Query('limit') limit` without `@Max()`, unbounded `find()`, `relations: [...]` joins from client input, `IN (...)` arrays of unbounded length.
- Regexes built from input, expensive `JSON.parse` of nested payloads, `class-transformer` on huge arrays; ReDoS in custom validators (`nodejs-security` skill, API security reference).
- GraphQL batching/aliases/depth (`graphql.md`).

## Crash-on-input DoS

- Unhandled promise rejections in detached work (`void this.service.doAsync()`), stream or timer callbacks, and `Observable` pipelines without `catchError` can terminate the process. Nest's exception layer only covers the handler's own promise chain.
- Microservice transports have had remote-crash advisories: deeply nested `pattern` objects terminate the process (`GHSA-m8vh-jmq9-5rjg`, `CVE-2026-102281`, fixed in 11.2.4/12.0.2); recursive `handleData` in the TCP `JsonSocket` (`CVE-2026-40879`, fixed in 11.1.19); unbounded buffering in the TCP transport (`GHSA-96h4-vgxj-gvm2`, fixed in 11.2.5/12.0.3, adds a stall timeout and `maxSendBufferSize`). Exposed TCP/RabbitMQ transports make these remote.
- multer DoS advisories fixed progressively up to 2.4.0 (`dependencies.md`).

## Streaming and SSE

- `@Sse()` routes hold a connection per client; require auth, cap connections per user, and clean up on disconnect.
- `@nestjs/core` `SseStream` before 11.1.18 did not strip newlines from `type`/`id` (`CVE-2026-35515`); never map user input into those fields.
- Long-running or CPU-heavy handlers block the event loop; offload to queues/workers.

## False positives

- No throttler on health checks, static assets, or internal-only services behind an authenticated gateway that enforces limits (verify the gateway exists).
- Single-instance deployments with in-memory throttler storage: Hardening, not a defect.
- Large `limit` on an admin-only export.

## Verification

```ts
it('throttles repeated logins', async () => {
  const attempts = await Promise.all(Array.from({ length: 12 }, () =>
    request(app.getHttpServer()).post('/auth/login').send({ email: 'a@example.test', password: 'x' })));
  expect(attempts.some(r => r.status === 429)).toBe(true);
});
it('rejects oversized bodies', () =>
  request(app.getHttpServer()).post('/notes').send({ text: 'a'.repeat(2_000_000) }).expect(413));
```

Remember the test application must bind the same global guards as production (`verification.md`).

References: https://docs.nestjs.com/security/rate-limiting, OWASP API4:2023 Unrestricted Resource Consumption; CWE-307, CWE-400, CWE-770.
