# React — postMessage, Iframes, Storage, Service Workers and Third-Party Scripts

## Contents
- postMessage
- Iframes, embedding and clickjacking
- Windows, links and `target="_blank"`
- Browser storage
- Service workers
- Third-party scripts and widgets
- Files, blobs and downloads
- Severity, false positives, verification

## postMessage

Receiving (`useEffect` with `window.addEventListener('message', ...)`, embed/SDK bridges, OAuth popup handlers, payment iframes):

```tsx
useEffect(() => {
  const onMessage = (e: MessageEvent) => {
    if (e.data.type === 'navigate') window.location.href = e.data.url;   // no origin check, javascript: reachable
    if (e.data.type === 'html') setHtml(e.data.html);                    // later rendered with dangerouslySetInnerHTML
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, []);
```

MDN: "always verify the sender's identity using the `origin` and possibly `source` properties". Require an **exact** match against an allow-list (`e.origin === 'https://auth.example.com'`; also check `e.source === popup`). Substring tests (`origin.indexOf('example.com') !== -1`, `endsWith`) are bypassable (`indexOf` per the OWASP HTML5 cheat sheet; `endsWith` without a leading dot likewise matches `evilexample.com`). Then validate `e.data` with a schema and treat its fields as untrusted input (never into `innerHTML`, `location`, `eval`).

Sending: `target.postMessage(data, '*')` with tokens, user data or auth codes discloses them if the target window navigated to another origin. MDN: always specify an exact `targetOrigin`. In `window.parent.postMessage(...)` from an embeddable app, use the known embedder origin or a handshake.

## Iframes, embedding and clickjacking

- Pages with sensitive one-click actions should not be frameable: set `Content-Security-Policy: frame-ancestors 'self'` (or `X-Frame-Options`) in the HTTP **header** (not valid via `<meta>`; `security-headers-csp.md`). Missing on ordinary pages: Hardening; on pages with sensitive actions: Medium.
- Embedding third-party content: use `sandbox` (MDN: never `allow-scripts` + `allow-same-origin` together for same-origin content), `referrerPolicy`, `allow` limited, and `loading="lazy"`. `credentialless` iframes are an option for third-party documents.
- `<iframe src={userUrl}>`: blocks `javascript:` on React 19 but allows arbitrary pages (phishing) and `data:` documents; allow-list hosts.
- `srcDoc` with untrusted HTML runs in your origin: sandbox it (`sanitization-markdown.md`).
- If the app is meant to be embedded (widgets/SDK), the postMessage bridge above is the attack surface.

## Windows, links and `target="_blank"`

- `target="_blank"` on `<a>`, `<area>` and `<form>` implies `rel="noopener"` (MDN). Reverse-tabnabbing reports on JSX links are false positives in current browsers; `rel="noreferrer"` matters only if the `Referer` is sensitive (tokens in URLs).
- `window.open(url)` also needs the origin/scheme validation from `ssrf-redirects.md`. Add `'noopener'` in features when you don't need `window.opener` (OWASP).
- OAuth popups: verify `postMessage` origin and `state`; close the popup after use.

## Browser storage

- `localStorage`/`sessionStorage`/IndexedDB are readable by any script in the origin and are shared between tabs. Do not store credentials, refresh tokens, PII or authorization decisions there (`authentication-sessions.md`).
- Values read back from storage are untrusted: a previous XSS, an extension or a shared origin can plant them. Validate with a schema before using `JSON.parse(localStorage.x)` results in `dangerouslySetInnerHTML`, `location`, `Function`, or a deep merge (`dynamic-code.md`).
- Cookies set from JavaScript (`document.cookie`) cannot be `httpOnly`; set security cookies server-side.
- Cached sensitive data survives logout unless cleared (query caches, Redux persist).

## Service workers

- Registered from `/sw.js` at origin scope: a compromised worker file controls every request. Never register from user-supplied paths or scopes; serve the file with `Cache-Control: no-cache`.
- Workbox/PWA runtime caching of authenticated API responses or HTML containing user data can serve one user's data to another on shared devices. Use `NetworkOnly` for authenticated endpoints and clear caches on logout.
- `skipWaiting`/`clientsClaim` are fine; check update paths so a bad release can be replaced.

## Third-party scripts and widgets

Tag managers, analytics, chat, A/B testing, session replay, payment and consent SDKs execute with full privileges in the page: they can read the DOM, storage and non-`httpOnly` cookies and call your APIs as the user.

- Prefer self-hosting and pinning; for static third-party files use Subresource Integrity (`integrity` + `crossorigin`; React's `<script>` and `<link>` accept `integrity`, `nonce`, `crossOrigin`).
- A tag manager is effectively a remote-code-execution path for whoever controls its container. Restrict who can publish containers, and treat unknown dynamic `script.src` creation (`document.createElement('script')`) as a sink.
- Session replay/analytics: mask inputs, exclude password and payment fields, and avoid sending tokens or PII in URLs.
- Supply-chain precedent: a CDN script host whose domain changes hands can start serving malicious code (the 2024 polyfill.io incident), so pin and prefer same-origin copies.
- CSP `script-src` allow-lists and `connect-src` limit the damage (`security-headers-csp.md`).

## Files, blobs and downloads

- Client-side file type/size checks are UX; the server must validate (see `appsec-review` file upload guidance).
- `URL.createObjectURL(file)` shown in an `<iframe>`/`<object>` or opened as a document runs HTML/SVG in the app origin; show images via `<img>` and everything else as a download.
- Generated downloads: CSV/Excel exports that include user text can contain formulas (`=`, `+`, `-`, `@` prefixes): Low; prefix with `'` or strip.
- `FileReader.readAsText` then `innerHTML`: sink.

## Severity, false positives, verification

- `message` handler with no origin check that reaches `location`, `innerHTML`, `Function`, state-changing API calls or token use: **High**. Only reads benign UI data (theme, height): Low/Informational. `postMessage(secret, '*')`: Medium/High by data.
- **Not findings:** `target="_blank"` without `rel`; `localStorage` for theme or non-sensitive UI preferences; a `message` listener with an exact origin allow-list and validated payload; same-origin `BroadcastChannel`; third-party scripts that are first-party-hosted or SRI-pinned.
- **Verify:** from a test page on another origin, `postMessage` a harmless `{ type: 'ping' }` to the app window and confirm it is ignored; check `Set-Cookie` and `Content-Security-Policy` headers with `curl -I`; load the app in a sandboxed iframe from a different origin to confirm frame-ancestors enforcement.

References: OWASP HTML5 Security Cheat Sheet, Clickjacking Defense Cheat Sheet; CWE-346, CWE-1021, CWE-829; https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/noopener.
