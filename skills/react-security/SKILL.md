---
name: react-security
description: Security review and secure-coding guidance for React applications that are not Next.js (React 18.x and 19.x), covering Vite and legacy Create React App SPAs, React Router 7 and 8 in declarative, data and framework mode (loaders, actions, SSR), TanStack Router and Start, Remix v2, Gatsby, and React embedded in other backends. Use when auditing, reviewing or hardening a React codebase, or when writing or changing components, routes, loaders, actions, token handling, environment variables, Markdown or HTML rendering, postMessage, iframes, CSP or build config. Triggers on react in package.json with vite.config, react-scripts, react-router, @tanstack/react-start or gatsby. Covers XSS (dangerouslySetInnerHTML, javascript URLs, DOMPurify, react-markdown), VITE_ and REACT_APP_ secrets in bundles, source maps, token storage, client-side guards versus server authorization, loader and action IDOR, CSRF and CORS, open redirects, prototype pollution, eval, CSP and dependencies. Next.js belongs to nextjs-security.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "React 18.x, 19.x (19.3.0 latest), React Router 7.x and 8.x, Vite 6.x, 7.x and 8.x, TanStack Router and Start 1.x, Remix 2.x"
  last-verified: "2026-10-02"
---

# React Security

Find, explain, fix and verify security issues in React applications, and write React code that doesn't introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: audit, security review, pentest prep, "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: writing or modifying React code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change. Load only the reference for the area you are touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the React-specific knowledge. If it is not installed, use the [evidence and reporting rules](#evidence-and-reporting-rules) below. Next.js (App Router, Server Actions, RSC) belongs to `nextjs-security`. Express, Fastify and other Node backends belong to `nodejs-security`. Supabase policies belong to `supabase-security`; Laravel backends to `laravel-security`. React Native and Remix 3 (which does not use React) are out of scope.

## The React security model in one paragraph

React escapes text and attribute values and does little else. It does not sanitize `dangerouslySetInnerHTML` or anything you put in the DOM yourself, it blocks `javascript:` URLs only in element attributes and only since React 19, and it protects nothing outside the view layer. Code that ships to the browser is public: `VITE_`/`REACT_APP_`/`GATSBY_` values, source maps, "hidden" admin screens and client-side role checks are visible and editable by every visitor. Authorization belongs to the server or API, never to route guards. Router frameworks add a server: React Router `loader`/`action`, TanStack `createServerFn` and resource routes are public HTTP endpoints, and whatever they return is serialized to the browser. Most real findings are escape hatches (raw HTML, URL sinks, `eval`), secrets or data in the bundle or payload, missing server-side checks, redirects, and outdated dependencies.

## Review workflow

### 1. Confirm the stack and version

1. Identify the app type from `package.json`, config and entry files: Vite SPA (`vite.config.*`, `index.html`, `src/main.tsx`), Create React App (`react-scripts`), React Router declarative or data mode (`BrowserRouter`, `createBrowserRouter`), **React Router framework mode** (`react-router.config.ts`, `app/routes.ts`, `@react-router/dev`), TanStack Router or Start, Remix v2 (`@remix-run/*`), Gatsby, or React mounted by a server template (Inertia, Rails, Laravel). `next` in dependencies means `nextjs-security`.
2. Read **installed** versions from the lock file (not ranges): `react`, `react-dom`, `react-router`/`@react-router/*`, `vite`, `@tanstack/*`, `dompurify`, `marked`/`react-markdown`, auth libraries. React 18 and 19 differ in `javascript:` URL handling and more (`references/xss.md`).
3. Find where the backend lives. A SPA's authorization and sessions are in its API: review it (or its BaaS rules) with the matching skill, or report client-only findings as **Likely** and name the missing server evidence.
4. Check support status and advisories (checked 2026-10-02): React 19.3.0 latest; React Router fix floor 7.18.2 or 8.3.0; Vite 6.4.3, 7.3.5 or 8.0.16 and newer for the dev-server advisories; DOMPurify 3.4.16 latest; TanStack Start `react-start` 1.168.60 or newer; CRA is deprecated. See `references/dependencies.md`.
5. Record the hosting model (static CDN, Node server, edge). Headers, CSP nonces and caching depend on it.

### 2. Map the attack surface

- **Server surface:** `loader`/`action` exports, resource routes (route files without a component), `createServerFn`, server routes, `entry.server.tsx`, adapters, Gatsby Functions.
- **Input sources:** URL params and search params (`useParams`, `useSearchParams`, `location.hash`), form data, `postMessage`, `localStorage`/IndexedDB reads, API responses with user content, CMS/Markdown/HTML fields.
- **Sinks:** `dangerouslySetInnerHTML`, `innerHTML`/refs, `srcDoc`, `window.location`/`window.open`/`navigate`/`redirect`, `eval`/`new Function`, inline `<script>`, deep merges.
- **Build and config:** `vite.config.*` (`define`, `envPrefix`, `build.sourcemap`), `.env*`, Dockerfiles, `react-router.config.ts`, hosting headers.
- **Auth and tokens:** where tokens are stored, session cookie settings, OAuth flow, route guards.
- **Third-party code:** scripts and widgets loaded at runtime, SDKs, tag managers.

### 3. Review each area

Load the reference for each area as you reach it. Do not load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| XSS | `references/xss.md` | `dangerouslySetInnerHTML`, `ref.current.innerHTML`, `javascript:` URL handling by React version, prop spreads, dynamic tag names |
| Sanitizers, Markdown, SVG | `references/sanitization-markdown.md` | DOMPurify version/config/mutation after sanitize, `marked.parse`, `rehype-raw`, `urlTransform`, `srcDoc`, `escapeValue: false` |
| SSR state and inline scripts | `references/ssr-hydration.md` | `JSON.stringify` inside `<script>`, JSON-LD, nonces, loader payloads, SSR XSS advisories |
| Secrets and build config | `references/secrets-config.md` | `VITE_`/`REACT_APP_` secrets, `define: { 'process.env' }`, source maps, public-by-design keys, persisted state, dev server |
| Authentication and sessions | `references/authentication-sessions.md` | Tokens in `localStorage`, OAuth/PKCE, session secrets and cookie flags, logout cleanup |
| Authorization | `references/authorization.md` | Client-only guards, loaders/actions/server functions without checks, IDOR, mass assignment, full rows returned |
| React Router | `references/react-router.md` | Mode, `.data` endpoints, `allowedActionOrigins`, `redirect()`, resource routes, middleware caveats |
| TanStack, Remix, Gatsby, CRA, others | `references/other-frameworks.md` | `createServerFn` protections, Remix 2.x lines, `GATSBY_` data, CRA toolchain, Inertia props |
| CSRF and CORS | `references/csrf-cors.md` | Cookie auth without origin/token defense, GET loaders that mutate, reflected CORS origins, dev server settings |
| Redirects, navigation, SSRF | `references/ssrf-redirects.md` | `next`/`returnTo` params, `window.location = x`, `redirect(x)`, OAuth `redirect_uri`, server `fetch(userUrl)` |
| Browser APIs and third-party scripts | `references/browser-apis.md` | `message` listeners without origin checks, `postMessage(..., '*')`, iframes, storage, service workers, tag managers |
| Dynamic code and prototype pollution | `references/dynamic-code.md` | `eval`/`new Function`, formula/expression features, recursive merges of URL/JSON data |
| Headers and CSP | `references/security-headers-csp.md` | Where headers are set, `unsafe-inline`/`unsafe-eval`, nonce generation, Trusted Types, caching |
| Dependencies | `references/dependencies.md` | Router/Vite/DOMPurify/TanStack versions vs advisories, supply chain, `npm audit` noise |
| Verification | `references/verification.md` | Tests, `curl` checks and bundle greps that prove each finding and fix |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation. Classify with the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses the platform's own mechanism (a server-side guard, a sanitizer at the sink, a validated redirect helper, a DTO, moving a secret server-side). Then verify using `references/verification.md`: the attack no longer works, legitimate use still works, and the same pattern isn't repeated elsewhere (search for siblings).

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# XSS and DOM sinks
dangerouslySetInnerHTML   .innerHTML =   insertAdjacentHTML   document.write   srcDoc=   {...props} from JSON
marked(   marked.parse(   rehype-raw   allowDangerousHtml   urlTransform   escapeValue: false   DOMPurify.sanitize(   ADD_TAGS
window.location   location.href =   location.assign   window.open(   redirect(   <Navigate to=   navigate(   returnTo   next=
JSON.stringify( inside <script   __INITIAL_STATE__   __APP__   application/ld+json

# Secrets and data in the client
VITE_.*(SECRET|TOKEN|KEY|PASSWORD)   REACT_APP_.*(SECRET|TOKEN|KEY)   GATSBY_   define: { 'process.env'   loadEnv(.*''   envPrefix
sourcemap: true   GENERATE_SOURCEMAP   .env.production   localStorage.setItem(   sessionStorage   persist(   devTools

# Server surface and authorization
export async function loader   export async function action   createServerFn   createCookieSessionStorage   secrets:   ?? '
Object.fromEntries(formData)   request.json()   findUnique({ where: { id   params.id   useRouteLoaderData   isAdmin   RequireAuth

# CSRF / CORS / browser APIs
allowedActionOrigins   credentials: 'include'   Access-Control-Allow-Origin   addEventListener('message'   postMessage(   '*'   target="_blank"
eval(   new Function(   setTimeout(`   _.merge   deepMerge   Object.assign(   __proto__   @vite-ignore
```

## Common false positives

Do not report these without further evidence:

- **JSX interpolation of user data** (`{user.name}`, `title={x}`). React escapes it.
- **`href={user.url}` / `src` / `action` on React 19.x elements.** React 19.0.0+ replaces `javascript:` URLs with a throwing URL (verified in source and SSR output). Still report `window.location`/`window.open`/`navigate` sinks, string-built markup, any React 18 app, and `data:` iframes.
- **`target="_blank"` without `rel="noopener"`.** Browsers imply `noopener` (MDN).
- **`dangerouslySetInnerHTML` on DOMPurify (patched, not 3.4.4)/`sanitize-html` output** with default or allow-list config applied last, or on static/build-time content.
- **`react-markdown` with default settings** (no `rehype-raw`, default `urlTransform`).
- **Public-by-design keys in the bundle:** Supabase anon/publishable keys and Firebase web config (when RLS/security rules protect the data), Stripe `pk_`, Sentry DSNs, analytics IDs, Maps/Mapbox public tokens, public OAuth client IDs. Server-only `loader`/`action`/`.server` code reading `process.env` is not in the bundle.
- **`import.meta.env.DEV`-guarded debug code** (removed from production builds) and `.env.example` placeholders.
- **React2Shell and other `react-server-dom-*` advisories against a SPA or non-RSC React Router app.** Those packages are not installed (`references/dependencies.md`).
- **Vite dev-server CVEs and `npm audit` build-tool noise** against a static production deployment (CRA especially).
- **Missing CSRF tokens on bearer-token APIs, signature-verified webhooks, or React Router actions on >=7.12.0** same-site apps (framework origin check plus `SameSite`).
- **`fetch(userUrl)` in browser code.** That is not SSRF. Server-side `fetch` in a loader is.
- **A client-side route guard** that is also enforced server-side. Mention as defense in depth only.
- **Missing CSP/HSTS alone:** Hardening, never the headline finding.

## Severity calibration

Common mis-ratings to avoid:

- **Missing authorization in a `loader`/`action`/server function** is rated by what it returns or does, not by the UI's guard. Unauthenticated admin actions or cross-tenant reads are **Critical/High**.
- **Client-side-only authorization with an unreviewed API** is **Likely** until the server check is seen; do not close it as "frontend only".
- **Privileged secrets in a shipped bundle** (service-role key, secret API key, admin token) are **Critical**; internal-only tokens High; source maps alone Low.
- **Forgeable sessions** (hardcoded or fallback session secret, unsigned cookie) are **Critical/High**: account takeover.
- **Stored XSS affecting other users or admins** is **High**; a token in `localStorage` is an impact amplifier and a Hardening/Low finding on its own, not Critical.
- **Data in loader payloads** (hashes, reset tokens, API keys, other users' PII) is **High** even if nothing renders it.
- **Open redirects** are Low/Medium alone; High when `javascript:` reaches `location`, or tokens leak through OAuth callbacks.
- **Outdated router/sanitizer versions** are rated by the worst reachable advisory (for example CSRF with cookie auth, or a sanitizer bypass on a live sink), not by the CVE headline.

## Build-mode guardrails

When writing React code, default to:

1. **Render with JSX.** No `dangerouslySetInnerHTML`/`innerHTML` for user data. If HTML is required, sanitize with a current DOMPurify at the sink and keep it the last step. Render Markdown with `react-markdown` defaults.
2. **Validate URLs and redirects.** Allow-list schemes (`http:`/`https:`), and pass `next`/`returnTo` values through a same-origin path validator before `redirect()`, `navigate()` or `location`.
3. **No secrets in client code.** Only public values use `VITE_`/`REACT_APP_`/`GATSBY_`. Never `define: { 'process.env': process.env }`. Build without public source maps, or upload them privately.
4. **Authorize on the server, in every handler.** Each `loader`, `action`, resource route and server function checks the session and scopes data by user/tenant itself. Client guards are UX only.
5. **Return DTOs.** Select explicit fields in loaders and server functions. Never return ORM rows or session objects.
6. **Validate inputs with a schema** (zod/valibot) and allow-list writable fields. No `Object.fromEntries(formData)` straight into the database, no recursive merge of request data.
7. **Mutations use POST (or other non-GET) actions.** Cookie-authenticated routes get origin/token CSRF protection, including resource routes. Keep `react-router` on a patched version with `allowedActionOrigins` tight.
8. **Tokens and sessions:** prefer `httpOnly; Secure; SameSite` cookies or a BFF over `localStorage`; sign cookie sessions with a strong environment-provided secret; clear all client state on logout.
9. **Messaging and embedding:** check `event.origin` exactly, always give `postMessage` an explicit `targetOrigin`, sandbox untrusted iframes, and avoid `allow-scripts allow-same-origin` together.
10. **No dynamic code.** No `eval`/`new Function` for config or formulas; use a registry of components and a small expression grammar. Use `Object.create(null)`/schemas when merging external objects.
11. **Headers and CSP** from the host or server: CSP with nonces or hashes, `frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS. Per-request nonces for SSR.
12. **Keep dependencies patched** (React Router, Vite, DOMPurify, TanStack), commit the lock file, install with `npm ci`, and add a test for each security boundary you write (another user gets 403/404, unsafe redirect falls back, hostile HTML renders inert).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the path from attacker input to impact is fully traced in code/config, or it was safely demonstrated.
- **Likely**: strong evidence, but one condition (a backend check you can't see, hosting headers, an environment value) could not be verified. Name it.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact x exploitability x required privileges x exposure. Do not raise severity because a scary keyword appears. Unauthenticated RCE, auth bypass and cross-tenant data access are Critical/High. Issues that need an admin account or an unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `app/routes/tickets.$id.tsx:18` (`loader`)
- **Evidence:** the exact code/config, and how attacker input reaches it
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, installed versions (React 18 vs 19, router version), hosting assumptions
- **Fix:** smallest React-native change (code snippet)
- **Verify:** test or request that proves the fix
- **Refs:** CWE / OWASP / official docs or advisory link
```

**Rules:** never invent files, routes, packages, versions or config values. Redact secrets (`API_TOKEN=****`). Say explicitly when runtime verification was not performed. Only test applications the user is authorized to assess, and use non-destructive checks.

## References

- React: https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html
- React security advisories: https://github.com/facebook/react/security/advisories
- React Router security guide and advisories: https://reactrouter.com/how-to/security, https://github.com/remix-run/react-router/security/advisories
- Vite env variables and security: https://vite.dev/guide/env-and-mode
- TanStack Start server functions and middleware: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions
- OAuth 2.0 for Browser-Based Applications (RFC 10017) and OAuth Security BCP (RFC 9700): https://www.rfc-editor.org/rfc/rfc10017, https://www.rfc-editor.org/rfc/rfc9700
- OWASP XSS Prevention and HTML5 Security Cheat Sheets: https://cheatsheetseries.owasp.org/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
