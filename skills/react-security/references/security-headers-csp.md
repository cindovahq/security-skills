# React — Security Headers, CSP and Hosting

## Contents
- Who sets headers
- Content Security Policy for React apps
- Nonces: SSR and static hosting
- Trusted Types
- Other headers
- Caching of the SPA shell and API responses
- Severity, false positives, verification

## Who sets headers

React sets none. The place depends on the deployment:

| Deployment | Where headers live |
|---|---|
| Vite/CRA static build | CDN or host config (`_headers`, `vercel.json`, `netlify.toml`, CloudFront response-headers policy, nginx/Caddy). Not `<meta>` for everything: CSP delivered via `<meta http-equiv>` ignores `report-uri`, `frame-ancestors` and `sandbox`, and `Content-Security-Policy-Report-Only` can't be used in `<meta>` (CSP3, section 3.3) |
| React Router framework mode | `entry.server.tsx` (`responseHeaders.set(...)`), route `headers()` exports, adapter/host |
| TanStack Start | Request middleware or server config |
| Express/other server serving the build | That server (`nodejs-security`, e.g. `helmet`) |

Check the deployed responses (`curl -I`), not just the repo: hosts often add headers the code doesn't show, and the reverse is common.

## Content Security Policy for React apps

CSP is defense in depth: **missing CSP is Hardening, never the primary finding**. A useful policy for a SPA:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'self'
```

Investigate:

- `script-src` containing `'unsafe-inline'` (without a nonce/hash), `'unsafe-eval'`, `*`, `https:`, `data:`, or whole CDNs that host user-controlled JavaScript. MDN: with a nonce or hash present, `'unsafe-inline'` is ignored by CSP2+ browsers, and `'strict-dynamic'` propagates trust to scripts loaded by a trusted script.
- `unsafe-eval` is required only by code using `eval`/`new Function`/string timers (MDN); find and remove the cause (`dynamic-code.md`). Test your production build: dev builds and some libraries behave differently.
- On the client React applies `style={{...}}` through CSSOM, which `style-src` does not block. Server-rendered `style="..."` attributes, injected `<style>` elements and CSS-in-JS runtimes that insert style tags are subject to `style-src`, so they need nonces, hashes or `'unsafe-inline'` for styles (a Hardening trade-off; scripts matter more).
- `connect-src`, `form-action`, `frame-src` and `img-src` limit exfiltration. `report-to` collects violations.
- Start with `Content-Security-Policy-Report-Only` as a header and review violations before enforcing.

## Nonces: SSR and static hosting

- **Static hosting:** a nonce must be unique per request. Vite `html.cspNonce` adds `nonce` to script/style/link tags and a `<meta property="csp-nonce" nonce="PLACEHOLDER" />`; Vite's docs: replace the placeholder "with a unique value for each request", so you need an edge function or server to rewrite the HTML. A fixed placeholder shipped as the nonce is a finding. Without a rewriter, prefer hashes for the few inline scripts and `script-src 'self'` for the rest. Vite builds normally emit external module scripts, so inline-free policies are often achievable (verify with Report-Only).
- **React Router framework mode:** docs: pass `nonce` to `<ServerRouter nonce>` (flows to `<Scripts>` and `<ScrollRestoration>`) and to the `nonce` option of `renderToPipeableStream`/`renderToReadableStream`, and use the same value in the `Content-Security-Policy` header, with a fresh nonce per request. v7.18.0 made nonce-aware SSR components inherit `ServerRouter`'s nonce.
- **React 19:** `<script>` accepts `nonce`, `integrity` and `crossOrigin` (react.dev); React 19.3 adds `nonce` to rendered import maps (changelog).
- Nonces reflected from request headers or reused across responses behind a cache defeat CSP.

## Trusted Types

React passes `TrustedHTML` in `dangerouslySetInnerHTML` through unchanged, and 19.3.0 also stops stringifying `TrustedScriptURL` and attribute values (changelog; react.dev). Test enforcement against your build before relying on it. With `Content-Security-Policy: require-trusted-types-for 'script'; trusted-types <policy>` the browser then rejects raw string assignment to injection sinks, which catches stray `innerHTML` assignments. Sanitizer policy: `sanitization-markdown.md`. Rate absence as Informational; rate a policy that returns its input unchanged as a finding.

## Other headers

| Header | Notes |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` once HTTPS is solid |
| `X-Content-Type-Options: nosniff` | Prevents MIME sniffing of uploads and JSON |
| `Referrer-Policy: strict-origin-when-cross-origin` (or stricter) | Tokens in URLs leak via Referer otherwise |
| `Permissions-Policy` | Disable unused camera/microphone/geolocation |
| `frame-ancestors` / `X-Frame-Options` | Clickjacking; sensitive-action pages Medium if missing |
| `Cross-Origin-Opener-Policy` | `same-origin` isolates popups from `window.opener`; breaks some OAuth popup flows: test |
| `X-Powered-By` removal | Informational |

## Caching of the SPA shell and API responses

- Serve `index.html` with `Cache-Control: no-cache` and fingerprinted assets with long `max-age`, so security fixes reach users.
- Authenticated API/HTML responses: `Cache-Control: private, no-store` (TanStack docs recommend this for routes rendering session data). SSR responses that vary by cookie must not be cached publicly (Medium/High: cross-user leak).

## Severity, false positives, verification

- Missing/weak CSP, missing HSTS/nosniff/Referrer-Policy: Hardening/Low. `unsafe-inline`/`unsafe-eval` in a policy that otherwise exists: Hardening (raise to Low/Medium only if an XSS sink is confirmed, because CSP would have mitigated it). Publicly cached personalized SSR: High.
- **Not findings:** no CSP on a static docs/marketing SPA with no sinks (Informational); `'unsafe-inline'` for **styles** only; `<meta>` CSP being used in addition to a header; missing headers on `localhost` dev servers.
- **Verify:** `curl -sI https://app.example.com/ | grep -i -E "content-security|strict-transport|x-content-type|frame|referrer|cache-control"`; load the app with the policy in Report-Only and check the browser console/report endpoint; confirm the nonce differs between two requests.

References: OWASP Content Security Policy, HTTP Security Response Headers Cheat Sheets; CWE-693, CWE-1021; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src, https://www.w3.org/TR/CSP3/, https://vite.dev/guide/features#content-security-policy-csp, https://reactrouter.com/how-to/security, https://react.dev/reference/react-dom/components/script.
