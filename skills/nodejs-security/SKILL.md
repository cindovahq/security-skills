---
name: nodejs-security
description: Security review and secure-coding guidance for Node.js server applications built with Express 4/5, Fastify, Koa, Hono on Node, or plain node:http, in JavaScript or TypeScript. Use when auditing, reviewing, pentest-prepping or hardening a Node.js backend or API, or when writing or changing its routes, middleware, authentication, sessions, JWT handling, database queries, templates, file uploads, outbound HTTP calls or server configuration. Triggers on projects whose package.json depends on express, fastify, koa, hono or @hono/node-server, or that contain server.js, app.js or index.ts files creating an HTTP server. Covers authentication, authorization and IDOR, middleware ordering, sessions and cookies, CSRF, CORS, input validation and mass assignment, prototype pollution, SQL, NoSQL and command injection, SSTI and render-options injection, XSS, path traversal, uploads, SSRF, open redirects, trust proxy, secrets and error leaks, DoS limits and ReDoS, npm supply chain, and fix verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "Node.js 22 and 24 LTS (26 Current); Express 4.x and 5.x; Fastify 5.x; Koa 3.x; Hono 4.x"
  last-verified: "2026-10-02"
---

# Node.js Security

Find, explain, fix and verify security issues in Node.js server applications (Express, Fastify, Koa, Hono, `node:http`), and write new server code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: the user asks for an audit, security review, pentest prep, or "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: you are writing or modifying Node server code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change and load only the reference for the area you're touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format; this skill supplies Node-specific knowledge. Otherwise use the [evidence and reporting rules](#evidence-and-reporting-rules) below. For Next.js apps use `nextjs-security`; for NestJS use `nestjs-security` (Express/Fastify findings under Nest still apply here).

## Review workflow

### 1. Confirm the stack and versions

1. Read `package.json` and the **lockfile** (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) for installed versions of the framework and security-relevant packages: `express`, `fastify`, `koa`, `hono`, `@hono/node-server`, `express-session`, `cookie-parser`, `passport`, `jsonwebtoken`, `jose`, `bcrypt`/`argon2`, `cors`, `helmet`, `express-rate-limit`, `csurf`/`csrf-csrf`, `multer`, `pg`/`mysql2`/`knex`/`sequelize`/`typeorm`/`@prisma/client`/`mongoose`, `ejs`/`pug`/`handlebars`/`nunjucks`, `axios`/`got`, `lodash`, `node-serialize`, `path-to-regexp`.
2. Find the runtime: Dockerfile `FROM node:..`, `.nvmrc`, `engines`, platform config. On 2026-10-02: **24 Active LTS, 22 Maintenance LTS, 26 Current; 20 and 25 are EOL**. Check the patch level against the latest security releases (see `references/dependencies.md`).
3. Identify the Express major. **Express 5** changes defaults that matter: `query parser` `'simple'` (no nested objects), `req.body` `undefined` without a parser, async errors forwarded, `dotfiles` ignored including dot-directories, `req.param` and `redirect('back')` removed. Upgraded apps may re-enable old behavior (`app.set('query parser', 'extended')`).
4. Find the entry point (`src/server.js`, `app.js`, `index.ts`, `main.ts`) and note `NODE_ENV` handling, `trust proxy`, global middleware and error handlers.

### 2. Map the attack surface

- List every router/plugin and **where it is mounted relative to auth middleware** (registration order is execution order in Express, Koa and Hono; Fastify uses plugin encapsulation).
- Entry points beyond HTTP routes: WebSocket/Socket.IO events, GraphQL resolvers, webhooks, queue consumers, cron jobs, CLI scripts.
- Flag: unauthenticated routes, admin routes, anything taking an ID, URL, path, filename, sort field, template, HTML, or a whole request object.

### 3. Review each area

Load the reference for each area as you reach it. Don't load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| Authentication & JWT | `references/authentication.md` | `jwt.decode`, `jwt.verify` without `algorithms`, fallback secrets, password hashing, reset tokens from `Math.random`, `req.body.role` at signup, login limiters |
| Authorization / IDOR | `references/authorization.md` | Routers mounted before `requireAuth`, `WHERE id = $1` without owner, role from unverified sources, Fastify plugin encapsulation, Express 4 async middleware |
| Sessions & cookies | `references/sessions-cookies.md` | `session({ secret })`, `cookie.secure/httpOnly/sameSite`, no `regenerate()` on custom login, logout without `destroy()`, `req.cookies` vs `req.signedCookies` |
| CSRF & CORS | `references/csrf-cors.md` | Cookie auth without CSRF defense, `csurf`, `cors({ origin: true, credentials: true })`, unanchored origin regex, `@koa/cors` with `credentials` |
| Input & prototype pollution | `references/input-validation.md` | `query parser` setting, objects where strings are expected, `create(req.body)`, deep merge of bodies, `__proto__` handling, `mysql2` object expansion |
| Injection & deserialization | `references/injection.md` | Template-literal SQL, `$queryRawUnsafe`, `ORDER BY ${...}`, Mongo filters from bodies, `exec(`, `shell: true`, `eval`/`vm`, `node-serialize`, `noent: true` |
| XSS & templates | `references/xss-templates.md` | `<%-`, `!{}`, `{{{`, `JSON.stringify` in `<script>`, `res.send(userString)`, `ejs.render(userTemplate)`, `res.render(view, req.body)` |
| SSRF & redirects | `references/ssrf-redirects.md` | `fetch(req.body.url)`, axios `baseURL` with absolute input, headless browsers, `res.redirect(req.query.next)` |
| Files, paths & uploads | `references/files-paths.md` | `path.join(base, input)`, `res.sendFile`/`res.download` without `root`, `express.static` scope, multer `originalname`, missing `limits`, zip extraction |
| Secrets, errors & proxies | `references/secrets-config.md` | `process.env.X \|\| 'secret'`, committed `.env`, `NODE_ENV`, error handlers returning `err.stack`, `trust proxy: true`, helmet overrides, logging bodies, `Math.random` tokens |
| APIs & availability | `references/api-security.md` | Whole-row `res.json`, missing Fastify response schemas, body limits, timeouts, unhandled rejections, ReDoS, webhooks raw-body signatures, WebSocket auth, GraphQL limits |
| Framework specifics | `references/frameworks.md` | Express 4→5 differences, Fastify hooks/schemas/parsers, Koa `app.proxy`/`expose`, Hono middleware, `node:http` |
| Dependencies & supply chain | `references/dependencies.md` | EOL Node lines, outdated framework/libraries, `npm audit`, install scripts, lockfiles, recent npm compromises |
| Verification | `references/verification.md` | How to prove each finding and each fix |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation, including the middleware that runs before it. Classify using the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses the framework's own mechanism (the `root` option, a parameterized query, a schema, middleware order). Then verify with `references/verification.md`: the attack fails, legitimate use still works, and sibling instances of the pattern are fixed.

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# Auth / sessions
jwt.decode(   jwt.verify( without algorithms   ignoreExpiration   || 'secret'   ?? 'changeme'   'keyboard cat'
req.session.userId =  (without regenerate)   saveUninitialized: true   secure: false   httpOnly: false
req.cookies.role   req.headers['x-user-id']   Math.random()  (tokens)   createHash('md5'|'sha1'|'sha256') on passwords

# Authorization / ordering
app.use('/...', router) before app.use(requireAuth)   router.get('/:id' ... WHERE id = $1   findById(req.params.id)
user.isAdmin on plain objects   catch (e) { next() }   res.status(403) without return   async (req, res) in Express 4

# Injection / RCE
query(`...${   $queryRawUnsafe(  $executeRawUnsafe(  Prisma.raw(  knex.raw(`  whereRaw(`  Sequelize.literal(  sql.raw(
ORDER BY ${   .find(req.body   .findOne({ ...: req.body.   $where   query parser', 'extended'   urlencoded({ extended: true })
exec(  execSync(  shell: true   new Function(  eval(  vm.run   require(req.   unserialize(  node-serialize   noent: true

# Templates / XSS
<%-   !{   !=   {{{   SafeString(   autoescape: false   JSON.stringify(...) inside <script>
res.send(`...${req.   ejs.render(req.   compile(req.   res.render(..., req.body|req.query|{...req.body})   res.render(req.query

# Prototype pollution
merge(  deepMerge(  extend(true,  _.merge(  _.set(  _.defaultsDeep(  setPath(  Object.assign(target, req.body)  for (const k in src)

# Files / SSRF / redirect
path.join(..., req.   res.download(   res.sendFile( without root   express.static(__dirname)   dotfiles: 'allow'
file.originalname   multer({ dest   limits missing   fetch(req.   axios.get(req.   got(req.   page.goto(   res.redirect(req.

# Config / DoS
trust proxy', true   trustProxy: true   cors({ origin: true   credentials: true   err.stack   NODE_ENV   --inspect
limit: '50mb'   requestTimeout: 0   new RegExp(req.   rejectUnauthorized: false   console.log(req.body
```

## Common false positives

Do not report these without further evidence:

- **Express 5 `async` handlers without `try/catch`.** Express 5 forwards rejected promises to the error handler. (In Express 4 the same code is a finding.)
- **`req.query.x` used in a Mongo filter on Express 5 with the default `simple` query parser.** It can't be an object. JSON bodies still can.
- **`execFile`/`spawn` with an argument array and no `shell: true`**, with `--` before user-supplied positionals or validated values. No shell runs, so this isn't command injection.
- **Parameterized queries** (`pg` `$1`, `mysql2` `?` with scalar values, Knex/Sequelize bindings, Prisma tagged `$queryRaw`).
- **`<%= %>`, `#{}`, `{{ }}` output** and `<%- include(...) %>`.
- **`res.sendFile(name, { root: dir })`** and **`path.resolve` + `startsWith(base + path.sep)`** checks.
- **Passport ≥ 0.6 `req.login()` without explicit `regenerate()`.** Passport regenerates the session itself.
- **`jwt.verify` with pinned `algorithms`**, or `jose` `jwtVerify` (which refuses `alg: none`).
- **`cors()` defaults (`*`, no credentials) on a bearer-token or public API.**
- **Webhook routes without CSRF/auth that verify a provider HMAC over the raw body** with `timingSafeEqual`.
- **`fetch` to a fixed host** where input only fills an `encodeURIComponent`-encoded path segment or query value.
- **Placeholder values and `NODE_ENV=development` in `.env.example`.**
- **`X-Powered-By: Express`** alone is Informational, not a vulnerability.

## Severity calibration

| Pattern | Typical severity |
|---|---|
| RCE: command injection, `node-serialize`, SSTI, EJS render-options injection, `eval` of input | Critical (High if only admins of a single-tenant app can reach it) |
| Auth bypass: `jwt.decode` trust, forgeable secrets, role from signup body | Critical |
| SQL/NoSQL injection | Critical unauthenticated; High authenticated |
| IDOR / missing function-level authorization | High (Critical across tenants or for writes on sensitive data) |
| Prototype pollution reachable by users | High; Critical with an auth or RCE gadget in the codebase |
| Path traversal read / arbitrary write | High / Critical |
| CORS reflection with credentials on authenticated data | High |
| SSRF returning responses | High (Critical if cloud metadata credentials are reachable) |
| Stored XSS reaching other users | High; reflected XSS Medium |
| Missing CSRF on cookie-auth state changes | Medium (High for email/password change, payments, admin) |
| Session fixation, IP-spoof rate-limit bypass, stack traces in responses | Medium |
| Open redirect alone, missing headers, `X-Powered-By` | Low / Hardening / Info |

Common under-ratings to avoid:
- **Unhandled rejections in Express 4 handlers** reachable without auth crash the whole process. Rate them as DoS (Medium/High), not code style.
- **`trust proxy: true` + IP-keyed limiter on login/OTP** makes brute-force protection ineffective. Medium, High on OTP/MFA.
- **Prototype pollution "with no gadget found"** is still High when any plain-object authorization check (`user.isAdmin`) or template engine exists in the process.

## Build-mode guardrails

When writing Node server code, default to:

1. **Validate every input with a schema** (zod/valibot/joi, Fastify JSON Schema with `additionalProperties: false`) and use only the parsed output. Never pass `req.body`/`req.query` whole into ORMs, filters, `res.render`, merges or `Object.assign`.
2. **Authenticate before routing.** Register auth middleware before routers; in Fastify add auth hooks in the encapsulation context of the routes. Authorize every object access by scoping queries with the user/tenant from the session or verified token.
3. **Parameterize all SQL**; allow-list identifiers and sort fields. Cast Mongo filter values to scalars or enable `sanitizeFilter`.
4. **No shells:** `execFile`/`spawn` with argument arrays, `--` before positionals, no `shell: true`. No `eval`, `new Function`, `vm` or code-executing deserializers on input.
5. **Templates:** escaped output only (`<%= %>`); render with an explicit locals object; never compile user-supplied templates; escape `<` when embedding JSON in `<script>`.
6. **Files:** serve with `res.sendFile(name, { root })` or by stored ID; uploads get random names, size/count limits, content checks, and a non-public directory or separate origin.
7. **Outbound requests:** allow-list hosts, block private ranges at connect time, disable or re-check redirects, set timeouts; `allowAbsoluteUrls: false` for axios instances with `baseURL`.
8. **Sessions & tokens:** secrets from the environment with startup checks (no fallbacks); `cookie: { httpOnly: true, secure: true, sameSite: 'lax' }`; `req.session.regenerate()` on login, `destroy()` on logout; pin JWT `algorithms`, set `expiresIn`, verify `iss`/`aud`; Argon2id or bcrypt (cost ≥ 10).
9. **Cross-origin:** explicit CORS origin allow-lists; CSRF protection (`csrf-csrf`/`csrf-sync` or Origin checks) for cookie-authenticated state changes; no state changes on `GET`.
10. **Production config:** `NODE_ENV=production`, a generic error handler, `helmet()`, `app.disable('x-powered-by')`, `trust proxy` set to the real proxy hop count or addresses, body and multipart limits, rate limits on auth and costly endpoints with a shared store.
11. **Availability:** Express 5 (or wrappers on Express 4) so rejected promises are handled; no sync crypto/fs in handlers; no user-supplied regexes; review regexes for nested quantifiers.
12. **Dependencies:** commit the lockfile, `npm ci`, review install scripts (npm 12 `allowScripts`), `min-release-age`, `npm audit --omit=dev` in CI, supported Node LTS.
13. Add a **test for the security boundary** you just wrote (another user gets 404/403, `role` is ignored, traversal gets 400).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the path from attacker input to impact is fully traced in code/config, or it was safely demonstrated.
- **Likely**: strong evidence, but one runtime condition (deployment `NODE_ENV`, proxy setup, an env var, middleware applied outside the repo) couldn't be verified. Name it.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact × exploitability × required privileges × exposure. Don't raise severity because a scary keyword appears. Unauthenticated RCE, auth bypass and cross-tenant data access are Critical/High; issues needing an admin account or unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `src/routes/files.js:42` (`GET /files/download`)
- **Evidence:** the exact code/config, and how attacker input reaches it (including middleware order)
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, configuration, deployment assumptions
- **Fix:** smallest framework-native change (code snippet)
- **Verify:** test or request that proves the fix
- **Refs:** CWE / OWASP / official docs link
```

**Rules:** never invent files, routes, packages or config values. Redact secrets (`JWT_SECRET=ab****`). Say explicitly when runtime verification wasn't performed. Only test applications the user is authorized to assess, using non-destructive checks.

## References

- Node.js security best practices: https://nodejs.org/en/learn/getting-started/security-best-practices
- Node.js releases and security blog: https://nodejs.org/en/about/previous-releases, https://nodejs.org/en/blog/vulnerability
- Express security best practices and 5.x migration: https://expressjs.com/en/advanced/best-practice-security.html, https://expressjs.com/en/guide/migrating-5.html
- Fastify docs: https://fastify.dev/docs/latest/ · Koa: https://koajs.com/ · Hono: https://hono.dev/docs/
- OWASP Node.js Security, NPM Security and Prototype Pollution Prevention Cheat Sheets: https://cheatsheetseries.owasp.org/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
