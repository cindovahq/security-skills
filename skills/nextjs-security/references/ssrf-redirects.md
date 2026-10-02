# Next.js — SSRF, Image Optimizer and Open Redirects

## Contents
- Server-side fetches of user URLs
- Image optimizer (`next/image`, `/_next/image`)
- Rewrites, redirects and Host-header issues
- Open redirects
- Severity notes, false positives, verification

## Server-side fetches of user URLs

Server Components, Server Actions, Route Handlers and proxy all run on the server and can reach internal networks and cloud metadata (`169.254.169.254`). Investigate `fetch(input)`, `axios.get(input)`, `got(input)`, headless browsers (`puppeteer`, `playwright`) and PDF/screenshot renderers given user URLs: link previews, webhooks-to-URL, "import from URL", avatar-from-URL, OG scrapers.

```ts
// app/api/preview/route.ts — investigate
const { url } = await req.json()
const res = await fetch(url)                       // any scheme/host, follows redirects
return Response.json({ html: (await res.text()).slice(0, 5000) })   // response returned → full read SSRF
```

Fix: parse with `new URL()`, allow only `https:`, allow-list hosts where possible; otherwise resolve DNS and reject private, loopback, link-local and metadata ranges **for every redirect hop** (`redirect: 'manual'`), cap size and time, and don't return raw bodies. Prefer an egress proxy that enforces this.

## Image optimizer (`next/image`, `/_next/image`)

`/_next/image?url=...&w=...&q=...` fetches remote images allowed by `images.remotePatterns` (or the deprecated `images.domains`) and serves them from your origin.

- **Pattern semantics:** `*` matches one path segment or subdomain label; `**` matches any number at the end of a path or the start of a hostname. Omitting `protocol`, `port`, `pathname` or `search` implies `**` ("not recommended because it may allow malicious actors to optimize urls you did not intend").
- `remotePatterns: [{ hostname: '**' }]` (with or without `protocol: 'http'`) lets anyone use your server to fetch arbitrary hosts. Allowed hosts that redirect are followed **without** re-checking `remotePatterns`; `maximumRedirects` defaults to 3 in 16 (unlimited before).
- **16.0+** blocks optimizing images from local/private IPs unless `images.dangerouslyAllowLocalIP: true`. On 15.x and earlier there is no such block (verify for the installed version), so `**` patterns reach internal hosts.
- `images.domains` is deprecated (since 14) because it can't restrict protocol, port or path.
- The optimizer doesn't forward request headers (cookies) upstream.
- Responses must be processable as images, which limits what an attacker reads back; the request still reaches the target (blind SSRF, port probing, load).
- Advisories: CVE-2026-94483 SSRF via an allow-listed host whose DNS the attacker controls (16.x before 16.3.8, fixed in 16.3.8 per release notes; not affected if no `remotePatterns`); GHSA-2xp9-vwfh-vxw4 RCE via AVIF decoding in `libheif`/`sharp` (fixed 15.5.24 / 16.3.3, AVIF optimization disabled); CVE-2025-55173 content injection and CVE-2025-57752 cache-key confusion (fixed 14.2.31 / 15.4.5); several DoS advisories. See `dependencies.md`.
- SVG handling: see `xss.md`.

Fix: exact hostnames with `protocol: 'https'`, a `pathname` prefix and `search: ''`; `maximumRedirects: 0` if upstream doesn't need redirects; never `dangerouslyAllowLocalIP` on internet-facing apps; use `unoptimized` or a dedicated image CDN for arbitrary user URLs.

## Rewrites, redirects and Host-header issues

- `rewrites()`/`redirects()` destinations with a dynamic **hostname** (`destination: 'https://:tenant.api.example.com'`, or a `has` capture) could be pointed at any host: SSRF through rewrites, open redirect through redirects (CVE-2026-64645, 12.0.0–<15.5.21 and 16.0.0–<16.2.11). Workaround: constrain the capture, e.g. `(?<region>[a-z0-9-]+)`.
- External `rewrites` proxy the request from your origin. A rewrite to a user-influenced path on an internal service is SSRF even with a fixed host.
- Server Actions that `redirect()` on self-hosted apps with an untrusted `Host` header: SSRF (CVE-2024-34351, fixed 14.1.1; CVE-2026-64649 on custom servers or deployments that don't pin the host, fixed 15.5.21 / 16.2.11; workaround `__NEXT_PRIVATE_ORIGIN` on 14.2+). Check custom servers and reverse proxies pass a fixed `Host`.
- Middleware passing request headers into `NextResponse.next({ headers })` (CVE-2025-57822, fixed 14.2.32 / 15.4.7).
- WebSocket upgrades SSRF (CVE-2026-44578, 13.4.13–<15.5.16, 16.0.0–<16.2.5).

## Open redirects

`redirect()` (`next/navigation`) "accepts absolute URLs and can be used to redirect to external links". `NextResponse.redirect(new URL(input, request.url))` resolves an absolute or protocol-relative `input` (`https://evil.example`, `//evil.example`) to the external host.

```ts
// app/auth/callback/route.ts — investigate
const next = searchParams.get('next') ?? '/'
return NextResponse.redirect(new URL(next, request.url))
```

Common spots: login `?callbackUrl=`/`?next=`/`?returnTo=`, OAuth/magic-link callbacks, draft-mode slugs, logout redirects, Auth.js custom `callbacks.redirect`.

Fix:

```ts
function safePath(input: string | null, fallback = '/') {
  if (!input || !input.startsWith('/') || input.startsWith('//') || input.startsWith('/\\')) return fallback
  return input
}
return NextResponse.redirect(new URL(safePath(searchParams.get('next')), request.url))
```

Or compare `new URL(input, base).origin === base.origin`.

## Severity notes, false positives, verification

- Full-read SSRF reachable by any user → High (Critical in cloud environments with metadata credentials). Blind SSRF via the optimizer → Medium.
- Open redirect → Low/Medium; Medium/High when OAuth codes, magic-link tokens or `#access_token` fragments travel through it.
- **Not findings:** `fetch` to constant URLs or env-configured hosts; `redirect('/path/' + serverGeneratedId)`; `remotePatterns` listing your own CDN hostnames precisely.
- **Verify:** on staging, request `/_next/image?url=http://127.0.0.1:1/x.png&w=64&q=75` (expect 400 for disallowed hosts); call the preview endpoint with `http://169.254.169.254/` and expect rejection; request `/auth/callback?next=//example.org` and expect a same-origin `Location`.

References: OWASP SSRF Prevention Cheat Sheet, Unvalidated Redirects Cheat Sheet; CWE-918, CWE-601; https://nextjs.org/docs/app/api-reference/components/image#remotepatterns, https://nextjs.org/docs/app/api-reference/functions/redirect, https://nextjs.org/docs/app/guides/upgrading/version-16.
