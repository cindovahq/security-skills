# Next.js — Security Headers and CSP

## Contents
- Where headers are set
- Content Security Policy with nonces
- Static CSP and SRI
- Other headers
- Severity notes, false positives, verification

## Where headers are set

Next.js sets almost no security headers by default (it does add `X-Powered-By: Next.js` unless `poweredByHeader: false`). Check, in order of execution:

1. `headers()` in `next.config.*` (runs first; static values per path pattern).
2. `proxy.ts`/`middleware.ts` (`response.headers.set(...)`), required for per-request nonces.
3. Route Handlers / `pages/api` responses.
4. The hosting layer (`vercel.json`, CDN rules, nginx). Ask or check deployment config before reporting "missing"; mark as Likely if you can't see it.

## Content Security Policy with nonces

The official pattern (proxy generates a nonce per request, puts it in the CSP and an `x-nonce` request header; Next.js extracts it from the CSP and applies it to framework scripts, page bundles and `<Script>` components):

```ts
// proxy.ts (middleware.ts before 16)
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: data:; font-src 'self'; object-src 'none';
    base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;`.replace(/\s{2,}/g, ' ').trim()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}
```

Investigate:

- Nonces require **dynamic rendering**; static/ISR pages get no nonce, and Partial Prerendering is incompatible with nonce CSP. A nonce CSP on static pages either breaks them or was "fixed" with `'unsafe-inline'`.
- Static or reused nonces (a constant, `Date.now()`, a value cached with the page) → the nonce provides no protection.
- `'unsafe-eval'` in production (only needed in development per the docs), `'unsafe-inline'` in `script-src` without nonces/hashes, wildcard sources (`https:`, `*`), missing `object-src 'none'`, `base-uri`, `frame-ancestors`.
- CSP set only in a matcher that excludes some HTML routes.
- Inbound `Content-Security-Policy` request headers from clients: on versions before 15.5.16 / 16.2.5 malformed nonces from request headers could be reflected unsafely (CVE-2026-44581). Fixed versions sanitize; the workaround was stripping inbound CSP request headers.

## Static CSP and SRI

Apps without nonces can set CSP in `next.config` `headers()`; the docs' example uses `'unsafe-inline'` for scripts, which gives little XSS protection (Hardening). `experimental.sri` (App Router only, experimental) adds `integrity` hashes so a stricter CSP can work with static pages.

## Other headers

| Header | Recommended | Notes |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (add `preload` deliberately) | Often set by the platform. |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (browser default) or stricter | Stricter if URLs carry tokens. |
| `frame-ancestors` (CSP) / `X-Frame-Options` | `'none'`/`DENY` unless embedding is required | Clickjacking on sensitive actions. |
| `Permissions-Policy` | Disable unused features | Hardening. |
| `Cross-Origin-Opener-Policy` | `same-origin` where compatible | Hardening. |
| `X-Powered-By` | Remove with `poweredByHeader: false` | Informational. |

```js
// next.config.js
module.exports = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }]
  },
}
```

## Severity notes, false positives, verification

- Missing CSP/HSTS/framing headers → **Hardening/Low** on their own. Raise framing to Medium when a sensitive one-click action exists (clickjacking). A weak CSP is relevant context for XSS findings, not a separate High.
- **Not findings:** headers provided by the hosting platform; `'unsafe-eval'` only when `NODE_ENV === 'development'`; prefetch requests excluded from the nonce matcher (as in the docs).
- **Verify:** `curl -s -D - -o /dev/null https://staging.example.com/ | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|x-powered-by'`; load two requests and confirm the nonce differs; check the browser console for CSP violations after changes.

References: OWASP Secure Headers Project, CSP Cheat Sheet; CWE-693, CWE-1021; https://nextjs.org/docs/app/guides/content-security-policy, https://nextjs.org/docs/app/api-reference/config/next-config-js/headers, https://nextjs.org/docs/app/api-reference/config/next-config-js/poweredByHeader.
