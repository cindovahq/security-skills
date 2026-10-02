# NestJS — CORS, CSRF, Security Headers and Proxy Settings

## Contents
- Where these are configured
- CORS
- CSRF
- Security headers
- Cookies
- Trust proxy and client IP
- False positives
- Verification

All of this is configured in `main.ts` (or a shared `configureApp(app)`), not per module. Read it first. Generic Express CORS/CSRF reasoning is in the `nodejs-security` skill (CSRF and CORS reference).

## Where these are configured

```ts
const app = await NestFactory.create(AppModule, { cors: false });
app.enableCors({ origin: ['https://app.acme.example'], credentials: true });
app.use(helmet());            // Express; Fastify: await app.register(fastifyHelmet)
```

Nest 12.1 adds adapter-agnostic `app.useSecurityHeaders()` and `app.enableCsrfProtection()`. Both throw if called after `app.init()`/`listen()` or twice.

## CORS

Nest uses the Express `cors` package or `@fastify/cors`; `enableCors()` options are the library's. `NestFactory.create(AppModule, { cors: true })` enables defaults.

Investigate:
- `origin: true` (reflects any Origin) or a callback that returns `true`/the request origin, combined with `credentials: true`: any website can make credentialed reads. **High** when the API authenticates with cookies (or any ambient credential); for pure bearer-token APIs the impact is much lower (Hardening).
- `origin: '*'` with `credentials: true` is rejected by browsers, but an origin callback that echoes can recreate it.
- Unanchored regexes (`/acme\.com/`) or `endsWith('acme.com')` matches (`evilacme.com`); `null` origin allowed.
- Fastify default methods are only `GET,HEAD,POST`; people then add `methods` broadly. Express default is `GET,HEAD,PUT,PATCH,POST,DELETE`.
- Gateways: `@WebSocketGateway({ cors: ... })` is configured separately (`websockets-microservices.md`); GraphQL driver `cors` option too.
- Per-environment origin lists read from config with a permissive fallback.

## CSRF

CSRF matters when authentication is carried by ambient credentials: session cookies, a JWT in a cookie, HTTP auth. Pure `Authorization: Bearer` APIs are not CSRF-prone.

- **Nest 12.1+:** `app.enableCsrfProtection({ trustedOrigins, exclude })` follows the Go `CrossOriginProtection` algorithm: `GET`/`HEAD`/`OPTIONS` pass; `Sec-Fetch-Site: same-origin|none` passes; other values are rejected; without `Sec-Fetch-Site` or `Origin` (non-browser) the request passes; otherwise `Origin` host must match the request authority or a trusted origin. Rejected requests become `ForbiddenException`. Limits per the implementing PR: not a token scheme, state-changing `GET` handlers are unprotected, WebSocket upgrades are not covered, `X-Forwarded-Host` is ignored (behind a proxy that rewrites `Host`, add the public origin to `trustedOrigins`), origins allowed by CORS are not trusted automatically. Do not report a 12.1+ app with it enabled as lacking CSRF defense unless cookies are used by non-browser flows that matter or `GET` mutates.
- **Nest 10/11, Nest 12.0:** no built-in. The docs point to `csrf-csrf` (Express, double-submit cookie) or `@fastify/csrf-protection`. `csurf` is deprecated and unmaintained. Look for: cookie-authenticated `POST/PUT/PATCH/DELETE` with no CSRF middleware, no Origin check, and cookies without `SameSite`.
- Excluded routes (webhooks, OAuth callbacks) must authenticate another way (HMAC, state parameter).
- State-changing `GET` routes are exploitable regardless of SameSite=Lax top-level navigation in some flows; flag them.

## Security headers

- Express: `helmet` (8.x current). Fastify: `@fastify/helmet`. Nest 12.1: `useSecurityHeaders()` with the Helmet 8 defaults (including a CSP); options: `contentSecurityPolicy`, `strictTransportSecurity`, `xFrameOptions`, and so on; helmet's legacy names such as `hsts` are rejected.
- Missing `helmet` on an API that returns JSON: Hardening. On an app that serves HTML (`@Render`, `ServeStaticModule`, Swagger UI, GraphiQL): Low/Medium.
- Helmet's default CSP can break Swagger UI/GraphiQL, which leads people to disable CSP globally. Look for `contentSecurityPolicy: false` and per-route relaxations that include `'unsafe-inline'` + `'unsafe-eval'` for the whole app.
- `app.use(helmet())` registered after routes or after early middleware that ends responses does not cover those responses (12.1 hook writes headers before the CSRF check, but `app.use()` middleware registered earlier runs first).
- `X-Powered-By`: Express sets it; `app.disable('x-powered-by')` or Helmet/`useSecurityHeaders()` removes it. Informational.

## Cookies

See `authentication.md` for the 12.1 cookie API. Express `res.cookie()` takes `maxAge` in **milliseconds**, Nest's `setCookie()` in **seconds**. Neither sets `httpOnly`, `secure` or `sameSite` by default. Cookies carrying sessions/JWTs need all three explicitly; `sameSite: 'none'` requires `secure: true`.

## Trust proxy and client IP

- Behind a load balancer, the client IP is wrong unless the adapter trusts the proxy: Express `app.set('trust proxy', hops|'loopback'|[...])` on `NestExpressApplication`; Fastify `new FastifyAdapter({ trustProxy: ... })`. Blanket `true` lets clients spoof `X-Forwarded-For`, which defeats IP-based throttling and audit logs (`rate-limiting-dos.md`).
- Missing configuration makes all users share the proxy's IP: a throttler then rate-limits everyone together, or logs show the proxy.
- Redirects/absolute URL building from `Host`/`X-Forwarded-Host` headers: Host-header poisoning in reset links. Use a configured public base URL.

## False positives

- `enableCors()` with defaults (`*`, no credentials) on a public bearer-token or cookie-less API.
- `origin: true` without `credentials` on a public read-only API.
- No CSRF defense on bearer-only APIs; webhook routes verified by HMAC.
- Missing CSRF middleware on 12.1+ apps that call `enableCsrfProtection()`.

## Verification

```ts
it('does not reflect arbitrary origins with credentials', async () => {
  const res = await request(app.getHttpServer()).options('/invoices')
    .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
  expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
});
it('rejects cross-site state changes (12.1+)', () =>
  request(app.getHttpServer()).post('/account/email').set('Sec-Fetch-Site', 'cross-site').expect(403));
it('sets security headers', async () => {
  const res = await request(app.getHttpServer()).get('/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
```

These tests only count if the test app applies the same `main.ts` configuration.

References: https://docs.nestjs.com/security/cors, /security/csrf, /security/helmet, OWASP CSRF Prevention Cheat Sheet, https://github.com/expressjs/cors; CWE-352, CWE-942, CWE-1021, CWE-346.
