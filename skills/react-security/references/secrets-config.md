# React — Secrets, Build Config and Client-Side Data

## Contents
- Variables that end up in the bundle
- Build config that leaks
- Source maps
- Keys that are public by design
- Server-only code in router frameworks
- State, storage and debugging leftovers
- Dev server and hosting
- Severity, false positives, verification

## Variables that end up in the bundle

A browser bundle is public. Anything the client code references is readable by every visitor.

| Tooling | Exposed to client code | Notes (official docs) |
|---|---|---|
| Vite (6, 7, 8) | `import.meta.env.VITE_*` (`envPrefix`, default `VITE_`) | "`VITE_*` variables should not contain sensitive information such as API keys. The values of these variables are bundled into your source code at build time." Add `*.local` to `.gitignore` |
| Create React App | `process.env.REACT_APP_*` | "Do not store any secrets (such as private API keys) in your React app! Environment variables are embedded into the build" |
| Gatsby | `process.env.GATSBY_*` | Non-prefixed variables are Node-only; set when the JavaScript is compiled |
| TanStack Start | `import.meta.env.VITE_*` (Vite) | Server functions read `process.env` inside handlers; docs warn that reading at module scope "risks inlining secrets into the client bundle" |
| React Router framework mode | `import.meta.env.VITE_*` in client code | `process.env` is fine in `loader`, `action` and `.server` modules only |

Investigate:

```bash
grep -rnE "(VITE|REACT_APP|GATSBY)_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|ADMIN|TOKEN|PASSWORD|KEY)" --include=*.{ts,tsx,js,jsx,mjs,env*} --include=.env* --include=Dockerfile* --include=*.yml .
grep -rnE "process\.env|import\.meta\.env" src app | grep -v "NODE_ENV\|VITE_PUBLIC\|import.meta.env.\(DEV\|PROD\|MODE\|BASE_URL\)"
```

A secret under a public prefix is a finding when client code references it (confirm by tracing imports or grepping the built `dist/`). Treat it as exposed regardless and rotate it. Also look for `window.__ENV__`/`/env.js` runtime-config files that include secrets, and CI logs printing build environments.

## Build config that leaks

```ts
// vite.config.ts: each of these is a finding when real secrets are in the environment
define: { 'process.env': process.env }                         // inlines every variable
define: { 'import.meta.env.API_SECRET': JSON.stringify(env.API_SECRET) }   // explicit leak
const env = loadEnv(mode, process.cwd(), '')                   // '' prefix loads ALL variables: fine for config, a leak once it reaches define
envPrefix: ['VITE_', 'SECRET_']                                // secrets named with a public prefix
```

Vite docs: `envPrefix` "should not be set as `''`" (Vite throws on an empty string) and unprefixed values must go through `define` deliberately. Webpack equivalents: `DefinePlugin({ 'process.env': JSON.stringify(process.env) })`, `EnvironmentPlugin()` with secrets. Dockerfiles that `COPY .env*` or pass secrets as build `ARG` and then build the client bake them into the image layers and the bundle.

## Source maps

- Vite `build.sourcemap` defaults to `false`. Values `true`, `'inline'` and `'hidden'` all produce maps (`'hidden'` only drops the `//# sourceMappingURL` comment, so the files are still served if deployed).
- Create React App generates production source maps unless `GENERATE_SOURCEMAP=false` (verified in `react-scripts` 5.0.1 `webpack.config.js`: `GENERATE_SOURCEMAP !== 'false'`).
- Public `.map` files give attackers the original source, comments, internal endpoints and logic. **Low/Hardening** alone; raise to the severity of any secret or sensitive logic found inside. Fix: upload maps to the error tracker in CI and delete them from the deployed output.

## Keys that are public by design

Not findings when restricted correctly: Supabase anon/publishable keys (RLS is the control, see `supabase-security`), Firebase web config, Stripe publishable keys (`pk_`), Sentry DSNs, analytics and tag IDs, Mapbox public tokens, Algolia search-only keys, OAuth/OIDC client IDs and issuer URLs of **public** clients, Google Maps browser keys (with HTTP-referrer restrictions). Findings: Stripe `sk_`/restricted secret keys, Supabase service-role/secret keys, Firebase Admin credentials, OAuth client **secrets**, AWS keys, database URLs, signing/webhook secrets, internal admin API tokens, LLM provider keys (billing abuse).

## Server-only code in router frameworks

- React Router framework mode: per the docs, `loader` and `action` are removed from client bundles, `.server` modules and `.server/` directories are excluded and the build fails if client code imports one. `clientLoader`, `clientAction`, components and any non-`.server` module they import **are** bundled. A secret read in a shared `lib/api.ts` imported by a component is a bundle leak even when a loader also imports it.
- TanStack Start: put secrets inside `createServerFn().handler(...)` or server-only modules; module-scope reads of `process.env` can end up in client output.
- Gatsby: values fetched at build time (GraphQL/static queries, `page-data.json`) are public; do not query fields you would not publish.

## State, storage and debugging leftovers

- Redux/Zustand `persist`, `redux-persist`, React Query `persistQueryClient`, `localStorage.setItem('user', JSON.stringify(user))` writing tokens, PII or full API objects to browser storage. Clear on logout.
- Production DevTools or globals: `window.store = store`, Redux `devTools: true`, `window.__REACT_QUERY_DEVTOOLS__`, `<ReactQueryDevtools/>` rendered outside `import.meta.env.DEV`. Dev-only code behind `import.meta.env.DEV` is statically replaced and removed from production builds (Vite docs), so it is not a finding.
- `console.log` of tokens or user objects; error boundaries rendering `error.stack` or API error bodies; Sentry/analytics with request bodies, `Authorization` headers or form values.
- APIs returning full objects that the UI trims: the data is in the network tab. That is a backend finding (`authorization.md`).
- Service workers (`vite-plugin-pwa`, Workbox) caching authenticated API responses, then serving them to the next user of the device.

## Dev server and hosting

- `vite preview`: "Do not use this as a production server as it's not designed for it" (Vite CLI docs). `vite dev` or `react-scripts start` deployed on a public host exposes dev endpoints and source: High.
- `server.host: true` / `--host` exposes the dev server to the network; `server.allowedHosts: true` lets any website reach it (Vite docs: "allows any website to send requests to your dev server and download your source code and content"). Dev-only: Hardening unless reachable from untrusted networks. See `dependencies.md` for the Vite dev-server file-read advisories.
- Committed `.env`, `.env.production` or `.env.local` with real values; `.env.example` with placeholders is fine.

## Severity, false positives, verification

- Privileged credential in a shipped bundle (service-role key, secret API key, signing secret, admin token): **Critical** if it grants broad data or admin access; High for narrower internal tokens. Source maps alone: Low. Public-by-design keys: not a finding.
- **Not findings:** `VITE_API_URL`, publishable keys, analytics IDs; `process.env.NODE_ENV`; secrets used only in `loader`/`action`/`.server` files; `.env.example`; `import.meta.env.DEV` blocks.
- **Verify:** `npm run build`, then `grep -rIl "<first 8 chars of the secret>" dist build .react-router/ 2>/dev/null` must return nothing; `find dist -name '*.map'` should return nothing on the deployed artifact. Rotate any leaked secret: removing it from code does not revoke copies already served.

References: OWASP A02:2025 Security Misconfiguration; CWE-200, CWE-312, CWE-540, CWE-798; https://vite.dev/guide/env-and-mode, https://vite.dev/config/shared-options#envprefix, https://vite.dev/config/build-options#build-sourcemap, https://create-react-app.dev/docs/adding-custom-environment-variables/, https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables, https://reactrouter.com/api/framework-conventions/server-modules.
