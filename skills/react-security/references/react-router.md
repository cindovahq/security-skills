# React Router (7.x and 8.x) — Modes, Server Surface and Pitfalls

## Contents
- Modes and what each exposes
- Reading the project
- Server behavior that matters
- Action-origin CSRF check
- Redirects and navigation with untrusted input
- Sessions, headers and resource routes
- Version notes
- Severity, false positives, verification

## Modes and what each exposes

| Mode | How to recognize it | Security surface |
|---|---|---|
| Declarative | `<BrowserRouter>`, `<Routes>`, `<Route>` | Client only. Navigation sinks (`Navigate`, `Link`, `navigate()`) |
| Data | `createBrowserRouter`, `<RouterProvider>`; `loader`/`action` are client functions | Client only plus any API they call. No server runtime |
| Framework | `react-router.config.ts`, `app/routes.ts`, `@react-router/dev` Vite plugin, route modules in `app/routes/` | Server `loader`/`action` (public HTTP endpoints), SSR, sessions, resource routes, adapters (`@react-router/node`, `express`, `serve`, `cloudflare`, `architect`) |
| RSC (unstable) | `unstable_` RSC APIs, `react-server-dom-*` | Server Functions; separate advisories; do not recommend for production |

Advisory notes in `react-router` state which items affect only Framework mode (and sometimes Data mode with manual SSR). `ssr: false` in `react-router.config.ts` makes a SPA with a pre-rendered `index.html`; there is then no runtime server for loaders (docs: loaders "are only called on the server when server rendering or during the build with pre-rendering").

## Reading the project

1. Versions from the lock file: `react-router`, `@react-router/*`, `react`, `react-dom`, `vite`. v8 requires React 19.2.7+, Vite 7+, Node 22.22+, is ESM-only and removed `react-router-dom` (import from `react-router` and `react-router/dom`). Old `react-router-dom` 6.x or `@remix-run/*` 2.x dependencies are separate support lines (`dependencies.md`).
2. `react-router.config.ts`: `ssr`, `prerender`, `allowedActionOrigins`, `routeDiscovery`, `buildDirectory`.
3. `app/routes.ts` (explicit config or `@react-router/fs-routes`): list every route file. Files with only `loader`/`action` and no default export are resource routes.
4. `app/entry.server.tsx` (customized?): headers, CSP nonce, `renderToPipeableStream` options, `handleError` logging.
5. `app/root.tsx`: inline scripts, `<Scripts>`, `<ScrollRestoration getKey storageKey>`, `meta` and `links` exports, and which user data is in the root `loader`.

## Server behavior that matters

- `loader` and `action` are removed from client bundles and run on the server; `clientLoader`/`clientAction` run in the browser; `.server` modules are excluded from client bundles and fail the build if imported by client code (docs).
- On client navigation the browser calls `<path>.data` for the loaders of matched routes; direct requests to that URL run the loader with no UI. Loaders run in parallel (see `authorization.md`).
- Hydration data is embedded in the HTML via `window.__reactRouterContext` (escaped by React Router; see `ssr-hydration.md`).
- Request headers once exposed internal behavior: `X-React-Router-SPA-Mode` (cache-poisoning DoS, CVE-2025-43864) and `X-React-Router-Prerender-Data` (spoofed pre-render data, CVE-2025-43865), both fixed in 7.5.2. Behind a shared cache, old versions plus caching of `.data` or HTML responses is a finding.
- `@react-router/express` host/URL spoofing through `Host`/`X-Forwarded-Host` (CVE-2025-31137) was fixed in 7.4.1. v7.18.0 changed the CSRF origin check to compare against the request URL host, which can need `allowedActionOrigins` behind reverse proxies; the Express adapter reads `x-forwarded-host` based on `trust proxy` (changelog 7.18.0).
- Framework mode RCE chain CVE-2026-42211 (react-router 7.0.0 to 7.14.1, fixed 7.14.2) needs an existing prototype-pollution bug in application code. Prototype pollution on a React Router server is therefore High (`dynamic-code.md`).

## Action-origin CSRF check

Since 7.12.0 (changelog): "rejecting submissions to UI routes from external origins". Reading `throwIfPotentialCSRFAttack` in the source:

- It runs for mutation methods on UI-route requests. If an `Origin` header is present and its origin differs from the request URL origin, the request is rejected with `400` unless the origin host matches an entry in `allowedActionOrigins` (micromatch-style: `*` one label, `**` multiple labels).
- A request without an `Origin` header passes. `Origin: null` is compared as the literal value and rejected unless allowed.
- Docs: it does **not** apply to resource routes. Protect cookie-authenticated resource routes yourself (`csrf-cors.md`).
- Versions: none before 7.12.0; POST only until 7.15.1 added PUT/PATCH/DELETE (CVE-2026-53663, Low); RSC-mode gaps fixed in 7.18.2/8.3.0 (GHSA-qwww-vcr4-c8h2).
- Finding patterns: `allowedActionOrigins: ['**']` or broad wildcards; app on <7.12.0 with cookie auth and `sameSite: 'none'` or no SameSite (Medium); mutations in loaders (GET).

## Redirects and navigation with untrusted input

`redirect(url)` returns a `302` by default and, per its docs security note, "accepts absolute URLs and can navigate to external domains, so the application should validate any user-supplied inputs to redirects". Same for `<Navigate to>`, `navigate()`, `<Link to>`, `<Form action>`, `redirectDocument()`/`replace()`. Advisories (CVE-2025-68470, CVE-2026-22029, CVE-2026-40181, CVE-2026-53669; versions in `dependencies.md`) show that untrusted paths reaching these APIs can produce external navigation or even script execution on older releases, and that fixes were repeatedly bypassed. Validate in application code regardless of version: `ssrf-redirects.md`.

## Sessions, headers and resource routes

- `createCookieSessionStorage`/`createCookie` options and secrets: `authentication-sessions.md`.
- `export function headers()` sets response headers per route (check the docs for how nested routes' headers combine, so a child route doesn't drop headers set by a parent). Security headers belong in `entry.server.tsx` or the host (`security-headers-csp.md`).
- Resource routes returning files, CSV or JSON: authorization, `Content-Type`/`Content-Disposition`, and CSRF for cookie-authenticated mutations.
- Webhook resource routes must verify the provider signature over the raw body (`await request.text()`) with a constant-time compare.
- `meta()` and `links()` receive loader data: React escapes the text, but JSON-LD via `script:ld+json` was an XSS in 7.0.0 to 7.8.2 (fixed 7.9.0). Prefer `<Meta />` output over hand-built inline scripts.

## Version notes

As of 2026-10-02: `react-router` latest 8.4.0 (2026-09-15); 7.x latest 7.18.4. Advisory fix floor: **7.18.2 or 8.3.0** (earlier 7.18.0/8.0.0 lines lack the RSC CSRF fix, which matters only with unstable RSC). Upgrade guidance and the full table are in `dependencies.md`.

## Severity, false positives, verification

- Missing authorization in loaders/actions, session secret forgery, unauthenticated mutating resource routes: Critical/High (`authorization.md`). Missing CSRF checks on cookie-auth actions in <7.12.0 or on resource routes: Medium (raise if the action is sensitive and cookies are `SameSite=None`). Old-version advisories: rate by reachability (CVE-2026-22029 needs untrusted redirect targets; CVE-2026-21884 needs untrusted `getKey`/`storageKey`).
- **Not findings:** `loader` code reading `process.env` secrets (server-only); `<Link to={path} target="_blank">`; `redirect('/login')` constants; `Form method="post"` lacking a CSRF token on >=7.12.0 same-site apps (framework origin check plus `SameSite=Lax`); Declarative/Data-mode apps flagged for server advisories.
- **Verify:** `npm ls react-router @react-router/node`; POST to an action with `Origin: https://evil.example` on staging and expect `400`; request `<route>.data` as an anonymous or other user and expect a redirect or 403; confirm `grep -r "process.env" build/client` finds no secrets.

References: https://reactrouter.com/start/framework/route-module, https://reactrouter.com/api/framework-conventions/react-router.config.ts, https://reactrouter.com/api/utils/redirect, https://reactrouter.com/how-to/security, https://github.com/remix-run/react-router/blob/main/CHANGELOG.md, https://github.com/remix-run/react-router/security/advisories; CWE-352, CWE-601, CWE-79.
