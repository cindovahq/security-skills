# React — Open Redirects, Navigation Sinks and Server-Side Requests

## Contents
- Sources and sinks
- Safe redirect helper
- React Router and TanStack specifics
- OAuth redirect URIs
- Server-side requests (SSRF) from loaders and server functions
- Severity, false positives, verification

## Sources and sinks

Sources of attacker-controlled targets: `searchParams.get('next' | 'returnTo' | 'redirect' | 'redirect_uri' | 'url')`, `location.state`, `location.hash`, `document.referrer`, `window.name`, form fields, `postMessage` data, API responses (stored URLs).

| Sink | Risk |
|---|---|
| `window.location = x`, `location.href = x`, `location.assign/replace(x)`, `window.open(x)` | Open redirect; `javascript:` executes (React does not guard these) |
| React Router `redirect(x)`, `<Navigate to={x}>`, `navigate(x)`, `<Link to={x}>`, `<Form action={x}>`, TanStack `redirect({ href: x })`, `router.history.push(x)` | Open redirect; older releases had script-execution and bypass advisories |
| `<a href={x}>`, `<iframe src={x}>` | Phishing/clickjacking; `javascript:` blocked on React 19 elements, runs on click in React 18 (`xss.md`) |
| `Location` header from a loader/resource route (`new Response(null, { status: 302, headers: { Location: x } })`) | Open redirect |

## Safe redirect helper

Parse against your own origin and allow only same-origin results, returning a path (never the raw input):

```ts
export function safeRedirect(input: string | null | undefined, fallback = '/') {
  if (!input) return fallback;
  try {
    const base = 'https://app.invalid';                  // any fixed origin works for parsing
    const url = new URL(input, base);
    if (url.origin !== base) return fallback;            // rejects https://evil, //evil, /\evil, javascript:
    if (/[\u0000-\u001F\u007F\\]/.test(input)) return fallback; // control chars (URL parsers strip tab/newline) and backslashes
    const out = url.pathname + url.search + url.hash;
    return out.startsWith('//') ? fallback : out;        // normalization can yield //host, e.g. /..//evil
  } catch { return fallback; }
}
```

String checks like `input.startsWith('/')` alone accept `//evil.example` and `/\evil.example`. `includes('example.com')`/`endsWith` allow-lists accept look-alike hosts. If external destinations are required, use an exact-match allow-list of origins.

## React Router and TanStack specifics

- `redirect()` docs: it "accepts absolute URLs and can navigate to external domains, so the application should validate any user-supplied inputs to redirects". Calls like `redirect(url.searchParams.get('next') ?? '/')` after login are the classic finding.
- History: CVE-2025-68470 (untrusted path to `navigate`/`<Link>`/`redirect()` goes external; <=7.9.5), CVE-2026-22029 (open redirects from loaders/actions could execute `javascript:`; <=7.11.0), CVE-2026-40181 (`redirect` with a path starting `//`; <7.14.1), CVE-2026-53669 (bypass of the first fix; <7.18.0), and CVE-2026-53668 (open redirect leading to XSS; fixed in 7.13.0 and `react-router-dom` 6.30.6). Upgrading reduces risk; keep your own validation.
- Data/Declarative mode: `<Navigate to={searchParams.get('next')}>` after login has the same issue client-side.
- TanStack: `throw redirect({ to: '/login', search: { redirect: location.href } })` and later navigation to `search.redirect` — validate with `safeRedirect` before navigating. `validateSearch` should coerce `redirect` to a string and run the helper.

## OAuth redirect URIs

- The client sends a `redirect_uri` that must exactly match a registered URI (RFC 9700). Findings: wildcard or prefix registrations, `redirect_uri` taken from the current URL or query string, and callbacks that forward to `returnTo` unvalidated. Combined with an open redirect on the same origin, the code or token leaks to an attacker site: **High**.
- Keep `state` bound to the browser session, and check it in the callback route.

## Server-side requests (SSRF) from loaders and server functions

SSRF exists only where **server code** fetches a user-influenced URL: React Router/Remix `loader`/`action`, resource routes (image or link-preview proxies), TanStack server functions, Gatsby Functions, SSR code. A browser `fetch(userUrl)` is not SSRF (it runs with the user's own network position); at most it is a CORS/CSRF or data-leak question.

```ts
export async function loader({ request }: Route.LoaderArgs) {
  const target = new URL(request.url).searchParams.get('url');
  const res = await fetch(target!);                      // finding: any scheme, host, redirect
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? '' } });
}
```

Fix: parse the URL, require `https:`, allow-list exact hosts, resolve and reject private/loopback/link-local/metadata addresses (including after redirects: set `redirect: 'manual'` and re-validate), set timeouts and size limits, and don't forward cookies or auth headers. The proxy should also fix `Content-Type` (or serve as `attachment`) so it can't serve HTML/SVG from your origin. Details: the `nodejs-security` and `appsec-review` skills (SSRF guidance).

## Severity, false positives, verification

- Open redirect alone: Low/Medium. High when it leaks OAuth/magic-link tokens, or `javascript:` reaches a `location` sink (XSS). SSRF reaching internal services or cloud metadata: High/Critical; blind or allow-listed: Medium/Low.
- **Not findings:** redirects to constants; `Link to="/relative"`; `window.open('https://docs.example.com', '_blank')`; redirects whose target passes through `safeRedirect` or an exact allow-list; browser-side `fetch` of arbitrary URLs.
- **Verify:** unit-test the helper with `https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:void(0)`, a tab inside the path (`/<TAB>/evil.example`), `/..//evil.example`, `/.//evil.example`, `/ok` and `/a?b=c#d`; the unsafe inputs must return the fallback and the last two must come back as local paths (the helper above was run against these cases). For SSRF on staging, request a URL on a host you control and confirm the allow-list rejects it.

References: OWASP Unvalidated Redirects and Forwards, SSRF Prevention Cheat Sheets; CWE-601, CWE-918; https://reactrouter.com/api/utils/redirect, https://www.rfc-editor.org/rfc/rfc9700, https://github.com/remix-run/react-router/security/advisories.
