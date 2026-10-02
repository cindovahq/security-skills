# TanStack, Remix, Gatsby, CRA and Other React Setups

## Contents
- TanStack Router and Start
- Remix v2 and Remix 3
- Gatsby
- Create React App and other bundlers
- React inside other backends
- Out of scope

## TanStack Router and Start

Recognize: `@tanstack/react-router` (client router, optionally file-based via the Vite plugin), `@tanstack/react-start` (full stack: SSR, `createServerFn`, server routes, middleware).

Review points:

- **Guards:** `beforeLoad` + `throw redirect(...)` is UX. Docs: "A route guard is not a data authorization boundary", so server functions and endpoints must authorize (`authorization.md`).
- **Post-login redirects:** the docs example puts `redirect: location.href` in the search string and later navigates to `search.redirect`. Validate that value as a same-origin path before navigating (`ssrf-redirects.md`).
- **Search params as input:** `validateSearch` schemas should constrain types and values; unvalidated search params flowing into `dangerouslySetInnerHTML`, `window.location`, or deep-merge are sinks.
- **Server functions (`createServerFn`):** same-origin RPC endpoints. Docs: apply auth middleware or in-handler checks to every function that reads or writes private data; validate input with the validator (`inputValidator`); request middleware runs on all requests, function middleware only on server functions. Treat each as a public API.
- **CSRF:** docs say that, without a `src/start.ts`, Start installs `createCsrfMiddleware()` automatically for server functions (checks `Sec-Fetch-Site`, `Origin` or `Referer`); a custom start config must add it explicitly. Server routes (plain handlers) are your responsibility.
- **Environment:** `process.env` inside handlers, read per request; `VITE_*` for client code; module-scope reads risk inlining (docs).
- **Sessions:** `useSession` with `password` (32+ characters), `httpOnly: true`, `secure` in production, `sameSite: 'lax'` (docs). A weak or committed `password` is a finding.
- **Advisories (versions in `dependencies.md`):** CVE-2026-102989 reflected XSS in server-function responses (critical, 2026-09-30); GHSA-9m65-766c-r333 (a `seroval` type confusion invoking a sibling server function; fixed `start-server-core` 1.167.30); and the 2026-05-11 npm supply-chain compromise of 42 `@tanstack/*` packages (CVE-2026-45321, GHSA-g7cv-rxg3-hmpx).

## Remix v2 and Remix 3

- Remix v2 (`@remix-run/react`, `@remix-run/node`, `@remix-run/server-runtime`, `@remix-run/express`) has the same loader/action model as React Router framework mode and was folded into React Router 7. Review as in `react-router.md` and `authorization.md`. Fix lines on npm: `@remix-run/server-runtime` 2.17.5 (CSRF and DoS fixes), `@remix-run/react` 2.17.3+ (ScrollRestoration XSS), `@remix-run/node` 2.17.2+ (file session storage). Plan migration to React Router 7/8.
- Remix 3 (`remix` on npm, 3.0.0; beta from 2026-04-30) is a new framework with its own component model and **does not use React** (project announcement, npm dependencies `@remix-run/component`). Out of scope for this skill.

## Gatsby

Recognize `gatsby` in `package.json`, `gatsby-config.*`, `gatsby-node.*`. Gatsby 5.16.1 is the latest release (modified 2026-06-30); activity is low, so check the installed plugins' advisories.

- `GATSBY_*` variables are inlined into client JavaScript; others stay in Node (Gatsby docs).
- Build-time data: anything queried via GraphQL/static queries becomes public JSON (`page-data.json`, `/page-data/**`). Source plugins authenticate with tokens in `gatsby-config` at build time (server-side, fine) but fields you query are published.
- CMS HTML/Markdown rendered with `dangerouslySetInnerHTML` or `gatsby-transformer-remark` raw HTML: sinks, rated by who can edit content (`sanitization-markdown.md`).
- Gatsby Functions (serverless API routes in `src/api`) are public endpoints: authorization, CORS, and input validation apply (`nodejs-security` for the handler logic).
- Pure static output: no CSRF/SSR surface; focus on bundle contents, third-party scripts and headers set at the CDN.

## Create React App and other bundlers

- Create React App is deprecated for new apps (react.dev blog, 2025-02-14), in maintenance mode, and `react-scripts` 5.0.1 was published 2022-04-12. Running an unmaintained build chain is a **Low/Medium hardening** finding: webpack, `webpack-dev-server` and Babel stay at 2022 versions. `npm audit` noise from `react-scripts` is mostly build-time tooling (see `dependencies.md`). Recommend Vite or a framework (React Router, Next.js).
- `REACT_APP_*` variables are embedded in the build; production source maps are generated unless `GENERATE_SOURCEMAP=false` (`secrets-config.md`). `homepage`, `proxy` (dev only) and `public/` files are public.
- Webpack/Parcel/Rsbuild: `DefinePlugin`/`EnvironmentPlugin`/`PUBLIC_` prefix rules play the role of Vite's `define`/`VITE_`; apply the same bundle-leak checks.

## React inside other backends

- **Inertia.js** (Laravel/Rails/Django adapters) serializes controller props into the page object sent to React (initial HTML and JSON responses). Returning whole models is the same data-exposure bug as returning ORM rows from a loader. Review the backend with its own skill (`laravel-security`) and check the props.
- Server-rendered templates that mount React (`<div id="root" data-props="...">`): the JSON in the attribute must be escaped by the template engine; `{!! json_encode($x) !!}` / `|safe` into inline scripts is the sink (`ssr-hydration.md`).
- Micro-frontends and module federation: remote modules run with full page privileges; pin and review remote origins.
- Embedded widgets/SDKs (chat, payments, analytics) are third-party scripts (`browser-apis.md`).

## Out of scope

- Next.js (App Router, Pages Router, Server Actions, RSC): use `nextjs-security`.
- React Native / Expo: a different threat model (device storage, deep links, WebViews, bundle contents in app stores). This skill does not cover it; only shared JavaScript logic is relevant.
- Electron/Tauri shells around a React UI: `nodeIntegration`, preload scripts and IPC need a dedicated review.
- Express/Fastify/NestJS backends: `nodejs-security`. Supabase RLS: `supabase-security`.

References: https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes, https://tanstack.com/start/latest/docs/framework/react/guide/server-functions, https://tanstack.com/start/latest/docs/framework/react/guide/middleware, https://react.dev/blog/2025/02/14/sunsetting-create-react-app, https://www.gatsbyjs.com/docs/how-to/local-development/environment-variables/, https://remix.run/blog/wake-up-remix.
