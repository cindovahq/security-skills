# React — Server Rendering, Hydration State and Inline Scripts

Applies to React Router framework mode, TanStack Start, Remix v2, Gatsby builds and custom `renderToString` / `renderToPipeableStream` servers (for Express or Fastify code itself, see the `nodejs-security` skill). Next.js is covered by `nextjs-security`.

## Contents
- What the frameworks escape for you
- Inline script and JSON state
- Framework advisories that were SSR XSS
- Nonces and streaming
- What loaders and server functions serialize
- Severity, false positives, verification

## What the frameworks escape for you

- React Router (verified in 7.18.4 source): the hydration payload is written to `window.__reactRouterContext` and passed through `escapeHtml`, which encodes `<`, `>`, `&`, U+2028 and U+2029. Data returned from loaders is therefore not an injection path by itself. The same escaping does **not** apply to scripts you add yourself.
- React 19 `react-dom/server` escapes `<script` and `</script` inside **string children** of a `<script>` element (rewritten to `s` forms; verified in 19.3.0). It does not touch `dangerouslySetInnerHTML`, so that is the pattern to look for. React 18 HTML-escapes text children (valid JSON turns into `&quot;` entities: broken, not exploitable) and also leaves `dangerouslySetInnerHTML` raw.
- `bootstrapScriptContent` and import maps passed to the React server APIs are escaped by React the same way.

## Inline script and JSON state

```tsx
// investigate (root.tsx, entry.server.tsx, document templates, Express HTML strings)
<script dangerouslySetInnerHTML={{ __html: `window.__APP__ = ${JSON.stringify({ user, flags })}` }} />
res.send(`<script>window.__STATE__ = ${JSON.stringify(state)}</script>`)       // custom SSR server
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
```

`JSON.stringify` does not escape `<`, so a value containing `</script>` ends the element and the rest is parsed as HTML. Trace each field in the object to its source (display names, titles, search terms, CMS fields). Fix:

```ts
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
```

Better: do not inline state; return it from the loader, or emit `<script type="application/json" id="app-data">` with the escaped string and read it with `JSON.parse(el.textContent)`. `serialize-javascript` is acceptable and has its own advisory history (CVE-2020-7660 RCE, fixed in 7.0.3; CVE-2026-97711 `</script>` in serialized function bodies, fixed 7.1.2): keep it current and avoid serializing functions.

A `type="application/ld+json"` block is still a script element in the HTML parser: it needs the same escaping.

## Framework advisories that were SSR XSS

| Advisory | Issue | Affected | Fixed |
|---|---|---|---|
| CVE-2025-59057 | `meta()`/`<Meta>` emitting `script:ld+json` with untrusted content (React Router framework mode) | react-router 7.0.0 to 7.8.2 | 7.9.0 |
| CVE-2026-21884 | `<ScrollRestoration getKey/storageKey>` with untrusted values during SSR | react-router 7.0.0 to 7.11.0 | 7.12.0 |
| CVE-2026-33244 | Unescaped `Location` in prerendered redirect HTML (framework mode with pre-rendering) | react-router 7.5.1 to <7.13.2 | 7.13.2 |
| CVE-2026-22029 | Open redirects from loaders/actions resulting in `javascript:` execution on the client | react-router 7.0.0 to 7.11.0 | 7.12.0 |
| CVE-2026-102989 | Unauthenticated reflected XSS in TanStack Start server-function responses | `@tanstack/react-start` 1.143.12 to <1.168.60 (`start-server-core` <1.169.39) | 1.168.60 / 1.169.39 |

CVE-2025-59057, CVE-2026-21884 and CVE-2026-33244 do not affect Data or Declarative mode. CVE-2026-22029 is not SSR-specific: it affects Framework and Data mode (not Declarative) when redirect targets come from untrusted input.

## Nonces and streaming

Strict CSP with SSR needs a fresh nonce per response: pass it to `<ServerRouter nonce>` and to the `nonce` option of `renderToPipeableStream`/`renderToReadableStream` in React Router's `entry.server.tsx` (React Router docs, "Security"); React 19.3 adds `nonce` to rendered import maps. A static or reused nonce, or one derived from request headers, defeats CSP (finding: Medium/Hardening). See `security-headers-csp.md`.

## What loaders and server functions serialize

Everything returned from a `loader`, `useLoaderData`-feeding function or TanStack `createServerFn` is sent to the browser: embedded in the HTML on first load and fetched as `.data` responses on navigation. Returning an ORM row (password hash, reset token, API key, other users' PII) is a data-exposure finding even if the component never renders those fields. See `authorization.md` and `secrets-config.md`.

## Severity, false positives, verification

- Reflected or stored value breaking out of an inline script: **High** (same as XSS). Reachable only by the user's own data: Medium/Low.
- **Not findings:** React Router's own hydration script and `<Scripts />`; React 19 `<script>{string}</script>` children built from constants or escaped `JSON.stringify` output (the `</script` escaping doesn't stop injection into the JavaScript itself); inline JSON built from constants; `escapeHtml`'d output.
- **Verify:** set a field that feeds the script to a harmless marker such as `</script><b id="m">x</b>`, load the page, and assert `document.getElementById('m')` is null (it must stay inside the script). Add a unit test for `safeJson`. For loaders, `curl` the page and the `.data` URL as another user and search for sentinel fields.

References: OWASP XSS Prevention Cheat Sheet (JavaScript context); CWE-79, CWE-116; https://reactrouter.com/how-to/security, https://github.com/remix-run/react-router/security/advisories, https://github.com/TanStack/router/security/advisories.
