# Node.js — SSRF and Open Redirects

## Contents
- Outbound request sinks
- What makes SSRF exploitable
- Fix patterns
- HTTP client specifics (fetch, axios, got)
- Open redirects
- False positives
- Verification

## Outbound request sinks

Any server-side request whose URL, host, port or path is influenced by the client:

```js
await fetch(req.body.url);                                  // global fetch (undici), Node 18+
await axios.get(req.query.target);
await got(req.body.webhookUrl);
http.get(url); https.request({ host: req.body.host, path });
await page.goto(req.body.url);                              // Puppeteer/Playwright PDF/screenshot
sharp(await (await fetch(imgUrl)).arrayBuffer());           // image proxies
```

Features to check: link previews/unfurling, webhooks and callback URLs, "import from URL", avatar-by-URL, PDF/HTML-to-image renderers, OAuth/OIDC discovery URLs taken from input, XML/SVG processing that fetches external resources, proxy endpoints (`http-proxy-middleware` with a dynamic `router`/`target`).

## What makes SSRF exploitable

- Cloud metadata: `169.254.169.254` (AWS IMDSv1 returns credentials to a plain GET; IMDSv2 needs a PUT with a token header), GCP `metadata.google.internal` (needs `Metadata-Flavor: Google`), Azure (`Metadata: true`). A **response-returning** SSRF to IMDSv1 → **Critical**.
- Internal services: admin panels, Redis/Elasticsearch HTTP APIs, Kubernetes API, `localhost` debug ports (`--inspect` on 9229), other microservices trusting the network.
- Blind SSRF (no response returned) still allows internal port scanning and state-changing GETs → Medium/High.
- Bypasses of naive checks: redirects (a public URL that 302s to `169.254.169.254`), DNS rebinding (validate-then-fetch resolves twice), alternative IP notations (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`, `0.0.0.0`), `user@host` confusion, IPv6, and string checks like `url.includes('example.com')`.

## Fix patterns

1. Prefer an allow-list of hosts (or fixed base URLs where only a path segment varies, with `encodeURIComponent`).
2. If arbitrary public URLs are a feature: parse with `new URL()`, allow only `http:`/`https:`, resolve DNS once, reject private/loopback/link-local/unique-local/multicast ranges (IPv4 and IPv6, including IPv4-mapped IPv6), and **connect to the resolved IP** (a custom `lookup` on the agent / undici `Agent` `connect.lookup`), so rebinding can't swap it.
3. Disable redirects or re-validate each hop (`fetch(url, { redirect: 'manual' })`, axios `maxRedirects: 0`, got `followRedirect: false`).
4. Set timeouts and response size limits.
5. Defense-in-depth: egress firewall rules, IMDSv2 with hop limit 1, separate network for fetchers.
6. Don't return raw responses or detailed error messages to the client.

Libraries like `ssrf-req-filter`/`request-filtering-agent` implement the IP check at connect time; confirm they're applied to the agent actually used (fetch ignores Node `http.Agent` options; it needs an undici `dispatcher`).

## HTTP client specifics (fetch, axios, got)

- **Global `fetch`** follows redirects by default (`redirect: 'follow'`) and has no total-request deadline (undici defaults to 300 s each for headers and body); use `AbortSignal.timeout(ms)`.
- **axios:** `baseURL` is **not** a security boundary. An absolute URL passed as the request URL overrides `baseURL` (`allowAbsoluteUrls` defaults to `true`), sending configured headers (API keys) to the attacker's host. The `allowAbsoluteUrls` option appeared in 1.8.0, and the CVE-2025-27152 fix (1.8.2 / 0.30.0) made it effective in the http adapter; set it to `false` on instances that take user-influenced paths. The fetch adapter didn't enforce `maxRedirects: 0` (CVE-2026-101907, affects 1.17.0 up to 1.20.0 when the fetch adapter is used, which isn't the default on Node), and a batch of HTTP/2, proxy-bypass and prototype-pollution-gadget advisories was published in September 2026: check `npm audit` for the installed version. axios 1.14.1 and 0.30.4 were malicious releases (March 2026 account compromise); see `dependencies.md`.
- **got / undici / node-fetch:** same review; `got` follows redirects by default.
- Puppeteer/Playwright: block `file://`, internal hosts and redirects via request interception; never render user HTML with network access to internal ranges.

## Open redirects

```js
res.redirect(req.query.next);                 // //evil.example, https://evil.example
res.redirect(req.get('Referer'));             // Express 5 removed the magic 'back' string; this is its replacement and is attacker-influenced
ctx.redirect(ctx.query.returnTo);             // Koa
return c.redirect(c.req.query('to'));         // Hono
```

- Express encodes but does not validate redirect targets. Older Express had an allow-list bypass with malformed URLs (CVE-2024-29041, fixed 4.19.2 / 5.0.0-beta.3) and an XSS in `res.redirect()` (CVE-2024-43796, fixed 4.20.0 / 5.0.0).
- Koa 3 `ctx.back()` only redirects to the `Referer` when its host matches the request host (scheme isn't compared); prefer it to hand-rolled referer redirects.
- Naive checks that fail: `startsWith('/')` (allows `//evil.example` and `/\evil.example`), rejecting only a leading `//` (allows `/<TAB>/evil.example`, because URL parsers strip tabs and newlines, and `/..//evil.example` after normalization), `includes('example.com')`, regexes without anchors.

**Fix:** allow only same-site relative paths, or compare a parsed URL against an allow-list:

```js
function safeNext(next, fallback = '/') {
  if (typeof next !== 'string' || !next || /[\u0000-\u001F\u007F\\]/.test(next)) return fallback; // URL parsers strip tab/newline
  const base = 'https://app.invalid';
  let u;
  try { u = new URL(next, base); } catch { return fallback; }
  if (u.origin !== base) return fallback;
  const out = u.pathname + u.search + u.hash;
  return out.startsWith('//') ? fallback : out; // normalization can yield //host, e.g. /..//evil
}
```

Severity: open redirect alone → **Low/Medium**; Medium/High when chained (OAuth `redirect_uri` token theft, phishing from a trusted login page, SSRF via a server-side client following the redirect).

## False positives

- `fetch` to a fixed host where only a path segment or query value comes from input and is `encodeURIComponent`-encoded.
- Outbound calls to a URL stored by an admin in trusted configuration (unless admins are a lower trust tier, e.g. tenant admins in SaaS).
- `res.redirect()` to a value chosen from a server-side map (`const targets = { billing: '/billing' }`).

## Verification

```js
it('refuses internal targets', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:9229/json', 'http://[::1]/', 'file:///etc/passwd'])
    await agent.post('/api/preview').send({ url }).expect(400);
});
it('only redirects locally', async () => {
  const r = await request(app).get('/logout?returnTo=//evil.example');
  expect(r.headers.location).toBe('/');
});
```

Use a canary host you control (or a local test server) to prove outbound requests; never probe third-party or cloud metadata endpoints of systems you aren't authorized to test.

References: OWASP SSRF Prevention Cheat Sheet, Unvalidated Redirects Cheat Sheet; CWE-918, CWE-601; https://github.com/axios/axios/security/advisories, https://github.com/expressjs/express/security/advisories, https://nodejs.org/api/globals.html#fetch.
