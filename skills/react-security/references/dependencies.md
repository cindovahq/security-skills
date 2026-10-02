# React — Dependencies, Versions and Advisories

## Contents
- Reading installed versions
- Support status (checked 2026-10-02)
- React and React Server Components packages
- React Router and Remix
- Vite
- TanStack
- Sanitizers, Markdown and utility libraries
- Supply chain
- Audit noise and commands
- Severity, false positives, verification

## Reading installed versions

- Lock files, not ranges: `package-lock.json` (`node_modules/react-router`), `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`. Run `npm ls react react-dom react-router vite dompurify`.
- React throws if `react` and `react-dom` versions differ (19.0.0 changelog). Duplicate copies of `react` in a monorepo cause hook errors, not just security drift.
- `react-server-dom-*` packages exist only in RSC setups (Next.js, React Router unstable RSC, Waku, Parcel). A plain SPA or React Router framework mode (non-RSC) app does not install them.

## Support status (checked 2026-10-02)

| Component | Latest | Notes |
|---|---|---|
| `react`/`react-dom` | 19.3.0 (2026-09-09) | 18.3.1 (2024-04-26) is the last 18.x release. React has no published EOL table; fixes for RSC advisories were backported to 19.0.x, 19.1.x, 19.2.x (npm `backport` tag 19.0.8) |
| `react-router` | 8.4.0; 7.x latest 7.18.4 | v8 (2026-06-17): React 19.2.7+, Vite 7+, Node 22.22+, ESM-only, no `react-router-dom`. v6 and `@remix-run/*` 2.x are old lines with partial fixes |
| `vite` | 8.3.2 | Per vite.dev/releases: regular patches 8.3; important fixes and security patches 7.3 and 8.2; security patches only 6.4 and 8.1. Anything older is unsupported |
| `@tanstack/react-start` | 1.168.60 | Security fixes published 2026-09-30 (below) |
| `react-scripts` (CRA) | 5.0.1 (2022-04-12) | Deprecated for new apps (react.dev, 2025-02-14), maintenance mode |
| `gatsby` | 5.16.1 | Low activity; check plugins |
| `dompurify` | 3.4.16 | Frequent advisories |
| `lodash` | 4.18.1 | 2026 security fixes in 4.17.23 and 4.18.0 |

An unsupported or severely outdated core library is a **Medium** finding by itself, raised to the worst applicable reachable advisory.

## React and React Server Components packages

| Advisory | Issue | Affected packages and versions | Fixed |
|---|---|---|---|
| CVE-2025-55182 "React2Shell" (GHSA-fv66-9v8q-g76r) | **Critical** unauthenticated RCE in RSC Flight | `react-server-dom-webpack`/`-turbopack`/`-parcel` 19.0.0, 19.1.0, 19.1.1, 19.2.0 | 19.0.1, 19.1.2, 19.2.1 |
| CVE-2025-55183 | Server Function source exposure | same packages 19.0.0 to 19.2.1 | 19.0.2, 19.1.3, 19.2.2 |
| CVE-2025-55184, CVE-2025-67779 | DoS | up to 19.2.2 | 19.0.3, 19.1.4, 19.2.3 |
| CVE-2026-23864, -23869, -23870, CVE-2026-44907 | Further DoS (fixed progressively from 19.0.4/19.1.5/19.2.4) | up to 19.2.7 | combined fix floor 19.0.8, 19.1.9, 19.2.8 |

These affect the `react-server-dom-*` packages (and frameworks bundling them, such as Next.js, see `nextjs-security`), **not** `react` or `react-dom` in a client or SSR-only app. Reporting React2Shell against a Vite SPA is a false positive. The `react`/`react-dom` 19.x core has no published security advisory on facebook/react as of this check.

## React Router and Remix

Fix floor: **react-router 7.18.2 or 8.3.0**. Advisories from github.com/remix-run/react-router (only the more relevant ones):

| Advisory | Issue | Affected | Fixed |
|---|---|---|---|
| CVE-2026-22030 | CSRF on document POST to UI routes (Framework mode) | 7.0.0 to <7.12.0 | 7.12.0 (`@remix-run/server-runtime` 2.17.3) |
| CVE-2026-53663 | CSRF check bypassed for PUT/PATCH/DELETE (Low) | 7.12.0 to <7.15.1 | 7.15.1 |
| GHSA-qwww-vcr4-c8h2 | RSC-mode CSRF gap | 7.12.0 to <7.18.2; 8.0.0 to <8.3.0 | 7.18.2, 8.3.0 |
| CVE-2025-68470 | Untrusted path passed to `navigate`/`<Link>`/`redirect()` causes external navigation | 6.0.0 to 6.30.1; 7.0.0 to 7.9.5 | 6.30.2, 7.9.6 |
| CVE-2026-53669 | Bypass of the CVE-2025-68470 fix | 6.0.0 to <7.18.0 | 7.18.0 |
| CVE-2026-22029 | Open redirects could execute `javascript:` (Framework/Data mode) | 7.0.0 to 7.11.0 | 7.12.0 |
| CVE-2026-40181 | `redirect` path starting `//` | 7.0.0 to <7.14.1; 6.7.0 to <6.30.4 | 7.14.1, 6.30.4 |
| CVE-2026-53668 | Open redirect leading to XSS | react-router 7.9.6 to 7.12.0; react-router-dom 6.30.2 to 6.30.4 | 7.13.0; 6.30.6 |
| CVE-2026-21884 | `ScrollRestoration` SSR XSS | 7.0.0 to 7.11.0 | 7.12.0 |
| CVE-2025-59057 | `meta` `script:ld+json` XSS | 7.0.0 to 7.8.2 | 7.9.0 |
| CVE-2026-33244 | Stored XSS via `Location` in prerendered redirects | 7.5.1 to <7.13.2 | 7.13.2 |
| CVE-2026-53666 | Constructor injection through SSR hydration errors (very specific app code) | 6.4.0 to <7.18.0 | 7.18.0 |
| CVE-2026-42211 | RCE chained from an existing prototype pollution | 7.0.0 to 7.14.1 | 7.14.2 |
| CVE-2026-55685, CVE-2026-42342, CVE-2026-34077 | DoS (`__manifest`, single-fetch input) | 7.0.0 to <7.18.0, <7.15.0, <7.14.0 | 7.18.0, 7.15.0, 7.14.0 |
| CVE-2025-61686 | `createFileSessionStorage()` with unsigned cookies reads outside the session dir (Critical) | `@react-router/node` 7.0.0 to 7.9.3 | 7.9.4 |
| CVE-2025-43864, CVE-2025-43865 | Cache poisoning DoS / pre-render data spoofing via request headers | 7.2.0 to 7.5.1 (43864); 7.0.0 to 7.5.1 (43865) | 7.5.2 |
| CVE-2025-31137 | `Host`/`X-Forwarded-Host` URL spoofing in `@react-router/express` | 7.0.0 to 7.4.0 | 7.4.1 |

Unstable RSC mode has additional redirect-XSS and CSRF advisories (CVE-2026-33245, CVE-2026-53667). Remix v2 equivalents were fixed in `@remix-run/server-runtime`/`react`/`node` 2.17.x (latest `@remix-run/react` 2.17.5).

## Vite

Vite advisories concern the **dev server** (and preview): file-read and `server.fs.deny` bypasses, WebSocket arbitrary file read. A deployed static build does not run the dev server. Rate as Medium/Low unless `vite dev`/`vite preview` is internet-reachable (then High).

| Advisory | Affected | Fixed |
|---|---|---|
| CVE-2026-53571 `server.fs.deny` bypass on Windows alternate paths (High) | <=6.4.2; 7.0.0 to 7.3.4; 8.0.0 to 8.0.15 | 6.4.3, 7.3.5, 8.0.16 |
| CVE-2026-39363 arbitrary file read over the dev-server WebSocket (High); CVE-2026-39364 `fs.deny` bypass with queries (High; 7.1.0 and later only); CVE-2026-39365 `.map` path traversal | 6.0.0 to 6.4.1; 7.0.0 to 7.3.1; 8.0.0 to 8.0.4 | 6.4.2, 7.3.2, 8.0.5 |
| CVE-2025-24010 any website could send requests to the dev server and read the response | 6.0.0 to 6.0.8; 5.x to 5.4.11 | 6.0.9, 5.4.12 (`server.allowedHosts` and CORS restrictions) |
| CVE-2025-62522, CVE-2025-58751/58752, CVE-2025-46565 and earlier `fs.deny` bypasses | various 5.x to 7.1.x | see advisory pages |

Minimum: Vite 6.4.3, 7.3.5 or 8.0.16 (current 8.3.2). Vite 8 replaced esbuild/Rollup with Rolldown and Oxc (migration guide); `build.minify` default is `'oxc'`, `build.rollupOptions` became `rolldownOptions`.

## TanStack

| Advisory | Issue | Affected | Fixed |
|---|---|---|---|
| CVE-2026-102989 (GHSA-qx66-fv34-fjm8) | **Critical** reflected XSS in Start server-function responses | `@tanstack/start-server-core`, `react-start`, `solid-start`, `vue-start` from 1.143.12 | `start-server-core` 1.169.39, `react-start` 1.168.60, `solid-start` 1.168.57, `vue-start` 1.168.56 |
| GHSA-9m65-766c-r333 | Server-function deserialization could invoke a sibling client-referenced server function (via `seroval`) | below the 2026-05 fix | `start-server-core` >=1.167.30, `seroval` >=1.5.3 |
| CVE-2026-45321 (GHSA-g7cv-rxg3-hmpx) | **Supply-chain malware**: 84 malicious versions of 42 `@tanstack/*` packages published 2026-05-11 | Specific versions listed in the advisory; payload ran at install time and stole cloud, GitHub, npm and SSH credentials | Newer versions of each package; rotate any credentials on machines or CI that installed an affected version |

## Sanitizers, Markdown and utility libraries

- **DOMPurify** (latest 3.4.16): see `sanitization-markdown.md`; notable: CVE-2026-47423 (High; exactly 3.4.4), CVE-2026-41238 (prototype-pollution bypass; 3.0.1 to 3.3.3), CVE-2026-41239/41240 and predicate bypasses (<3.4.0), many `IN_PLACE`/`RETURN_DOM` items (<=3.4.15). `isomorphic-dompurify` 4.4.0 requires `dompurify` ^3.4.12; keep the resolved `dompurify` current.
- **marked**: no built-in sanitization. CVE-2026-41680 (OOM DoS in 18.0.0 and 18.0.1, fixed 18.0.2).
- **react-markdown** 10.1.0 and unified/remark/rehype plugins: no advisories listed on `react-markdown`; keep `rehype-sanitize` schemas reviewed.
- **lodash** 4.18.1 (see `dynamic-code.md`). **serialize-javascript** 7.1.2 (CVE-2026-97711 fixed in 7.1.2).

## Supply chain

- Commit the lock file and install with `npm ci` / `pnpm install --frozen-lockfile` in CI. Review lock-file diffs for new transitive packages.
- Install scripts (`preinstall`/`postinstall`) execute on developer machines and CI. The TanStack incident ran its payload at install time and was published through a legitimate trusted-publisher pipeline with valid provenance, so provenance alone is not proof of safety. Consider `--ignore-scripts` in CI where builds allow it, and keep deploy credentials out of the install environment.
- Pin GitHub Actions to commit SHAs and avoid `pull_request_target` with untrusted code (the TanStack compromise chained a Pwn Request, Actions cache poisoning and OIDC token extraction).
- Typosquats and look-alike packages (`react-dom-x`, `reactjs-...`), and abandoned packages in the lock file: check the maintainers and publish dates for unfamiliar names.
- After a supply-chain advisory: identify exposure window, rotate credentials accessible to affected installs, and rebuild from a clean lock file. More: the `appsec-review` skill.

## Audit noise and commands

```bash
npm audit --omit=dev            # runtime dependencies only
pnpm audit --prod ; yarn npm audit --environment production
npm ls react react-dom react-router vite dompurify marked lodash
npm audit signatures            # registry signatures and provenance attestations
```

`npm audit` on Create React App projects reports dozens of issues in build-time dependencies (webpack, `webpack-dev-server`, `nth-check`, PostCSS, `serialize-javascript` in build plugins). These do not ship to the browser and are usually **Low/Informational**; report the unmaintained toolchain once instead. ReDoS in a build tool or test library is not a production finding. Advisories in code that ends up in the bundle (sanitizers, Markdown, routers, `lodash`) are in scope.

## Severity, false positives, verification

- Reachable critical/high advisory in a runtime dependency (RSC RCE in an RSC setup, sanitizer bypass on a sink that renders untrusted HTML, router CSRF with cookie auth): High/Critical. Dev-tool advisories, DoS in non-exposed tools: Low/Informational.
- **Not findings:** `npm audit` output for dev dependencies; React2Shell against apps without `react-server-dom-*`; Vite dev-server CVEs against a static production build; advisories for Declarative/Data-mode apps that only affect Framework mode.
- **Verify:** record installed versions with `npm ls`; after upgrading, re-run the audit and the app's tests; for router upgrades, test auth redirects, CSRF origin checks behind your proxy (7.18.0 change) and `.data` requests.

References: https://github.com/facebook/react/security/advisories, https://github.com/remix-run/react-router/security/advisories, https://github.com/vitejs/vite/security/advisories, https://github.com/TanStack/router/security/advisories, https://github.com/cure53/DOMPurify/security/advisories, https://vite.dev/releases, https://react.dev/blog/2025/02/14/sunsetting-create-react-app; OWASP A03:2025 Software Supply Chain Failures; CWE-1104, CWE-1357.
