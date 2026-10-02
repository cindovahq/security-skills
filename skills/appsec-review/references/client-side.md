# XSS, CSRF, CORS and Client-Side Issues

## Contents
- XSS
- CSRF
- CORS
- Clickjacking
- Open redirects
- Browser messaging and storage
- Content Security Policy
- Verification

## XSS

Most modern template engines and front-end frameworks **auto-escape**. XSS appears where code opts out, or where escaping is wrong for the context.

**Raw-output sinks:**

| Stack | Sinks |
|---|---|
| React | `dangerouslySetInnerHTML`, `href={userUrl}` (`javascript:` URLs; React only warns), refs + `innerHTML` |
| Vue | `v-html`, `:href` with user URLs, render functions with `innerHTML` |
| Angular | `bypassSecurityTrustHtml/Url/Script/ResourceUrl`, `[innerHTML]` (sanitized by default, unless bypassed) |
| Svelte | `{@html ...}` |
| Next.js | Same as React, plus user data in `<Script>` inline content, `next/head` injections, unsanitized Markdown/MDX |
| Server templates | Jinja2 `|safe`, `Markup()`, `autoescape false`; Django `mark_safe`, `|safe`, `{% autoescape off %}`; ERB `raw`, `html_safe`, `<%==`; Thymeleaf `th:utext`; Razor `@Html.Raw`; Handlebars `{{{ }}}`; EJS `<%-`; Pug `!=`; Go `template.HTML(...)` casts, `text/template` for HTML; Blade `{!! !!}` |
| DOM | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, jQuery `.html()`, `$(userString)`, `eval`, `setTimeout(string)`, `location = userInput`, `srcdoc` |

**Context traps** (escaping present but insufficient):
- User URLs in `href`/`src`/`action`: validate the scheme (`http`/`https`). HTML escaping doesn't stop `javascript:`.
- Data inside `<script>` blocks: serialize with a JSON encoder that escapes `<`, `>`, `&`, U+2028/2029 (e.g. `serialize-javascript`, Django `json_script`, Laravel `@json`). Never string-concatenate.
- Event-handler attributes and `style`: avoid user data entirely.
- Markdown renderers allowing raw HTML (`marked` without sanitizing, `markdown-it` with `html: true`, CommonMark `html_input: allow`). Sanitize output with DOMPurify / bleach-successor `nh3` / HTMLPurifier / `sanitize-html` with a strict config.
- SVG and HTML uploads served from the app origin (see `ssrf-files.md`).
- `Content-Type` of API responses that reflect input: must be `application/json`, not `text/html`. Add `X-Content-Type-Options: nosniff`.

**Severity:** stored XSS viewed by other users or admins → High (Critical if it leads to admin takeover); reflected → Medium/High; DOM XSS via URL fragment → Medium/High; self-XSS → Low/Info.

## CSRF

Applies when the browser automatically attaches credentials: cookies, HTTP auth, client certs.

- **Expected:** framework CSRF tokens (Django, Rails, Laravel, Spring Security, ASP.NET antiforgery) **or** a strict origin check (`Origin`/`Sec-Fetch-Site`) **plus** `SameSite=Lax/Strict` cookies, on all state-changing requests.
- **Findings:**
  - State-changing `GET` endpoints (not covered by token checks or SameSite=Lax).
  - CSRF disabled globally (`csrf().disable()` in Spring with cookie sessions, `@csrf_exempt` on sensitive Django views, `skip_forgery_protection`, `protect_from_forgery` missing in Rails APIs that use cookies).
  - JSON APIs using cookie auth that accept `text/plain` or form content types (simple requests bypass preflight).
  - `SameSite=None` cookies without token protection.
  - Next.js Server Actions have built-in origin checks. Custom Route Handlers with cookie auth need their own.
- **Not findings:** APIs authenticated only by `Authorization: Bearer` headers. Webhooks verified by signature.

## CORS

- Reflecting arbitrary `Origin` into `Access-Control-Allow-Origin` **with** `Access-Control-Allow-Credentials: true` → any site can read authenticated responses → **High**.
- Origin validation with substring/regex bugs: `endsWith('example.com')` matches `evilexample.com`; unanchored regex; trusting `null` origin (sandboxed iframes, `file://`).
- `Access-Control-Allow-Origin: *` without credentials is fine for public, non-personalized data.
- CORS doesn't stop requests from being **sent** (CSRF). It governs whether responses can be **read**.

## Clickjacking

- Pages with sensitive one-click actions (delete account, approve payment, OAuth consent) should send `Content-Security-Policy: frame-ancestors 'self'` (or `X-Frame-Options: DENY/SAMEORIGIN`).
- Missing on ordinary pages → Hardening. Missing on sensitive-action pages → Medium.

## Open redirects

- Redirect targets from input (`?next=`, `?returnUrl=`, `redirect_uri`) need an allow-list or a strict relative-path check. Reject `//host`, `/\host`, `https:host`, and backslash and whitespace tricks.
- Raise severity when the redirect carries tokens (OAuth codes, magic links, password-reset flows).

## Browser messaging and storage

- `window.addEventListener('message', ...)` handlers must check `event.origin` against an exact allow-list before acting on `event.data`.
- `postMessage(data, '*')` with sensitive data leaks it to any embedding/opener origin.
- Sensitive tokens in `localStorage`/`sessionStorage` are exposed to any XSS. Note the trade-off when XSS sinks exist.
- `target="_blank"` reverse tabnabbing: modern browsers imply `noopener`. Low priority.
- Third-party scripts loaded without Subresource Integrity (SRI) from CDNs → supply-chain hardening.
- Service workers registered from user-controlled paths/scopes.

## Content Security Policy

CSP is defense-in-depth. Missing CSP is **Hardening**, never the primary finding. A useful policy uses nonces or hashes for scripts (`script-src 'nonce-...' 'strict-dynamic'`), `object-src 'none'`, `base-uri 'none'`, and `frame-ancestors`. `'unsafe-inline'` or `'unsafe-eval'` in `script-src`, or wildcard hosts, weaken it substantially.

## Verification

- Template/component tests: render with `<img src=x onerror=alert(1)>` and assert it appears escaped.
- URL validation tests with `javascript:alert(1)`, `JaVaScRiPt:`, ` javascript:`, `data:text/html,...`.
- CSRF: on staging, replay a state-changing request from a different origin without the token → rejected.
- CORS: `curl -H "Origin: https://evil.example" -I <endpoint>` → no reflected origin with credentials.

References: OWASP XSS Prevention, DOM-based XSS Prevention, CSRF Prevention, Clickjacking Defense, HTML5 Security, Content Security Policy Cheat Sheets; CWE-79, CWE-352, CWE-346, CWE-942, CWE-1021, CWE-601.
