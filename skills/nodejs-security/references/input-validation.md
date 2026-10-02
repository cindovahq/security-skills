# Node.js — Input Parsing, Validation, Mass Assignment and Prototype Pollution

## Contents
- What the parsers give you (Express 4 vs 5)
- Type confusion
- Validation libraries
- Mass assignment
- Prototype pollution
- False positives
- Verification

## What the parsers give you (Express 4 vs 5)

Verified against Express 4.22 and 5.2 source and behavior:

| | Express 4.x | Express 5.x |
|---|---|---|
| `query parser` setting default | `'extended'` (`qs`): `?user[$ne]=x` → `{ user: { $ne: 'x' } }` | `'simple'` (`node:querystring`): values are strings or arrays of strings; no nested objects; `req.query` has a null prototype |
| `express.urlencoded()` `extended` default | `true` in practice (deprecation warning when unset) | `false` (`querystring`); `{ extended: true }` opts back into `qs` nesting |
| `req.body` when no parser ran / content type didn't match | `{}` once body-parser is mounted, `undefined` otherwise | `undefined` |
| `req.query` | plain property | getter-only; assigning to it is silently ignored in sloppy mode and throws `TypeError` in strict mode/ES modules (sanitizers that reassign `req.query` don't work) |
| `req.param(name)` | merges params/body/query (deprecated) | removed |

`express.json()` always produces nested objects and arrays and keeps `__proto__` / `constructor` keys as own properties (`JSON.parse` behavior). Fastify's JSON parser rejects them by default; see `frameworks.md`.

Route params are URL-decoded: `GET /files/%2e%2e%2fsecret` gives `req.params.name === '../secret'`.

## Type confusion

Every value from `req.query`, `req.body` and headers can be a string, an array or (with `qs`/JSON) an object. Code written for strings breaks in security-relevant ways:

- **NoSQL operators:** `{ email: req.body.email }` with `{"email": {"$ne": null}}`. See `injection.md`.
- **Array tricks:** `?role=user&role=admin` → `['user','admin']`; `if (req.query.redirect.startsWith('/'))` throws on arrays (500/DoS) or `includes()` matches differently.
- **MySQL object expansion:** `mysql` / `mysql2 < 3.17.0` (sqlstring) expand a plain object passed as a `?` value into `` `key` = 'value' `` pairs, so `{"password": {"password": 1}}` turns `password = ?` into `` password = `password` = 1 `` (always true). mysql2 ≥ 3.17.0 (sql-escaper) stringifies objects outside `SET` and `ON DUPLICATE KEY UPDATE` clauses. Fix: validate types, or set `stringifyObjects: true`.
- **Loose comparisons:** `token == req.query.token` with arrays/numbers; `parseInt` on IDs accepting `1abc`.
- **Length/size:** a 10 MB string sent to `bcrypt`, a regex, or a template.

**Fix:** validate shape and type at the boundary with a schema, then use only the validated output.

## Validation libraries

- zod (`schema.parse(req.body)` / `safeParse`; objects strip unknown keys by default, `.strict()` rejects them, `.passthrough()`/`.loose()` keeps them → review), joi (`stripUnknown`, `allowUnknown`), yup, valibot, `express-validator` (`matchedData(req)` returns only validated fields; using `req.body` afterwards bypasses it), AJV / Fastify JSON schema (`additionalProperties: false`; Fastify's default AJV config uses `removeAdditional: true`, which only strips properties when the schema sets `additionalProperties: false`).
- TypeScript types are compile-time only. `req.body as CreateUserDto` validates nothing.
- Check that validation runs on every route variant (PUT and PATCH, bulk endpoints, GraphQL inputs, WebSocket messages).

## Mass assignment

```js
await db.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
  [email, hash, req.body.role ?? 'member']);                 // client chooses role
await User.create(req.body);                                 // Mongoose/Sequelize: every schema field settable
await prisma.user.update({ where: { id }, data: req.body }); // Prisma: role, tenantId, emailVerified...
Object.assign(user, req.body); await user.save();
```

Fix: pick allowed fields explicitly (`const { name, bio } = parsed.data`), or use a schema that omits privileged fields. Severity: privilege field (role, isAdmin, tenant, balance, verified) settable by a normal user → **High/Critical**.

## Prototype pollution

**Sinks:** recursive merge/clone/set utilities applied to user-controlled objects or paths:

```js
function merge(target, src) {               // hand-rolled: classic sink
  for (const k in src) typeof src[k] === 'object' ? merge(target[k] ??= {}, src[k]) : (target[k] = src[k]);
}
merge(settings, req.body);                  // {"__proto__": {"isAdmin": true}}
setPath(obj, req.body.path, req.body.value); // "constructor.prototype.isAdmin"
```

Also: old versions of lodash (several `merge`/`defaultsDeep`/`zipObjectDeep` prototype-pollution CVEs before 4.17.21; `unset`/`omit` CVE-2025-13465 and its array-path bypass CVE-2026-2950, fully fixed in 4.18.0; `_.template` imports code injection CVE-2026-4800 fixed in 4.18.0), `deep-extend`, `merge`, `dot-prop`, `set-value`, `flat`/`unflatten`, unpatched `qs` (CVE-2022-24999, a `__proto__` DoS fixed in 6.10.3 and backports; Express 4.17.3 picked up the fix). Current lodash 4.18 `merge`/`set` skip `__proto__` and `constructor.prototype` (verified).

**Impact (gadgets):** a polluted `Object.prototype` property is inherited by every plain object in the process until restart:
- Authorization checks on plain objects (`if (user.isAdmin)`, `if (opts.allowAll)`) → privilege escalation.
- Options objects read by libraries: template engine compile options (EJS/Pug/Handlebars historically → RCE), HTTP client options (axios published several "prototype pollution gadget" advisories in September 2026). Current Node lines ignore an inherited `shell` option in `child_process.spawn` (tested on Node 24), but third-party wrappers that build options objects may not.
- DoS: polluting `toString`/`hasOwnProperty`-like names crashes request handling for everyone.

Severity: confirmed pollution reachable by a normal user → **High**; with an auth or RCE gadget → **Critical**. Pollution only via admin-controlled config → Low/Medium.

**Fix:**
- Don't deep-merge request bodies. Validate with a schema and copy known keys.
- Block `__proto__`, `constructor`, `prototype` keys in any path/merge utility; use `Object.create(null)` or `Map` for dictionaries keyed by user input; read with `Object.hasOwn()`.
- `structuredClone`/`JSON.parse(JSON.stringify())` do not remove `__proto__` own keys; validation must.
- `node --disable-proto=delete` removes the `__proto__` accessor (defense-in-depth; `constructor.prototype` paths still work).
- Note: `Object.assign({}, polluted)` or `{...obj}` doesn't pollute globally, but `Object.assign` with an own `__proto__` key replaces the target's prototype.

## False positives

- `req.query.x` used in a Mongo filter on **Express 5** with the default `simple` parser: it can't be an object (arrays are still possible; check `$in`-like semantics).
- lodash ≥ 4.17.21 `merge`/`set` on user input: the known `__proto__`/`constructor.prototype` paths are blocked. Still a validation smell.
- `JSON.parse(body)` alone: creates an own `__proto__` property but pollutes nothing until a merge/assign sink uses it.

## Verification

```js
it('does not pollute Object.prototype via settings merge', async () => {
  await agent.patch('/api/settings').send(JSON.parse('{"__proto__":{"polluted":"yes"}}'));
  expect(({}).polluted).toBeUndefined();
});
it('ignores privileged fields', async () => {
  await agent.patch('/api/profile').send({ name: 'x', role: 'admin' }).expect(200);
  expect((await getUser()).role).toBe('member');
});
```

References: OWASP Mass Assignment and Prototype Pollution Prevention Cheat Sheets, Input Validation Cheat Sheet; CWE-1321, CWE-915, CWE-20, CWE-843; https://expressjs.com/en/guide/migrating-5.html, https://github.com/sidorares/node-mysql2, https://github.com/lodash/lodash/security/advisories.
