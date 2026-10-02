# Node.js — Verifying Findings and Fixes

## Contents
- Principles
- Static confirmation
- Commands for evidence
- Automated tests (supertest + Vitest/Jest)
- Safe dynamic checks with curl
- Runtime hardening checks
- Tooling
- Fix-verification checklist

## Principles

- Prefer read-only evidence (code, config, lockfiles, command output) over live exploitation.
- Run dynamic checks only against local or staging environments the user owns and authorizes, with test accounts, benign markers and low request volumes. No destructive payloads, no load tests against shared systems, no probing of third-party hosts or cloud metadata you don't own.
- When you can't run anything, say so and classify the finding **Likely**, naming the unverified condition (e.g. "production `NODE_ENV` not visible").

## Static confirmation

For each finding record:
1. **Source:** route + parameter (`POST /api/settings` body), header, cookie, upload, stored data.
2. **Path:** file:line for each hop, including every middleware that runs first (app-level, router-level, Fastify hooks) and every validation/cast on the way.
3. **Sink:** the sensitive call (`db.query`, `exec`, `res.render`, `fs.readFile`, `fetch`, `res.redirect`).
4. **Missing control:** what should be there, and proof it isn't applied elsewhere (another middleware, a wrapper, a schema, a reverse-proxy rule).

Then search for siblings with the same pattern (`grep -rn "path.join(UPLOAD" src/`); a fix must cover all of them.

## Commands for evidence

These read state without changing data:

```bash
node -v; npm -v
npm ls express fastify koa hono --depth=0
npm ls path-to-regexp qs body-parser            # transitive versions
npm audit --omit=dev --json > audit.json        # summarize reachable ones
node -e "const app=require('./src/app'); console.log(app.get('trust proxy'), app.get('query parser'), app.get('env'))"
grep -rnE "app\.use\(|router\.use\(|register\(" src/ | head -50     # middleware order
```

Don't run migrations, seeders or scripts with side effects to "check" something.

## Automated tests (supertest + Vitest/Jest)

Export the app without calling `listen()` so tests can import it.

```js
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from '../src/app.js';

describe('security boundaries', () => {
  it('rejects unauthenticated access to reports', () => request(app).get('/api/reports/export').expect(401));

  it('scopes invoices to their owner', async () => {
    const b = request.agent(app);
    await b.post('/login').type('form').send({ email: 'b@test.local', password: 'pw-b-123456' });
    await b.get('/invoices/1').expect(404);                     // invoice 1 belongs to user A
  });

  it('does not reflect arbitrary origins with credentials', async () => {
    const r = await request(app).get('/api/me').set('Origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('keeps Object.prototype clean', async () => {
    await request(app).patch('/api/settings').set('Content-Type', 'application/json')
      .send('{"__proto__":{"polluted":true}}');
    expect(({}).polluted).toBeUndefined();
  });
});
```

Patterns:
- **Sessions:** `request.agent(app)` keeps cookies; compare `set-cookie` before/after login for regeneration.
- **Command execution:** spy on `child_process.execFile`/`spawn` (`vi.spyOn`) and assert input arrives as a single argument; assert `exec` is never called.
- **SQL:** assert the query text has placeholders and the values array contains the input (wrap the `pg` pool in a test double), or run against a disposable test database.
- **Uploads:** `.attach('file', Buffer.from('<svg onload=alert(1)>'), 'x.svg')` and assert rejection or a randomized name without the original extension.
- **Errors:** set `NODE_ENV=production` in the test and assert no stack frames (`/at .*:\d+:\d+/`) in 500 bodies.
- **Fastify:** use `fastify.inject()`; for hooks, `fastify.printRoutes({ includeHooks: true })`.

## Safe dynamic checks with curl

```bash
BASE=https://staging.example.com
curl -s -D - -o /dev/null "$BASE/" | grep -iE 'x-powered-by|content-security-policy|strict-transport|set-cookie'
curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$BASE/api/me" | grep -i '^access-control'
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/files/download?name=..%2f..%2fpackage.json"        # expect 400/403/404
curl -s -o /dev/null -w '%{redirect_url}\n' "$BASE/logout?returnTo=//evil.example"                # expect local URL
curl -s -H 'X-Forwarded-For: 203.0.113.7' "$BASE/whoami"                                            # IP must not follow the header
```

## Runtime hardening checks

- `NODE_ENV=production` in the deployed environment (platform settings, Dockerfile, process manager).
- `node --permission --allow-fs-read=/app --allow-fs-write=/app/tmp src/server.js` in staging to find unexpected file/child-process/network use (seat belt, not a sandbox; see `dependencies.md`).
- `node --disallow-code-generation-from-strings` (blocks `eval`/`new Function`) and `--disable-proto=delete` as defense-in-depth where dependencies tolerate them.
- No `--inspect` flags in production start commands.

## Tooling

- Semgrep JavaScript/TypeScript rulesets (e.g. `p/javascript`, `p/nodejsscan`), CodeQL JavaScript queries (taint tracking for SQLi, path injection, SSRF, prototype pollution), `eslint-plugin-security`, `eslint-plugin-no-unsanitized`.
- `npm audit`, OSV-Scanner, Socket/Snyk for supply-chain signals; `npm audit signatures` for provenance.
- `recheck-cli` for regexes. Treat tool output as leads, then trace each one.

## Fix-verification checklist

```text
[ ] Exploit test fails after the fix (403/404/400, no side effect)
[ ] Legitimate use still works (owner can read, valid upload accepted, local redirect works)
[ ] Sibling instances fixed (same pattern searched across src/)
[ ] Fix uses the framework mechanism (root option, parameterized query, schema, middleware order)
[ ] Regression test added for the boundary
[ ] Dependencies upgraded in the lockfile (npm ls shows the patched version)
```

References: OWASP WSTG, OWASP ASVS 5.0; https://github.com/ladjs/supertest, https://vitest.dev/, https://fastify.dev/docs/latest/Guides/Testing/, https://nodejs.org/api/permissions.html.
