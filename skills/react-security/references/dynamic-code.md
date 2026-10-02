# React — Dynamic Code Execution and Prototype Pollution

## Contents
- Dynamic code sinks
- Config-driven UIs
- Prototype pollution
- Impact in React apps
- Severity, false positives, verification

## Dynamic code sinks

```ts
eval(expr);  new Function('row', `return ${expr}`);  setTimeout(codeString, 0);  setInterval(codeString, 1000);
import(/* @vite-ignore */ userUrl);  new Worker(userUrl);  script.src = userUrl;  script.textContent = code;
React.lazy(() => import(`./widgets/${name}.tsx`))      // attacker picks which bundled module loads (limited), not arbitrary code
```

Trace the string to its source. Typical origins in React products: dashboard and report builders ("custom formula", "computed column", "filter expression"), low-code forms (`visibleIf`, `validate` strings in JSON schema), rule engines, template editors, CMS "custom script" fields, spreadsheet-like grids, query-string-driven views, translation or theme packs fetched from the API.

- Code that comes from the **backend per tenant/user and is run in other users' browsers** is stored XSS-equivalent: **High**.
- Code typed by the user and run only in their own browser is Low/Informational (self-attack), unless it can be delivered by link (`?formula=` in the URL), shared with others, or run server-side.
- Executed server-side (loader/action/Node): remote code execution, Critical.
- CSP without `'unsafe-eval'` blocks `eval`, `new Function` and string timers (MDN); a config-driven feature that requires `'unsafe-eval'` is a weakness in the CSP.

Expression libraries (`mathjs.evaluate`, `expr-eval`, `jexl`, `vm2`, `safe-eval`) are not a security boundary by default; several have had sandbox-escape advisories. Check the installed version's advisories, restrict the scope object, and prefer a small hand-written grammar (parse to an AST, evaluate an allow-list of operators and fields). `vm2` has a long history of sandbox escapes: do not accept it as a security boundary.

## Config-driven UIs

Safe pattern: JSON describes *what* (component type, field names, operators); code owns *how* through a fixed registry.

```tsx
const registry = { text: TextField, select: SelectField } as const;
function Field({ node }: { node: { type: keyof typeof registry; name: string } }) {
  const C = registry[node.type];
  return C ? <C name={node.name} /> : null;               // unknown types render nothing
}
```

Findings: `createElement(node.type, node.props)` with arbitrary strings, spreading `node.props` into elements (can carry `dangerouslySetInnerHTML`, `xss.md`), `dangerouslySetInnerHTML` for "rich label" config fields, `href`/`src`/`action` strings from config, and handlers built from strings (`onClick: new Function(node.onClick)`).

## Prototype pollution

Writing attacker-controlled keys into objects lets `__proto__`, `constructor.prototype` or `prototype` paths modify `Object.prototype`, after which unrelated code reads attacker-chosen "default" properties.

Sources to trace in React apps: `JSON.parse` of API, URL or `localStorage` data merged into state; query-string parsers that build nested objects (`a[b][c]=1`); form-data-to-object helpers; settings/preferences merge; i18n resource loaders; Redux reducers that spread untrusted keys; `Object.assign({}, userObj)` is shallow and safe from pollution, while recursive merges are not.

```ts
function merge(t: any, s: any) { for (const k in s) { typeof s[k] === 'object' ? merge(t[k] ??= {}, s[k]) : (t[k] = s[k]); } return t; }
merge(defaults, JSON.parse(params.get('prefs')!));          // finding: no key guard
_.merge(settings, input);  _.set(obj, path, value);  _.defaultsDeep(a, b);  // lodash: safe only on patched versions with vetted input
```

- Libraries: lodash needs the current release (4.18.1 on npm as of 2026-10-02; 2026 advisories fixed `_.template` injection CVE-2026-4800 and `_.unset`/`_.omit` pollution CVE-2026-2950 / CVE-2025-13465, all in 4.18.0 or 4.17.23 and later), `qs` (default `allowPrototypes: false`), `deepmerge`, `merge`, `set-value`, `dot-prop` and similar: check the installed version against npm advisories.
- Fix: skip `__proto__`, `constructor` and `prototype` keys, use `Object.create(null)` or `Map`, validate with a schema (zod strips unknown keys), `structuredClone`, and replace home-grown deep merges with a maintained one.

## Impact in React apps

- **Client-side gadgets:** pollution can alter library behavior. Example from DOMPurify: CVE-2026-41238 let a prior pollution gadget make DOMPurify 3.0.1 to 3.3.3 allow arbitrary custom elements and event handlers (fixed 3.4.0). So pollution plus a sanitizer is XSS.
- **Server-side (React Router framework mode, Node loaders/actions):** CVE-2026-42211 (react-router 7.0.0 to 7.14.1, fixed 7.14.2) chains an application prototype pollution bug into remote code execution on the server. Any recursive merge of request data (form fields, JSON bodies, cookies) in a loader/action: **High/Critical**; on a vulnerable router version: Critical.
- Denial of service (polluting `toString`/`length`), logic bypass (`isAdmin` read from polluted prototype).

## Severity, false positives, verification

- Pollution source reachable from the network with a gadget present (vulnerable library, or server-side RCE chain): High/Critical. Pollution with no demonstrated gadget: Medium/Low and state what would make it exploitable.
- **Not findings:** `eval`/`Function` in build tooling or config files (`vite.config.ts`) with constants; `new Function` generated at build time; `setTimeout(fn, 0)` with a function; `Object.assign`/spread of untrusted objects for shallow copies (but see `xss.md` for props spreads); `JSON.parse` of data that is only displayed as text.
- **Verify:** unit-test the merge/parse helper with a payload containing a `__proto__` key and assert `({}).polluted === undefined` afterwards. For expression features, test that only the allow-listed operators work and that identifiers such as `constructor`, `process` and `window` are rejected.

References: OWASP Prototype Pollution Prevention Cheat Sheet, Content Security Policy Cheat Sheet; CWE-1321, CWE-95, CWE-94; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src, https://github.com/remix-run/react-router/security/advisories/GHSA-49rj-9fvp-4h2h, https://github.com/lodash/lodash/security/advisories.
