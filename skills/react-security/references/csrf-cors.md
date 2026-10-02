# React — CSRF, CORS and Cross-Origin Requests

## Contents
- When CSRF applies to a React app
- Framework mechanisms
- CORS review
- Dev server and proxy settings
- WebSockets and event streams
- Severity, false positives, verification

## When CSRF applies to a React app

CSRF needs a browser that attaches credentials automatically: cookies, HTTP auth, client certificates. Bearer tokens set by JavaScript in an `Authorization` header are not CSRF-prone (they are an XSS-theft problem, see `authentication-sessions.md`).

- SPA + API on the same site, cookie session: the API needs a CSRF defense (framework token, or strict `Origin`/`Sec-Fetch-Site` checks) plus `SameSite=Lax` or `Strict`. Do not rely on browser defaults for `SameSite`; set it.
- SPA on `app.example.com`, API on `api.example.com`: same-site but cross-origin. CORS blocks reading responses but not sending simple requests; `SameSite` cookies are sent. Subdomain takeover or XSS on a sibling subdomain bypasses `SameSite`.
- JSON APIs that accept `text/plain` or form-encoded bodies with cookie auth: a cross-site `<form>` can send them without a preflight.
- GET endpoints with side effects, including router `loader`s (logout, delete, confirm, "unsubscribe" links): reachable by top-level navigation under `SameSite=Lax`.
- `SameSite=None` cookies need a real token defense.

Client-side code that adds a CSRF header (`X-CSRF-Token`, `X-Requested-With`) is correct only if the server validates it. A token read from `localStorage`/a cookie and echoed without server validation is theater.

## Framework mechanisms

- **React Router framework mode (>=7.12.0):** origin check on UI-route mutations (`allowedActionOrigins`); not applied to resource routes. Details and version history in `react-router.md`. Remix v2 got the equivalent in `@remix-run/server-runtime` 2.17.3.
- **TanStack Start:** `createCsrfMiddleware()` installed by default for server functions when there is no `src/start.ts`; checks `Sec-Fetch-Site`, `Origin` or `Referer` and rejects requests it cannot prove same-origin (docs). Custom `start.ts` must add it; server routes are unprotected unless you add it (`filter` option).
- **Pure SPA/API:** nothing in React protects you; check the API (`nodejs-security`, `laravel-security`).
- Forms using `<Form method="post">` or `fetch` with `credentials: 'include'` carry cookies. The router does not add tokens.

## CORS review

- `Access-Control-Allow-Origin` reflecting the request `Origin` with `Access-Control-Allow-Credentials: true`: any site can read authenticated responses: **High**. Browsers reject `*` with credentials, so reflected origins are what you will find.
- Allow-list bugs: `origin.endsWith('example.com')` (matches `evilexample.com`), unanchored regexes, `includes`, trusting `null` (sandboxed iframes, `file:`), allowing all subdomains when one is user-controlled.
- `Access-Control-Allow-Origin: *` without credentials on public, non-personalized data is fine. It is a finding on endpoints that authenticate by network position (intranet/localhost services) or by a bearer token the page holds.
- Preflight caching (`Access-Control-Max-Age`) and `Vary: Origin` missing on dynamic allow-lists (cache poisoning): Hardening.
- CORS governs reading responses, not sending requests.

## Dev server and proxy settings

- Vite `server.cors` defaults to a localhost-only `origin` regex (Vite docs). `server.cors: true` allows any origin on the dev server. `server.allowedHosts: true` "allows any website to send requests to your dev server and download your source code and content" (docs). CVE-2025-24010 let any website send requests to the dev server and read the response (Vite 5.4.12, 6.0.9 and later fix it). Dev-only: Hardening unless the dev server is exposed with `--host` on untrusted networks.
- `server.proxy` entries are dev-only; production needs the real reverse-proxy rules. A dev-proxy `changeOrigin` and header rewrites don't exist in production, so test the deployed topology.
- Webpack dev server `allowedHosts: 'all'`, `disableHostCheck: true`: same class.

## WebSockets and event streams

- Browsers send cookies on WebSocket handshakes and do not apply CORS: the server must check `Origin` (cross-site WebSocket hijacking).
- Tokens in the WebSocket or `EventSource` URL (`wss://api/x?token=...`) land in logs and proxies. Prefer a short-lived ticket exchanged over an authenticated request, or a cookie with `Origin` checking. Medium/Low.
- GraphQL subscriptions: apply the same auth to the `connection_init` payload.

## Severity, false positives, verification

- Cookie-authenticated, state-changing endpoint with no origin/token defense and `SameSite=None` or none set: **High** for sensitive actions (email/password change, money, role), Medium otherwise. With `SameSite=Lax` and POST-only JSON requiring `application/json`: Low/Hardening. Reflected CORS origin with credentials: High.
- **Not findings:** missing CSRF tokens on bearer-only APIs; webhook routes verified by signature; React Router actions on >=7.12.0 same-site apps (origin check); `Access-Control-Allow-Origin: *` on public static data; dev-server settings in `vite.config.ts` that apply only to `vite dev`.
- **Verify:** `curl -i -H "Origin: https://evil.example" -H "Cookie: <session>" https://api/...` and confirm the response does not echo the origin with credentials; POST to the action with a foreign `Origin` and expect `400`/`403`; submit a cross-site form to the endpoint in a browser test with a `SameSite=Lax` cookie.

References: OWASP CSRF Prevention Cheat Sheet, CORS (Cross-Origin Resource Sharing) section of the HTML5 Security Cheat Sheet; CWE-352, CWE-346, CWE-942, CWE-1385; https://vite.dev/config/server-options, https://tanstack.com/start/latest/docs/framework/react/guide/middleware.
