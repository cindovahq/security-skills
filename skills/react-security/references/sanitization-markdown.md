# React — Sanitizing HTML, Markdown, SVG and Trusted Types

## Contents
- Where sanitization belongs
- DOMPurify: usage pitfalls
- Trusted Types with React 19.3
- Markdown and MDX renderers
- SVG, uploads, HTML email and previews
- i18n and CMS content
- Severity, false positives, verification

## Where sanitization belongs

Sanitize **immediately before the sink, on output**, with a maintained sanitizer. Sanitizing at write time alone leaves old rows exposed to every later sanitizer bypass, and any string operation after sanitizing (concatenation, `replace`, wrapping in markup, re-parsing with another parser) can undo it. Prefer not rendering HTML at all: store structured data (Markdown AST, JSON blocks) and render with JSX.

## DOMPurify: usage pitfalls

Default `DOMPurify.sanitize(dirty)` output inserted as HTML text content (`dangerouslySetInnerHTML`, `innerHTML`) is the supported, safe pattern. Investigate:

| Pitfall | Why it matters |
|---|---|
| Old version | DOMPurify ships bypass fixes often. As of 2026-10-02 the latest is 3.4.16. One default-config bypass (CVE-2026-47423, `selectedcontent` re-clone) affected exactly 3.4.4, fixed in 3.4.5. Many 2026 advisories are for non-default modes (`IN_PLACE`, `RETURN_DOM`, hooks, `SAFE_FOR_TEMPLATES`, `CUSTOM_ELEMENT_HANDLING`). Check the installed version against https://github.com/cure53/DOMPurify/security/advisories |
| Widened config | `ADD_TAGS`, `ADD_ATTR`, `ALLOW_UNKNOWN_PROTOCOLS: true`, custom `ALLOWED_URI_REGEXP`, `CUSTOM_ELEMENT_HANDLING`, `FORBID_*` removed, `SANITIZE_DOM: false`. Function-form `ADD_TAGS`/`ADD_ATTR` predicates bypassed `FORBID_TAGS` and URI validation in older versions (CVE-2026-41240, fixed 3.4.0; GHSA-cjmm-f4jc-qw8r, fixed 3.3.2). The README asks you to read its "tags and attributes to think twice about" list before widening |
| Output used as DOM, not string | `RETURN_DOM`, `RETURN_DOM_FRAGMENT`, `IN_PLACE` have a separate advisory history. The README says to sanitize attacker-controlled trees before connecting them to the live document |
| Prototype pollution in the page | CVE-2026-41238: with any pollution gadget in the same context, DOMPurify 3.0.1 to 3.3.3 allowed arbitrary custom elements and attributes (fixed 3.4.0). See `dynamic-code.md` |
| Server-side DOM | DOMPurify needs a DOM. The README strongly recommends the latest `jsdom` and says `happy-dom` is "not considered safe". `isomorphic-dompurify` wraps `jsdom` |
| Sanitized, then mutated | `DOMPurify.sanitize(x) + userSuffix`, `.replace(...)`, `<div class="${cls}">${clean}</div>` inside attributes or `<style>`/`<script>` |
| Wrong context | Sanitized HTML placed in an attribute, `srcDoc`, a `<template>`, or re-parsed by `marked`/another renderer |
| Home-grown "sanitizers" | Regexes stripping `<script>` or `on*=` attributes; allow-list-less `DOMParser` walks. Always a finding when feeding a sink |

## Trusted Types with React 19.3

React 19.3.0 (2026-09-09) integrates with the browser Trusted Types API (changelog; PR 35816): values are passed to the DOM without string coercion, and react.dev documents passing a `TrustedHTML` value as `__html`. `dangerouslySetInnerHTML` has always passed `__html` to `innerHTML` unchanged, so a `TrustedHTML` value works on 18 and 19; 19.3.0 extends the same no-coercion behavior to attributes and `TrustedScriptURL`. Test enforcement against your own build (React's internal `<script>` element creation assigns a string to `innerHTML`, which can throw without a default policy). A typical setup:

```ts
const policy = trustedTypes.createPolicy('app-html', { createHTML: (s) => DOMPurify.sanitize(s) });
// <div dangerouslySetInnerHTML={{ __html: policy.createHTML(post.body) }} />
```

CSP: `require-trusted-types-for 'script'; trusted-types app-html`. The policy is only as safe as its sanitizer. A permissive policy (`createHTML: (s) => s`) is a finding. Trusted Types is Hardening, never a substitute for removing sinks. Check current browser support on MDN before relying on it.

## Markdown and MDX renderers

| Library | Default behavior |
|---|---|
| `marked` | README: "Marked does not sanitize the output HTML". Raw HTML and `javascript:` links pass through. Needs DOMPurify (or equivalent) on the output |
| `markdown-it` | `html: false` by default. `html: true` needs sanitizing. Verify the installed version's options |
| `react-markdown` | README: "secure by default" (no `dangerouslySetInnerHTML`; HTML is escaped or dropped; `defaultUrlTransform` allows `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp` and relative URLs). Insecure with: `rehype-raw` (add `rehype-sanitize` after it), a `urlTransform` that returns the URL unchanged, or custom `components` / plugins that emit unsafe elements |
| `remark-html`, `rehype-stringify` with `allowDangerousHtml` | Raw HTML passes through |
| `@mdx-js/*`, `next-mdx-remote`, `@mdx-js/rollup` | MDX is code. User-supplied MDX is script execution (in the browser, or on the server if compiled at request time). Compile trusted content only |
| `showdown`, `snarkdown`, `micromark` | Do not assume sanitization. Check the docs for the installed version |

```tsx
// finding: raw HTML plus no sanitizer
<ReactMarkdown rehypePlugins={[rehypeRaw]}>{comment.text}</ReactMarkdown>
// fix
<ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>{comment.text}</ReactMarkdown>
```

Also check link rendering: Markdown links reach `<a href>`. On React 19 element rendering blocks `javascript:`, but on React 18 an unsafe `urlTransform` reopens it.

## SVG, uploads, HTML email and previews

- `<img src={url}>` of a user SVG does not run its scripts. The same file opened directly, inlined with `dangerouslySetInnerHTML`/`innerHTML`, or loaded in `<object>`, `<embed>` or `<iframe>` on the app origin does. Inline user SVG only after DOMPurify with the SVG profile; serve uploads from a separate origin or with `Content-Disposition: attachment`.
- `URL.createObjectURL(file)` of a user HTML/SVG file shown in an `<iframe src>` runs in the app origin. Preview with `<img>` or a sandboxed iframe.
- HTML email, rich "previews" and untrusted widgets: `<iframe sandbox="" srcDoc={html}>` (no `allow-scripts`). MDN: using both `allow-scripts` and `allow-same-origin` on same-origin content lets the document remove its own sandbox, "no more secure than not using the `sandbox` attribute". `srcDoc` documents inherit the embedder's origin, so an unsandboxed one is XSS.
- Build-time SVG imports (`?react`, `?raw`, SVGR) are trusted code, not findings.

## i18n and CMS content

- i18next defaults `interpolation.escapeValue` to `true`; the react-i18next docs recommend `escapeValue: false` "not needed for react as it escapes by default". That is safe only while translations render as text. If any `t()` result goes to `dangerouslySetInnerHTML`, or `Trans` renders user values into markup, user values interpolated into the string are unescaped: finding.
- Headless CMS rich text (HTML or Markdown fields) is authored by editors. Rate by who can edit it: public contributors High; trusted admins only Low/Informational.

## Severity, false positives, verification

- Unsanitized stored HTML/Markdown reaching other users: **High**. Sanitizer present but widened or outdated: Medium (High if a concrete bypass applies to the installed version). Content authored only by trusted admins: Low.
- **Not findings:** DOMPurify default-config output on a patched version (not 3.4.4; see `dependencies.md`); `react-markdown` defaults; sanitized HTML plus `target="_blank"`; `dangerouslySetInnerHTML` with build-time constants.
- **Verify:** unit-test the render path with a harmless marker (`<img src=x onerror="document.title='xss-test'">`, `[x](javascript:void(0))`) and assert the output has no `onerror` or `javascript:`. Pin the sanitizer in the test by importing the same module the component uses.

References: OWASP XSS Prevention Cheat Sheet; CWE-79, CWE-1021; https://github.com/cure53/DOMPurify, https://github.com/remarkjs/react-markdown#security, https://marked.js.org/, https://react.dev/reference/react-dom/components/common, https://github.com/facebook/react/pull/35816, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe.
