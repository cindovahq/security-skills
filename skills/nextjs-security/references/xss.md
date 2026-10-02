# Next.js — Cross-Site Scripting

## Contents
- React's escaping model
- Raw HTML sinks
- Markdown and MDX
- JSON and data inside `<script>`
- URLs and navigation
- SVG and the image optimizer
- Framework XSS advisories
- Severity notes, false positives, verification

## React's escaping model

JSX text and attribute values are escaped by React on both server and client. XSS in Next.js comes from the escape hatches below, not from `{value}` in JSX. Server Components rendering raw HTML are as dangerous as Client Components: the HTML is in the response.

## Raw HTML sinks

```tsx
<div dangerouslySetInnerHTML={{ __html: post.body }} />                 // investigate
<div dangerouslySetInnerHTML={{ __html: marked.parse(comment.text) }} /> // investigate
el.innerHTML = value; document.write(value); insertAdjacentHTML(...)    // client code
<iframe srcDoc={userHtml} />                                            // runs in the app origin unless sandboxed
```

For each sink, trace the source: user-generated content, CMS content editable by lower-trust roles, URL params, third-party APIs. Fix: sanitize server-side with DOMPurify (`isomorphic-dompurify` works in Server Components) using the default or a tighter allow-list, or render structured data with JSX instead of HTML. `sandbox` without `allow-same-origin` on `srcDoc` iframes.

## Markdown and MDX

| Library | Default |
|---|---|
| `marked` | "Marked does not sanitize the output HTML." Raw HTML in Markdown passes through. Needs DOMPurify on the output. |
| `markdown-it` | `html: false` by default (raw HTML escaped). `html: true` → needs sanitizing. Verify for the installed version. |
| `react-markdown` | "Secure by default": no `dangerouslySetInnerHTML`, HTML escaped/ignored, `defaultUrlTransform` allows only `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`. Adding `rehype-raw` or a permissive `urlTransform` removes that; add `rehype-sanitize`. |
| `remark-html` / `rehype-stringify` with `allowDangerousHtml` | Raw HTML passes through. |
| MDX (`@next/mdx`, `next-mdx-remote`, `@mdx-js/mdx`) | MDX is code. User-supplied MDX → JS execution (on the server when compiled at request time). Only compile trusted content. |

## JSON and data inside `<script>`

```tsx
// investigate: JSON.stringify does not escape </script> or <!--
<script dangerouslySetInnerHTML={{ __html: `window.__USER__ = ${JSON.stringify(user)}` }} />
<Script id="init">{`init(${JSON.stringify(config)})`}</Script>
```

A value containing `</script><script>...` breaks out of the script element. Fix: don't inline data (pass props to a Client Component), or escape `<` as `\u003c` (e.g. `JSON.stringify(data).replace(/</g, '\\u003c')`, or `serialize-javascript`). `type="application/ld+json"` blocks need the same escaping.

`next/script` with inline children or `dangerouslySetInnerHTML` is a raw script sink. CVE-2026-44580: `beforeInteractive` script content wasn't HTML-escaped before embedding (13.0.0–<15.5.16, 16.0.0–<16.2.5).

## URLs and navigation

- The App Router renders with React 19 (Next.js 15/16 App Router uses React 19 / React canary). React 19 replaces `javascript:` URLs in `href`, `src`, `action`, `formAction` on DOM elements with a URL that throws ("error for javascript URLs in `src` and `href`", React 19 changelog, PR #26507). So `<a href={user.website}>` is not script execution there. React 18 (allowed for the Pages Router in Next 15) only warns: report it in Pages Router apps on React 18.
- Still sinks in any version: `window.location = input`, `location.href = input`, `router.push(input)`/`router.replace(input)` with absolute input, `window.open(input)`, and HTML strings built with URLs for `dangerouslySetInnerHTML`. Allow-list schemes (`http:`/`https:`) with `new URL()`.
- `<a target="_blank">` to user URLs: modern browsers imply `noopener`. Not a finding.

## SVG and the image optimizer

- `images.dangerouslyAllowSVG: true` lets `/_next/image` serve SVGs. The docs strongly recommend `contentDispositionType: 'attachment'` (the default since 15.0) and `contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"`. With `contentDispositionType: 'inline'` and no CSP, an attacker-controlled SVG (any host allowed by `remotePatterns`, or an uploaded file) runs script on the app origin when opened → High.
- SVGs in `public/` or uploads served from the app origin have the same issue.

## Framework XSS advisories

- CVE-2026-44581: CSP nonce values from request headers reflected unsafely, enabling cache-poisoned stored XSS behind shared caches (13.4.0–<15.5.16, 16.0.0–<16.2.5).
- CVE-2026-44580: `beforeInteractive` script escaping (above).
- Old: CVE-2021-39178 XSS in the image optimizer (10.0.0–11.1.0).

## Severity notes, false positives, verification

- Stored XSS that reaches other users (especially admins) → High. Reflected → Medium/High. Self-only → Low.
- With an `httpOnly` session cookie, XSS still performs actions as the victim (Server Actions included); don't downgrade on that basis alone.
- **Not findings:** JSX interpolation; `dangerouslySetInnerHTML` of DOMPurify output or static strings; `react-markdown` defaults; `href={url}` in App Router (React 19); `next/script` with a static `src`.
- **Verify:** store a harmless marker (`<img src=x onerror="document.title='xss-test'">`, `</script><b>marker</b>`) as a test user on staging and check the rendered DOM; unit-test the sanitizer/serializer output. Confirm the fix with the same input rendering inert.

References: OWASP XSS Prevention Cheat Sheet; CWE-79, CWE-80, CWE-116; https://react.dev/blog/2024/04/25/react-19-upgrade-guide, https://nextjs.org/docs/app/api-reference/components/image#dangerouslyallowsvg, https://github.com/remarkjs/react-markdown#security, https://marked.js.org/.
