# Injection, Deserialization and Path Traversal

## Contents
- Method
- SQL injection
- NoSQL injection
- OS command and argument injection
- Code and template injection
- Insecure deserialization
- Path traversal and file inclusion
- XML (XXE)
- Other injection classes
- Verification

## Method

Trace **source → sink**. Sources: request params/body/headers/cookies, route params, uploaded file contents and names, data from other users stored earlier, webhook payloads, message queues, third-party API responses, LLM output. A sink is dangerous only if attacker-influenced data reaches it **without** the right control for that sink (binding, escaping, allow-list).

## SQL injection

Dangerous: string building of SQL with untrusted data.

| Ecosystem | Dangerous | Safe |
|---|---|---|
| Node (pg/mysql2) | ``query(`SELECT ... ${id}`)`` | `query('SELECT ... WHERE id = $1', [id])` |
| Sequelize | `sequelize.query("..." + x)`, `literal(x)` | `replacements`/`bind` |
| Prisma | `$queryRawUnsafe(str)`, `$executeRawUnsafe` | `` $queryRaw`... ${x}` `` (tagged template binds) |
| TypeORM / Knex | `.query(str)`, `whereRaw(str)`, `raw(str)` | `.where('id = :id', { id })`, `whereRaw('id = ?', [x])` |
| Django | `raw(f"...")`, `extra(where=[...])`, `RawSQL(f"...")`, `cursor.execute(f"...")` | `cursor.execute("... %s", [x])`, ORM filters |
| SQLAlchemy | `text(f"...")`, `execute(f"...")` | `text("... :x").bindparams(x=...)` |
| Java | `Statement` + concatenation; JPA `createQuery("..."+x)` | `PreparedStatement`, named params |
| .NET | `FromSqlRaw($"...{x}")`, `ExecuteSqlRaw` with interpolation | `FromSqlInterpolated`, `FromSql` (parameterized), `SqlParameter` |
| Go | `db.Query("..." + x)`, `fmt.Sprintf` into SQL | `db.Query("... $1", x)` |
| Rails | `where("name = '#{x}'")`, `order(params[:sort])`, `find_by_sql` with interpolation | `where(name: x)`, `where("name = ?", x)` |

**Identifiers** (column/table names, `ORDER BY`, `LIMIT`) can't be bound. Allow-list them. Sorting/filtering on arbitrary columns can leak hidden columns (password hashes) by inference, even when quoting prevents classic injection.

## NoSQL injection

- MongoDB: request bodies parsed as objects let `{"password": {"$ne": null}}` reach `find()`. Validate types as scalars, cast (`String(x)`), or use `mongo-sanitize`/`sanitizeFilter` (Mongoose `sanitizeFilter: true`).
- `$where`, `$function`, `mapReduce` with user input → server-side JS execution.
- Elasticsearch `query_string` with raw input (query syntax injection, expensive queries). Use `simple_query_string` or term queries.
- Redis commands built from input (`EVAL` scripts with concatenation).

## OS command and argument injection

Dangerous: shells with interpolated input. `exec`, `system`, `popen`, Node `child_process.exec`/`execSync`, `spawn(..., { shell: true })`, Python `os.system`, `subprocess.*(..., shell=True)`, Ruby backticks/`system(str)`/`%x`, Java `Runtime.exec(String)` with `sh -c`, Go `exec.Command("sh", "-c", str)`, PHP `shell_exec`.

Safe: argument arrays without a shell (`execFile`, `spawn(cmd, args)`, `subprocess.run([...])`, `ProcessBuilder(List)`, `exec.Command(bin, args...)`).

**Argument injection still applies** with arrays: values starting with `-` become options (`git` `--upload-pack=`, `curl -o`, `tar --checkpoint-action`, `ssh -oProxyCommand`). Insert `--` before positional args and validate format.

## Code and template injection

- `eval`, `new Function`, `vm.runInContext` (not a security boundary), Python `eval`/`exec`, Ruby `eval`/`instance_eval`/`send(params[:m])`, PHP `eval`, Java ScriptEngine, dynamic `require`/`import` of user-controlled paths.
- **SSTI:** user input as the **template** (not as data) in Jinja2 (`Template(user_str).render()`, `render_template_string`), Twig, Freemarker, Velocity, Thymeleaf (fragment expressions in view names: `return "user/" + lang`), Handlebars/EJS/Pug compile of user strings, Blade `Blade::render`, Go `text/template` with user templates → usually RCE.
- Expression languages: Spring SpEL (`parser.parseExpression(userInput)`), OGNL, MVEL, JEXL.
- Unsafe reflection: `Class.forName(input)`, `getattr(obj, input)()`, `obj[req.body.method]()`.

## Insecure deserialization

Native object deserialization of untrusted data → RCE via gadget chains:
- Java `ObjectInputStream.readObject`, XMLDecoder, XStream (old versions), Jackson with default typing (`enableDefaultTyping`, `@JsonTypeInfo(use = Id.CLASS)`), SnakeYAML `new Yaml().load` (pre-2.0 default constructor).
- .NET `BinaryFormatter`, `NetDataContractSerializer`, `LosFormatter`, `ObjectStateFormatter`, Json.NET `TypeNameHandling` ≠ `None`.
- Python `pickle`/`cPickle`/`dill`/`joblib.load` on untrusted data (including ML model files from untrusted sources), `yaml.load` without `SafeLoader`, `shelve`.
- PHP `unserialize`; Ruby `Marshal.load`, `YAML.load` (Psych < 4 unsafe by default; use `safe_load`).
- Node: `node-serialize`, `serialize-javascript` misuse, `funcster`.

Fix: use data-only formats (JSON) with schema validation; restrict allowed classes (`ObjectInputFilter`, `allowed_classes`); sign payloads (an HMAC proves origin, not safety, once the key leaks).

## Path traversal and file inclusion

- User input in filesystem paths: `path.join(base, input)` doesn't prevent `../` (or absolute paths: `path.join('/base', '/etc/passwd')` → `/base/etc/passwd`, but `path.resolve` with an absolute input escapes). Python `os.path.join(base, '/etc/passwd')` returns `/etc/passwd`.
- Fix: resolve the canonical path (`realpath`), then check it starts with the canonical base directory plus a separator. Or don't use client paths at all: map IDs to stored paths.
- Encoded variants: `%2e%2e%2f`, `..%2f`, `..\`, double encoding, Unicode normalization, null bytes (older runtimes).
- Archive extraction (zip slip): entry names containing `../` or absolute paths. Validate each entry's resolved path.
- File inclusion: PHP `include($input)`, Node `require(input)`, `res.render(req.query.view)`, `send_file`/`sendFile` with user paths (Express `res.sendFile` needs the `root` option).

## XML (XXE)

- External entity expansion in XML parsers: Java (`DocumentBuilderFactory`, `SAXParserFactory`, `XMLInputFactory`) is **unsafe by default**. Set `disallow-doctype-decl` / `FEATURE_SECURE_PROCESSING`. .NET modern defaults are safe (`XmlReaderSettings.DtdProcessing = Prohibit`). Python `xml.etree` is safe from external entities but not from billion laughs; use `defusedxml`. PHP 8+ (libxml ≥ 2.9) doesn't load external entities unless `LIBXML_NOENT`/`LIBXML_DTDLOAD` is passed.
- Hidden XML inputs: SVG, DOCX/XLSX (zip of XML), SAML, SOAP, RSS imports.

## Other injection classes

- **LDAP:** escape filter values (`ldap_escape`, Spring LDAP `LdapEncoder`).
- **XPath/XQuery:** parameterize or escape.
- **Header / CRLF:** user input in response headers or `Location` (most modern frameworks reject CR/LF). Log injection with newlines.
- **Email header injection** with custom SMTP code.
- **CSV/formula injection** in exports: prefix `= + - @ \t \r` with `'`.
- **ReDoS:** user-controlled regex patterns, or catastrophic patterns (`(a+)+$`) applied to user input. Use RE2/linear-time engines or length limits.
- **Prototype pollution (JS):** recursive merge/`set` with user keys (`__proto__`, `constructor.prototype`) → logic bypass or RCE gadgets. Use `Object.create(null)` maps, block those keys, and keep lodash etc. updated.
- **Server-side prompt injection:** see `llm-security.md`.

## Verification

- Unit/integration tests sending benign payloads (`' OR '1'='1`, `{"$ne":null}`, `;id`, `../../etc/hosts`, `{{7*7}}`) that assert the input is handled as data (no extra rows, literal `{{7*7}}` rendered, 400/404 on traversal).
- Taint-analysis tools (CodeQL, Semgrep, Psalm, Bandit, Brakeman, SpotBugs/Find Security Bugs) to sweep for siblings. Treat output as leads.
- Never use destructive payloads or time-based payloads against shared environments.

References: OWASP Injection Prevention, SQL Injection Prevention, Query Parameterization, OS Command Injection Defense, Deserialization, XXE Prevention, File Upload, Prototype Pollution Prevention Cheat Sheets; CWE-77, CWE-78, CWE-88, CWE-89, CWE-94, CWE-502, CWE-611, CWE-22, CWE-943, CWE-1321, CWE-1333, CWE-1336.
