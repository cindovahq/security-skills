# React — Cross-Site Scripting

## Contents
- What React escapes and what it does not
- Raw HTML sinks
- URL sinks and the `javascript:` version table
- Props, elements and tag names you don't control
- DOM sinks outside React
- Third-party components that render HTML
- Severity, false positives, verification

## What React escapes and what it does not

React escapes **text children** and **attribute values** (`<`, `>`, `&`, quotes) on the client and in `react-dom/server`. `<div title={x}>{y}</div>` cannot break out of the element or attribute. Event-handler props accept functions only: string values for `onClick` or `onclick` are dropped (verified with `renderToString` on 18.3.1 and 19.3.0).

React does **not**:

- sanitize anything passed to `dangerouslySetInnerHTML`, or HTML you put in the DOM yourself (`innerHTML`, `insertAdjacentHTML`, `srcDoc`);
- validate URL schemes everywhere (see the table below);
- protect `window.location`, `window.open`, `router.navigate` or any JavaScript sink;
- protect against untrusted objects spread into props, or user-chosen tag names;
- escape data you serialize into inline `<script>` yourself (see `ssr-hydration.md`).

Server Components and SSR output are as exposed as client rendering. An XSS needs one of the sinks below.

## Raw HTML sinks

```tsx
<div dangerouslySetInnerHTML={{ __html: ticket.body }} />                // investigate
<div dangerouslySetInnerHTML={{ __html: marked.parse(comment.text) }} /> // investigate: marked doesn't sanitize
<div dangerouslySetInnerHTML={{ __html: t('welcome', { name }) }} />     // i18next with escapeValue: false
<iframe srcDoc={email.html} />                                           // runs in the app origin unless sandboxed
```

For each sink, trace the source: user content, content editable by lower-privileged roles, CMS/webhook/email content, URL params, third-party APIs, translation strings that interpolate user values. Static strings and sanitizer output are fine (see `sanitization-markdown.md`).

react.dev: "Unless the markup is coming from a completely trusted source, it is trivial to introduce an XSS vulnerability this way". `<script>` tags inside `innerHTML` content never execute, but event-handler attributes (`<img onerror>`) do.

## URL sinks and the `javascript:` version table

Applies to user-controlled URLs in `href`, `src`, `action`, `formAction`, `xlink:href` and `<object data>`.

| React | Behavior (verified in `react-dom` source and `renderToString` output) |
|---|---|
| 18.x (incl. 18.3.1) | Passed through unchanged. Dev builds log a console warning only. `<a href={url}>` with a `javascript:` URL runs script **on click**. |
| 19.0.0 and later (incl. 19.3.0) | Replaced by `javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')`. Matching ignores case, leading control characters/spaces and tab/newline inside the scheme. Listed in the 19.0.0 changelog (PR 26507). |

Still **not** blocked in any version: `ping`, `poster`, `data:` URLs (`<iframe src="data:text/html,...">`), `iframe srcDoc`, unknown or custom-element attributes, and everything outside element attributes:

```tsx
window.location.href = params.get('returnTo')    // javascript: executes in any React version
window.open(userUrl);  location.assign(next);    // same
<a href={userUrl}>x</a>                          // safe on 19.x, exploitable on 18.x (click needed)
dangerouslySetInnerHTML={{ __html: `<a href="${url}">` }}  // string-built markup is never checked
```

Fix: parse and allow-list the scheme (`new URL(input, location.origin)`, accept `http:`/`https:` or same-origin paths). On React 18, apply the same check at render time for every user-supplied `href`. `<a target="_blank">` is not a finding: browsers imply `noopener` for `target="_blank"` (MDN). `rel="noreferrer"` only matters for referrer leakage.

## Props, elements and tag names you don't control

```tsx
<div {...JSON.parse(widget.propsJson)} />     // can carry dangerouslySetInnerHTML (verified: renders raw HTML)
const Tag = block.tag; <Tag {...block.props}/> // user-chosen tag: iframe, object, embed, form
React.createElement(node.type, node.props)    // JSON-driven page builders and CMS "blocks"
<div style={userStyleObject} />               // style values: see below
```

- Spreading parsed JSON or form data into props is a sink: strip to an allow-list of known props, and map block types through a fixed component registry (`{ heading: Heading, image: Image }`), never `createElement(userString)`.
- `style` must be an object (a string throws). On the client, values are assigned through CSSOM, so invalid values are ignored. In server rendering (`renderToString` 19.3.0) a value such as `red;position:fixed` was emitted verbatim into the `style` attribute, so user-controlled style values can inject extra declarations in SSR output. Impact is UI redress or `url()` requests; Low unless CSP or business context raises it.
- Untrusted objects as **children** (`{userObject}`) throw ("Objects are not valid as a React child"); React elements require the `$$typeof` Symbol, which JSON cannot carry (the spoofed-element XSS was fixed in React 0.14, per the changelog).

## DOM sinks outside React

React's escaping does not apply to direct DOM access:

```tsx
ref.current.innerHTML = html;              // useEffect/useLayoutEffect, highlight and tooltip helpers
el.insertAdjacentHTML('beforeend', html);  document.write(html);
range.createContextualFragment(html);      new DOMParser().parseFromString(html, 'text/html') then append
el.setAttribute('href', url);  script.src = url;  a.href = url   // no scheme check
<script async src={userUrl} />            // React 19 hoists and executes async scripts
$(userString)  $('#x').html(html)          // jQuery interop in legacy apps
```

Also check `useEffect` code that reads `location.hash`, `location.search`, `document.referrer`, `window.name`, `localStorage` or `postMessage` data and writes it to any of these.

## Third-party components that render HTML

Rich-text editors (`quill` `dangerouslyPasteHTML`, TinyMCE/CKEditor content), map popups (`bindPopup(html)`, `setHTML`), chart tooltip formatters, data-grid cell renderers returning HTML strings, "render HTML" props (`label`, `tooltip`, `description` accepting strings), toast/notification libraries with `html: true`, HTML-to-React parsers. Treat the HTML-accepting option as a sink and sanitize at the call site. Parsers that return React elements (rather than `innerHTML`) still need an allow-list, because React doesn't block `srcDoc`, `style` or unsafe `<iframe>`/`<form action>` targets.

## Severity, false positives, verification

- Stored XSS reaching other users or admins: **High** (Critical if it yields admin takeover or the app holds sensitive actions). Reflected or DOM XSS needing a crafted link: Medium/High. Self-XSS only: Low. An `httpOnly` cookie does not make XSS low: the attacker acts as the victim in-page.
- **Not findings:** JSX interpolation of any data; `href={userUrl}` on React 19.x (still report non-element sinks); `target="_blank"` without `rel`; `dangerouslySetInnerHTML` with static strings, build-time constants, or DOMPurify (patched version, not 3.4.4)/`sanitize-html` output with default or allow-list config applied after all string edits; `react-markdown` with defaults; inline (non-`async`) `<script>` children rendered on the client (never executed). Still report React 19 `<script async src={userValue}>` (hoisted to `<head>` and executed) and any server-rendered `<script>` whose string is built from user data without `JSON.stringify` plus escaping.
- **Verify:** render the component with `<img src=x onerror="document.title='xss-test'">` and `javascript:void(0)` as the data and assert the DOM contains no element with an `onerror` attribute and no `javascript:` href. Test `window.location` sinks with a unit test of the URL validator. Re-run after the fix with the same inputs.

References: OWASP XSS Prevention and DOM-based XSS Prevention Cheat Sheets; CWE-79, CWE-80, CWE-116; https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html, https://github.com/facebook/react/blob/main/CHANGELOG.md (19.0.0, "Javascript URLs are replaced with functions that throw errors"), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/noopener.
