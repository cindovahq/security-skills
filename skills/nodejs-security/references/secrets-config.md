# Node.js — Secrets, Environment, Error Handling, Proxies and Headers

## Contents
- Secrets in the repository and code
- Environment loading and `NODE_ENV`
- Error handling and information leaks
- Proxies, `trust proxy` and client IPs
- Security headers (helmet) and fingerprinting
- Logging
- Cryptography and randomness
- False positives
- Verification

## Secrets in the repository and code

Redact values in reports (key name and first characters only).

- `.env`, `.env.production`, `.env.local` tracked in git (`git ls-files | grep -i env`); real values in `.env.example`, `docker-compose*.yml`, CI workflows, Dockerfiles (`ENV`/`ARG`), `config/*.json`, test fixtures.
- **Fallback defaults in code:** `process.env.SESSION_SECRET || 'keyboard cat'`, `process.env.JWT_SECRET ?? 'changeme'`. If the variable is missing in any environment, the app silently runs with a public secret → forged sessions/JWTs (**Critical** when reachable in production, High otherwise). Fix: fail fast at startup when required secrets are missing or short.
- Secrets in front-end bundles: anything imported into browser code or exposed by a bundler (`VITE_*`, `NEXT_PUBLIC_*`, `REACT_APP_*`, webpack `DefinePlugin` of `process.env`) is public.
- `.npmrc` with `_authToken`, `config.json` with cloud keys, service-account JSON, `*.pem`.

A live secret committed to a repo must be rotated, not just deleted (**High/Critical**). Placeholders are Informational.

## Environment loading and `NODE_ENV`

- `dotenv` (`require('dotenv').config()`) or Node's built-in `--env-file` (added v20.6.0, stable since v24.10.0/v22.21.0; real environment variables take precedence over the file) and `process.loadEnvFile()`. A committed `.env` loaded in production is a secrets-management finding.
- `NODE_ENV` changes security behavior: Express (`app.get('env')`) and `finalhandler` default to `'development'` when unset, which puts **stack traces in error responses**; express-session only warns about `MemoryStore` when it is `production`; template engines may disable caching; some libraries enable debug output. Verify production sets `NODE_ENV=production` (Dockerfile, PM2 ecosystem file, systemd unit, platform env).
- Debug endpoints and tooling left in production: `--inspect`/`--inspect=0.0.0.0` in start scripts (remote code execution for anyone who can reach the port), `/debug`, `/env`, `/health` returning `process.env`, `express-status-monitor`, swagger UIs with "try it out" against production, `morgan('dev')` logging bodies.

## Error handling and information leaks

- Express default handler (`finalhandler`): when `env !== 'production'` it responds with `err.stack` in an HTML page (verified on Express 5.2). In production it sends only the status message.
- Custom handlers that leak regardless of env:

```js
app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));
```

  Stack traces reveal paths, library versions and sometimes SQL or connection strings → **Low/Medium** (higher when they include secrets or SQL).
- Fastify's default error handler returns `err.message` for 500 errors (tested on Fastify 5: `{"statusCode":500,"error":"Internal Server Error","message":"..."}`), so database or upstream error messages reach clients. Set an error handler that logs details and returns a generic message for 5xx.
- Koa's default handler exposes `err.message` only when `err.expose` is true (4xx `ctx.throw`); otherwise it sends the status text.
- Errors from validation libraries echoing the full input (including passwords) back to the client.

## Proxies, `trust proxy` and client IPs

Express `trust proxy` (default `false`) controls `req.ip`, `req.ips`, `req.protocol`, `req.secure` and `req.hostname`:

| Value | Effect (tested on Express 5.2 with `X-Forwarded-For: 1.1.1.1, 2.2.2.2`) |
|---|---|
| `false` | Socket address; forwarded headers ignored. Behind a proxy every client looks like the proxy and `req.secure` is false. |
| `true` | Left-most XFF entry (`1.1.1.1`): **client-controlled**. Also trusts `X-Forwarded-Proto`/`X-Forwarded-Host` from anyone. |
| number `n` | The entry `n` hops from the right (`1` → `2.2.2.2`): correct when exactly `n` trusted proxies always sit in front. |
| `'loopback'`, `'uniquelocal'`, CIDR list, function | Trust only those proxy addresses (best when known). |

- `true` on an app reachable directly or through proxies that append rather than overwrite XFF → IP spoofing: rate-limit bypass, IP allow-list bypass, poisoned audit logs (**Medium**, higher when IP is an access control). Spoofed `X-Forwarded-Host` affects `req.hostname`-based links.
- Code reading `req.headers['x-forwarded-for']` or `x-real-ip` directly has the same problem.
- Fastify `trustProxy` (default `false`) has the same semantics. In Fastify 5, a numeric hop count is ignored (fails closed, trusting no proxy). The docs recommend IP/CIDR lists or a validating function. Koa: `app.proxy` (default `false`) with `maxIpsCount`. Hono on Node: `getConnInfo()` from `@hono/node-server/conninfo` gives the socket address; reading XFF is up to you.

## Security headers (helmet) and fingerprinting

- Express sends `X-Powered-By: Express` by default (`app.disable('x-powered-by')` or helmet removes it). Fingerprinting only: Informational.
- `helmet()` 8.x defaults (tested): CSP `default-src 'self'` with `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `style-src 'self' https: 'unsafe-inline'`, `upgrade-insecure-requests`; HSTS `max-age=31536000; includeSubDomains`; `X-Content-Type-Options: nosniff`; `X-Frame-Options: SAMEORIGIN`; `Referrer-Policy: no-referrer`; COOP/CORP `same-origin`; `X-XSS-Protection: 0`.
- Review overrides: `contentSecurityPolicy: false`, `'unsafe-inline'`/`'unsafe-eval'` in `script-src`, wildcard sources, `crossOriginResourcePolicy: false` without need.
- Missing headers are **Hardening**, except clickjacking protection on pages with one-click sensitive actions (Low/Medium).
- HTTPS: redirect HTTP→HTTPS at the proxy or app; cookies `secure` (see `sessions-cookies.md`).

## Logging

- `console.log(req.body)`, `logger.info({ body: req.body })` on login/registration/payment routes → passwords, tokens, card data in logs (**Medium**; Low if logs are tightly controlled).
- `morgan` formats with `:req[authorization]` or full URLs containing tokens (`?token=`).
- pino/winston redaction: pino `redact: ['req.headers.authorization', 'req.headers.cookie', '*.password']`.
- Error trackers (Sentry, Datadog) capturing request bodies and headers: check scrubbing settings.
- Logging `process.env` or config objects at startup.

## Cryptography and randomness

- Tokens/secrets/IDs that must be unguessable: `crypto.randomBytes`, `crypto.randomUUID()`, `crypto.getRandomValues`. `Math.random()`, `Date.now()`, `shortid`, sequential IDs → **High** when used for reset tokens, API keys, invite codes or session IDs.
- Compare secrets with `crypto.timingSafeEqual` (equal-length `Buffer`s; check lengths first because it throws otherwise).
- `crypto.createCipher` (no IV) was removed in Node 22; `createCipheriv` with a static IV, ECB mode, or AES-CBC without a MAC → **High** for confidentiality-critical data. Prefer AES-256-GCM with a random 12-byte IV and verify the auth tag (`setAuthTag` before `final()`); check `authTagLength` when accepting tags.
- Hashing for integrity of client-visible data: HMAC (`crypto.createHmac('sha256', key)`), not `sha256(data + secret)`.
- TLS: `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0` → MITM on outbound calls (**High** for credentials/PII over the network).

## False positives

- `.env.example` with placeholder values and `NODE_ENV=development`.
- Fallback secrets in test setup files that never run in production (confirm the code path).
- `X-Powered-By` present: Informational only.
- `Math.random()` for non-security uses (jitter, sampling, UI IDs).

## Verification

```bash
NODE_ENV=production node -e "require('./src/config')"      # should throw if SESSION_SECRET is unset
curl -s https://staging.example.com/does-not-exist-500-trigger | grep -c ' at '   # expect 0 stack frames
curl -sI https://staging.example.com/ | grep -iE 'x-powered-by|content-security-policy|strict-transport'
curl -s -H 'X-Forwarded-For: 203.0.113.9' https://staging.example.com/whoami          # IP should not change
```

```js
it('hides internals in 500 responses', async () => {
  const r = await request(app).get('/__test/throw');
  expect(r.text).not.toMatch(/at .*\.js:\d+/);
});
```

References: OWASP Secrets Management, Error Handling, Logging, HTTP Headers, Cryptographic Storage Cheat Sheets; CWE-209, CWE-215, CWE-312, CWE-321, CWE-338, CWE-348, CWE-532, CWE-798; https://expressjs.com/en/guide/behind-proxies.html, https://expressjs.com/en/advanced/best-practice-security.html, https://helmetjs.github.io/, https://nodejs.org/api/cli.html#--env-filefile.
