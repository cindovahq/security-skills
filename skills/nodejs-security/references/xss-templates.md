# Node.js — XSS and Server-Side Template Injection

## Contents
- Escaping model per template engine
- Raw-output sinks and context traps
- Data in `<script>` blocks
- Responses that become HTML
- Server-side template injection (SSTI)
- Render-options injection (`res.render(view, req.body)`)
- False positives
- Verification

## Escaping model per template engine

| Engine | Escaped | Raw (review every use) |
|---|---|---|
| EJS | `<%= x %>` | `<%- x %>` (also used for `include`) |
| Pug | `#{x}`, `p= x` | `!{x}`, `p!= x`, `&attributes(obj)` |
| Handlebars / express-handlebars | `{{x}}` | `{{{x}}}`, `new Handlebars.SafeString(x)`, helpers returning `SafeString` |
| Nunjucks | `{{ x }}` with `autoescape: true` (default since 2.0) | `{{ x | safe }}`, `autoescape: false` in `configure()` |
| Eta | `<%= x %>` (when `autoEscape` is on, the default) | `<%~ x %>` |
| Hono JSX / React SSR | `{x}` | `dangerouslySetInnerHTML`, `raw()` / `html` helper with unescaped input |

HTML escaping only protects HTML text and quoted attribute contexts. Check the template engine's actual config (`app.set('view options', ...)`, `nunjucks.configure`, `exphbs.create({ ... })`) before trusting defaults.

## Raw-output sinks and context traps

- `<%- user.bio %>`, `!{comment}`, `{{{ post.body }}}` with user-controlled data → stored XSS. **High** when it reaches other users (Medium if self-only or behind strict CSP).
- Markdown rendered with `marked`/`markdown-it` and output raw: markdown allows inline HTML unless disabled (`markdown-it` `html: false` is its default; `marked` passes HTML through). Sanitize the output with `sanitize-html` or DOMPurify (via `jsdom`/`isomorphic-dompurify`) and check the allow-list.
- URLs in `href`/`src`: escaping doesn't stop `javascript:`; allow only `http:`/`https:`/relative.
- Unquoted attributes (`<div class=<%= cls %>>`), event-handler attributes, and `<style>` contexts: escaping is insufficient.
- Client-side frameworks fed by server data (`v-html`, `innerHTML`, `dangerouslySetInnerHTML`): see `nextjs-security` for React/Next.js specifics.

## Data in `<script>` blocks

```ejs
<script>window.__BOOT__ = <%- JSON.stringify(boot) %>;</script>   <!-- </script><script>... breaks out -->
```

`JSON.stringify` doesn't escape `<`, `>` or `&`, so a string containing `</script>` ends the block → XSS. Fix: escape `<` as `<` (`JSON.stringify(boot).replace(/</g, '\\u003c')`), use `serialize-javascript` (escapes HTML-significant characters) for trusted data, or put JSON in `<script type="application/json" id="boot"><%= JSON.stringify(boot) %></script>` and `JSON.parse(el.textContent)`. `<%= JSON.stringify(x) %>` inside an executable script block yields HTML entities that JS won't decode: it's broken, not exploitable.

## Responses that become HTML

- Express `res.send(string)` sets `Content-Type: text/html; charset=utf-8` when no type is set. `res.send(\`Hello ${req.query.name}\`)` or `res.send(err.message)` with reflected input → reflected XSS (**Medium/High**).
- `res.status(404).send(\`Cannot find ${req.path}\`)` in custom 404 handlers.
- `res.jsonp()` with a user-controlled callback name: Express sanitizes the callback to `[\[\]\w$.]` characters, but JSONP still exposes data cross-origin by design (Medium if it returns private data).
- Fastify `reply.send(string)` defaults to `text/plain`; `reply.type('text/html')` changes that. Koa `ctx.body = string` sets `text/html` if the string starts with `<`, otherwise `text/plain`. Hono `c.html()` vs `c.text()`.
- Uploaded HTML/SVG served from your origin: see `files-paths.md`.
- `X-Content-Type-Options: nosniff` (helmet default) prevents browsers from sniffing text/plain or JSON as HTML.

## Server-side template injection (SSTI)

User input used as the **template source** (not as data) → RCE in every mainstream Node engine:

```js
ejs.render(req.body.template, data);                  // "custom email template" features
pug.render(userTemplate);  Handlebars.compile(userTemplate)(data);
nunjucks.renderString(userTemplate, data);  _.template(userTemplate)();
```

- EJS's own security policy: EJS "is effectively a JavaScript runtime"; rendering untrusted templates is the application's responsibility.
- Handlebars has added prototype-access restrictions (4.6.0+) and fixed compile-time RCEs (CVE-2019-19919 fixed 4.3.0; CVE-2021-23369 fixed 4.7.7), but compiling untrusted templates is still not supported as safe.
- Pug: RCE via compiler options from user input: `pretty` (CVE-2021-21353, fixed 3.0.1) and `name` in `compileClient` (CVE-2024-36361, fixed 3.0.3).
- lodash `_.template` with untrusted templates is code execution by design (plus CVE-2026-4800 for `imports` key names, fixed in 4.18.0).

Fix: logic-less placeholder replacement (`str.replace(/\{\{(\w+)\}\}/g, (_, k) => escape(vars[k] ?? ''))`), or a sandboxed engine run in an isolated process. Severity: **Critical** when a normal user can set the template; High if admin-only in a multi-tenant SaaS (tenant admin → server RCE).

## Render-options injection (`res.render(view, req.body)`)

Express merges `app.locals`, `res.locals` and the render options object, with the options object last. If that object comes from the request, the attacker controls keys the engine treats as configuration:

```js
res.render('themes/preview', { ...req.body, user: req.user });   // vulnerable
res.render('page', req.query);                                    // vulnerable with a nesting query parser
```

EJS (still in 3.1.10 and 6.x) copies `settings['view options']` from the data object into compile options (tested: a body of `{"settings":{"view options":{"delimiter":"?"}}}` changes how the template compiles). Options such as `outputFunctionName` (CVE-2022-29078, validated since 3.1.7), `escapeFunction` with `client`, and `closeDelimiter` (CVE-2023-29827, disputed by the vendor) have been used for RCE. Treat any request-controlled render locals as **Critical** until proven otherwise. Other engines also read configuration from render locals: Pug receives them as compiler options (the `pretty` RCE above was reachable this way), and express-handlebars reads `layout` and `partials` from them.

Fix: pass an explicit object of the fields the view needs: `res.render('themes/preview', { title: body.title, color: body.color, user })`. Also never take the view name from input (`res.render(req.query.page)` → arbitrary template/file render).

## False positives

- `<%= %>`, `#{}`, `{{ }}` output of user data in HTML text or quoted attributes.
- `<%- include('partials/header') %>`: `<%-` is required for includes.
- `<%- html %>` where `html` comes from `sanitize-html`/DOMPurify with a reviewed allow-list, or from a constant/server-generated markup with no user input.
- `res.send()` of strings built only from server constants or of objects (sent as JSON).

## Verification

```js
it('escapes stored notes', async () => {
  await agent.post('/invoices/1/notes').type('form').send({ notes: '<img src=x onerror=alert(1)>' });
  const html = (await agent.get('/invoices/1')).text;
  expect(html).not.toContain('<img src=x onerror');
  expect(html).toContain('&lt;img');
});
it('ignores render options in request bodies', async () => {
  const r = await agent.post('/themes/preview').send({ settings: { 'view options': { delimiter: '?' } } });
  expect(r.text).not.toContain('<%');
});
```

References: OWASP XSS Prevention Cheat Sheet, OWASP WSTG-INPV-18 (SSTI); CWE-79, CWE-80, CWE-116, CWE-1336, CWE-94; https://github.com/mde/ejs/blob/main/SECURITY.md, https://pugjs.org/api/reference.html, https://handlebarsjs.com/api-reference/runtime-options.html.
