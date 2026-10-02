# Node.js — Injection, Code Execution and Deserialization

## Contents
- SQL injection by driver and ORM
- NoSQL injection (MongoDB / Mongoose)
- OS command and argument injection
- Code execution (`eval`, `Function`, `vm`)
- Unsafe deserialization
- XML (XXE)
- HTTP header and response splitting
- Other sinks
- Verification

Trace **source → sink** for every candidate: request params/query/body/headers/cookies, uploaded file names and contents, webhook payloads, queue messages, and data stored earlier by another user. Template injection lives in `xss-templates.md`, path traversal in `files-paths.md`, ReDoS in `api-security.md`.

## SQL injection by driver and ORM

| Library | Dangerous | Safe |
|---|---|---|
| `pg` | ``client.query(`... WHERE id = ${id}`)``, `'...' + x` | `client.query('... WHERE id = $1', [id])` |
| `mysql2` / `mysql` | `query("... '" + x + "'")`, `format()` output concatenated later | `execute('... = ?', [x])` / `query('... = ?', [x])` with scalar-validated values (see object expansion in `input-validation.md`) |
| Knex | `knex.raw(\`...${x}\`)`, `whereRaw(str)`, `orderByRaw(str)` | `knex.raw('... ?', [x])`, `??` for identifiers, `.where({ id })` |
| Sequelize | `sequelize.query('...' + x)`, `Sequelize.literal(x)`, `fn`/`col` with input | `replacements` / `bind`; `replacements` + `where` together was SQLi before 6.19.1 (CVE-2023-25813) |
| TypeORM | `query(str)`, `.where(\`id = ${id}\`)`, `.orderBy(input)` | `.where('id = :id', { id })` |
| Prisma | `$queryRawUnsafe(str)`, `$executeRawUnsafe(str)`, `Prisma.raw(input)`, building the tagged template from strings | `` $queryRaw`... ${x}` `` tagged template, `Prisma.sql`, `Prisma.join` |
| Drizzle | `sql.raw(input)` | `` sql`... ${x}` `` |

**Identifiers can't be bound.** `ORDER BY ${req.query.sort}`, dynamic column/table names, `LIMIT ${n}` and sort direction need an allow-list (`const cols = { date: 'created_at', total: 'amount' }`). Sorting by a hidden column (`password_hash`, `reset_token`) leaks it by inference even when quoting blocks classic injection.

Severity: unauthenticated SQLi → **Critical**; authenticated → **High**; admin-only → Medium/High depending on DB privileges.

## NoSQL injection (MongoDB / Mongoose)

```js
User.findOne({ email: req.body.email, password: req.body.password });   // {"password":{"$ne":null}}
Note.findOne({ shareToken: req.body.token });                            // {"token":{"$ne":null}} → first shared note
Model.find(req.body.filter);                                             // arbitrary operators incl. $where/$expr
collection.find({ $where: `this.owner == '${req.query.u}'` });           // server-side JS
```

- Sources: JSON bodies always; query strings only with a nesting parser (Express 4 default `qs`, Express 5 with `query parser: 'extended'`, Koa `qs`-based parsers). See `input-validation.md`.
- Mongoose `sanitizeFilter` (`mongoose.set('sanitizeFilter', true)` or per query): wraps nested objects with `$`-keys in `$eq` and throws on `$where`, `$expr`, `$jsonSchema`, `$text`. Off by default. Use `mongoose.trusted()` for intentional operators.
- Mongoose `strictQuery` defaults to `false` (since 7): filter keys not in the schema pass through to MongoDB. Not a vulnerability alone, but it widens what an attacker-controlled filter can query.
- Mongoose < 8.9.5 / 7.8.4 / 6.13.6: `$where` reachable through `populate({ match })` (CVE-2024-53900, CVE-2025-23061). Upgrade.
- Fix: cast to scalars (`String(req.body.email)`), validate with a schema, never pass whole request objects as filters, avoid `$where`/`mapReduce`/`$function` with input.

Severity: auth bypass or cross-user read → **High/Critical**; `$where` with input → **High** (server-side JS, DoS).

## OS command and argument injection

`child_process.exec`/`execSync` always use a shell; `spawn`/`execFile`/`execFileSync` use one only with `shell: true`. Node's docs warn never to pass unsanitized input when a shell is used.

```js
exec(`wkhtmltopdf ${req.query.url} out.pdf`);                // shell metacharacters → RCE
spawn('convert', [input, out], { shell: true });              // shell again
execFile('git', ['clone', req.body.repo, dir]);               // argument injection: --upload-pack=...
execFile('gs', ['-q', '-sDEVICE=png16m', '-o', out, '--', input]); // safe pattern
```

- Argument injection: values starting with `-` become options (`git --upload-pack`, `curl -o`, `tar --checkpoint-action`, `ssh -oProxyCommand`, `find -exec`, ImageMagick/ffmpeg protocol handlers). Use `--` before positionals and validate format.
- Windows: `.bat`/`.cmd` files always run through `cmd.exe`, whose argument parsing can't be escaped safely (CVE-2024-27980, "BatBadBut"). Since the April 2024 security releases, spawning them without `shell: true` fails with `EINVAL`, so code that runs batch files uses a shell. Treat batch invocations with input as shell injection.
- Wrappers: `shelljs.exec`, `execa` with `{ shell: true }` or `execaCommand`, `zx` (`$` template escapes arguments; `$.quote` misuse or `$({ shell })` changes that), `node-cmd`, `child_process` calls inside image/PDF/video helpers.

Severity: reachable command injection → **Critical** (CWE-78); argument injection → High/Critical depending on the binary.

## Code execution (`eval`, `Function`, `vm`)

- `eval`, `new Function(str)`, `setTimeout(str)`/`setInterval(str)`, `vm.runInNewContext`, `vm.Script`, `require(userPath)`, dynamic `import(userPath)` with input → RCE.
- **`node:vm` is not a security mechanism** (Node docs: "Do not use it to run untrusted code"). `vm2` has a long history of sandbox escapes (CVE-2023-37466 and CVE-2023-37903 led to its 2023 discontinuation; it was revived in late 2025 but keeps receiving sandbox-escape advisories in 2026) and should not be treated as a strong boundary. For untrusted code use a separate process/container with OS-level isolation, or `isolated-vm` with care.
- Formula/expression evaluators (`mathjs` `evaluate`, `expr-eval`, `safe-eval`, JSONata, json-logic) have their own escape histories: check advisories for the installed version.
- `node --disallow-code-generation-from-strings` makes `eval`/`new Function` throw (does not affect `node:vm`). Hardening option.

## Unsafe deserialization

- `node-serialize` `unserialize()` executes functions marked `_$$ND_FUNC$$_` and supports immediately-invoked payloads (CVE-2017-5941) → **Critical** RCE with any client-controlled input (cookies, hidden fields). Also `funcster`, `serialize-to-js` (old), `cryo`.
- `serialize-javascript` output is meant to be evaluated (`eval`) on the client: fine for trusted server data, never for evaluating user-supplied strings on the server.
- YAML: `js-yaml` 4 `load()` is safe by default (the unsafe `!!js/function` types moved out in 4.0); `js-yaml` 3 `load()` with the full schema was not. Check the version.
- `JSON.parse` + `Object.assign`/merge → prototype pollution, not RCE by itself (see `input-validation.md`).
- Fix: JSON with schema validation; sign data you must round-trip through the client (HMAC), and still validate.

## XML (XXE)

- `libxmljs`/`libxmljs2` `parseXml(xml, { noent: true })` turns on entity substitution → XXE (file read, SSRF). Keep `noent` off and `nonet: true`; verify defaults for the installed version.
- `xmldom`/`@xmldom/xmldom`, `xml2js` (sax-based) and `fast-xml-parser` don't fetch external entities, but check entity-expansion and depth limits (billion-laughs style DoS) and keep them patched.
- SAML libraries (`passport-saml`/`@node-saml/node-saml`, `samlify`, `xml-crypto`) have had signature-wrapping and comment-injection bypasses: version-check and use current releases.

## HTTP header and response splitting

Node's `http` rejects CR/LF in header values (`ERR_INVALID_CHAR`), so classic response splitting via `res.setHeader(name, userValue)` throws (unhandled → 500, or a crash in some code paths). Remaining issues:
- User input as the header **name** or in `Content-Disposition` without quoting (use `res.attachment(name)` / `content-disposition`).
- `res.redirect(userValue)` / `Location` → open redirect (see `ssrf-redirects.md`).
- Logs: newline injection into log lines (Low).

## Other sinks

- LDAP filters (`ldapjs`, `ldapts`): escape filter values per RFC 4515 or build filter objects instead of concatenating strings.
- GraphQL: string-built queries to downstream services; resolvers passing args into raw SQL.
- Redis: `EVAL` scripts built with concatenation; `redis.sendCommand(userArray)`.
- Email header injection in hand-built SMTP/MIME code (user input in `Subject`/address headers with newlines).
- CSV/formula injection in exports (Low).

## Verification

```js
it('treats sort as an allow-listed identifier', async () => {
  await agent.get('/invoices?sort=amount;select pg_sleep(0)').expect(400);   // or falls back to default sort
});
it('rejects operator objects in login', async () => {
  await request(app).post('/api/share/open').send({ token: { $ne: null } }).expect(400);
});
it('does not run a shell', async () => {
  const spy = vi.spyOn(child_process, 'execFile');
  await agent.get('/invoices/1/pdf?title=a;id').expect(200);
  expect(spy.mock.calls[0][1]).toContain('a;id');   // passed as one argument
});
```

Use benign markers only. Never run destructive payloads, time-based payloads against shared databases, or commands with side effects.

References: OWASP SQL Injection Prevention, Query Parameterization, OS Command Injection Defense, Deserialization, NodeJS Security Cheat Sheets; CWE-89, CWE-943, CWE-78, CWE-88, CWE-94, CWE-95, CWE-502, CWE-611, CWE-113; https://nodejs.org/api/child_process.html, https://nodejs.org/api/vm.html, https://mongoosejs.com/docs/api/mongoose.html#Mongoose.prototype.sanitizeFilter(), https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries.
