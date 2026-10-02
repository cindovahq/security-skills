# Next.js — Secrets and Configuration

## Contents
- Environment variables and the client bundle
- `next.config` options that leak or weaken
- `.env` files and deployment
- Server Actions encryption key
- Production mode, dev server and tooling
- Severity notes, false positives, verification

## Environment variables and the client bundle

From the Next.js docs:

- Non-`NEXT_PUBLIC_` variables are only available on the server.
- `NEXT_PUBLIC_*` values are **inlined at build time** into "any JavaScript sent to the browser" wherever they are referenced in client code, and frozen at their build-time value. Dynamic lookups (`process.env[name]`, destructuring `const env = process.env`) are not inlined.
- The legacy `env` key in `next.config.js` values are "**always** included in the JavaScript bundle", regardless of prefix.

Investigate:

```bash
grep -rnE "NEXT_PUBLIC_[A-Z_]*(SECRET|PRIVATE|SERVICE_ROLE|ADMIN|TOKEN|PASSWORD|KEY)" --include=*.{ts,tsx,js,jsx,mjs} --include=.env* .
grep -n "env:" next.config.*
```

- A secret under a `NEXT_PUBLIC_` name is a finding only if it's referenced from code that ends up in a client bundle (a `'use client'` module or anything it imports, `pages/*` components). Confirm by tracing imports, or by grepping `.next/static` after a build (see `verification.md`). Treat it as exposed in any case: the name invites client use. Rotate it.
- `next.config` `env: { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY }` → the value is compiled into code that references it.
- Privileged SDK clients (Supabase service role, Firebase Admin, Stripe secret) constructed in modules without `import 'server-only'` and imported by client components.
- Hardcoded secrets in source (`const API_KEY = '...'`). Besides git exposure, Server Function source was exposed by CVE-2025-55183 on unpatched App Router versions.
- `serverRuntimeConfig`/`publicRuntimeConfig` (removed in 16): `publicRuntimeConfig` values are sent to the client.

## `next.config` options that leak or weaken

| Option | Risk |
|---|---|
| `productionBrowserSourceMaps: true` | Serves source maps next to production JS: full original client source (comments, internal URLs, logic). Hardening/Low unless secrets are in client code. |
| `env: {...}` | Inlines values into bundles (above). |
| `images.dangerouslyAllowSVG`, `images.remotePatterns` with `**`, `images.dangerouslyAllowLocalIP` (16+) | See `ssrf-redirects.md` and `xss.md`. |
| `experimental.serverActions.allowedOrigins` | Over-broad wildcards weaken CSRF protection (`server-actions.md`). |
| `rewrites()`/`redirects()` with dynamic hostnames | SSRF / open redirect (`ssrf-redirects.md`). |
| `headers()` | Where security headers and CORS are usually set (`security-headers-csp.md`). |
| `poweredByHeader` | `X-Powered-By: Next.js` is sent by default. Informational/Hardening. |
| `typescript.ignoreBuildErrors` (and `eslint.ignoreDuringBuilds` before 16, where the `eslint` option was removed) | Not vulnerabilities, but hide type errors in auth code. Informational. |
| `allowedDevOrigins` | Dev server only. Over-broad values expose dev endpoints to other origins (CVE-2025-48068 and CVE-2026-27977 hardened this). |

## `.env` files and deployment

- Load order: `process.env` → `.env.$(NODE_ENV).local` → `.env.local` → `.env.$(NODE_ENV)` → `.env`. `create-next-app` gitignores `.env*` files.
- Committed `.env`, `.env.production` or `.env.local` with real values → finding (Critical/High by secret). `.env.example` with placeholders → not a finding.
- Dockerfiles that `COPY .env*` into the image or pass secrets as `ARG` at build time (they persist in layers, and any `NEXT_PUBLIC_` build arg is inlined).
- Prefer runtime reads on the server: `await connection()` before reading `process.env` makes a page dynamic so values come from the runtime environment.

## Server Actions encryption key

- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64, AES key of 16/24/32 bytes) encrypts closed-over action variables. Needed for consistent behavior across self-hosted instances.
- It's a secret: committed values, values shared between staging and production, or values in `NEXT_PUBLIC_*` → Medium (closure data can be decrypted/forged; actions still must authorize).

## Production mode, dev server and tooling

- Running `next dev` in production (check `CMD`/`start` scripts) → verbose errors to clients, dev-only endpoints (including the 16.x dev MCP endpoint, CVE-2026-94486), no optimizations → High.
- `NODE_ENV` not `production` at build.
- Debug/admin routes left in `app/api/debug`, `app/api/health` returning `process.env` or config.
- `instrumentation.ts` `onRequestError` hooks sending full request bodies/headers (cookies) to third-party logging.

## Severity notes, false positives, verification

- Privileged credential in a client bundle (service-role key, secret API key, signing secret) → **Critical**. Internal-only tokens → High. Analytics IDs or publishable keys → not a finding.
- **Not findings:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`/publishable keys, Stripe publishable keys (`pk_`), analytics IDs, Sentry DSNs; `.env.example` placeholders.
- **Verify:** `next build`, then `grep -rl "<first 8 chars of the secret>" .next/static` must return nothing. After fixing, **rotate** the leaked credential: removing it from code does not revoke copies already served.

References: OWASP A02:2025 Security Misconfiguration; CWE-200, CWE-312, CWE-540, CWE-798; https://nextjs.org/docs/app/guides/environment-variables, https://nextjs.org/docs/app/api-reference/config/next-config-js/env, https://nextjs.org/docs/app/api-reference/config/next-config-js/productionBrowserSourceMaps, https://nextjs.org/docs/app/guides/data-security#closures-and-encryption.
