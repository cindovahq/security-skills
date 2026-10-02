# NestJS — Versions, Support Status and Advisories

## Contents
- Read the installed versions
- Support status on 2026-10-02
- Nest advisories
- Upload and transport dependencies
- ORM, validation and JWT libraries
- Commands
- Reporting guidance
- False positives

## Read the installed versions

Take versions from the lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), not `package.json` ranges. Note: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` or `@nestjs/platform-fastify`, `@nestjs/microservices`, `@nestjs/websockets`, `@nestjs/graphql` + `@nestjs/apollo` (and `@apollo/server`), `@nestjs/jwt`, `@nestjs/passport` + `passport-jwt`, `@nestjs/throttler`, `@nestjs/swagger`, `@nestjs/config`, `@nestjs/axios`, `@nestjs/devtools-integration`, `typeorm`/`@prisma/client`/`mongoose`/`@mikro-orm/*`, `class-validator`, `class-transformer`, `multer`, `helmet`, `Node.js` runtime (Dockerfile, `.nvmrc`).

## Support status on 2026-10-02

| Line | Status | Notes |
|---|---|---|
| Nest 12.x | Current; 12.0.0 released 2026-08-27, 12.1.2 latest on npm 2026-09-30 | ESM-ready packages, requires Node 20.19+ / 22.12+ / 24+; 12.1 adds `enableCsrfProtection()`, `useSecurityHeaders()`, built-in cookies |
| Nest 11.x | Maintained; 11.2.7 latest on npm 2026-09-30 | Express 5 by default; most 2026 advisories are fixed in 11.2.x |
| Nest 10.x | No release after 10.4.22 (2026-01-10); the September 2026 advisory for the TCP transport lists 10.x as end-of-life with no patch | Recommend upgrading; late-2026 advisories (fastify absolute-form, microservices) have no 10.x fix |

Express adapter: Express 4 on Nest 10, Express 5 on Nest 11 and 12 (npm dependency metadata).

## Nest advisories

All from `github.com/nestjs/nest/security/advisories` (GitHub API cross-checked); patched versions are the first fixed release per line.

| ID | Package and condition | Fixed in |
|---|---|---|
| CVE-2025-69211 (GHSA-8wpr-639p-ccrj) | `@nestjs/platform-fastify`: URL-encoded path (`/%61dmin`) bypasses string-path middleware (TOCTOU) | 11.1.11 |
| CVE-2026-2293 (GHSA-r4wm-x892-vjmx) | `platform-fastify` <= 11.1.13: path normalization options (`ignoreTrailingSlash`, `ignoreDuplicateSlashes`, `useSemicolonDelimiter`) cause middleware bypass | 11.1.14 |
| CVE-2026-33011 (GHSA-wf42-42fg-fg84) | `platform-fastify` <= 11.1.15: `HEAD` requests skip middleware but run the `GET` handler | 11.1.16 |
| CVE-2026-54281 (GHSA-6v32-fjc9-9qf6) | `platform-fastify` <= 11.1.23: trailing `/` bypasses `forRoutes()` middleware in the default config | 11.1.24 |
| GHSA-9c5c-9qcx-q35q | `platform-fastify` < 11.2.4 and 12.0.0 to 12.0.1: absolute-form request target (`GET http://host/path`) bypasses path-scoped middleware (CVSS 8.1; reduced behind proxies that normalize) | 11.2.4, 12.0.2 (12.0.3 / 11.2.5 recommended) |
| CVE-2026-35515 (GHSA-36xv-jgw5-4q75) | `@nestjs/core` <= 11.1.17: `SseStream` does not strip newlines from `message.type`/`id` (SSE event injection) | 11.1.18 |
| CVE-2026-40879 (GHSA-hpwf-8g29-85qm) | `@nestjs/microservices` <= 11.1.18: recursive `handleData` in TCP `JsonSocket` stack overflow DoS | 11.1.19 |
| CVE-2026-102281 (GHSA-m8vh-jmq9-5rjg) | `@nestjs/microservices` < 11.2.4 and 12.0.0 to 12.0.1: deeply nested message `pattern` terminates the process (TCP, RabbitMQ) | 11.2.4, 12.0.2 |
| GHSA-96h4-vgxj-gvm2 | `@nestjs/microservices` < 11.2.5 and < 12.0.3 (10.x unpatched): TCP transport unbounded memory growth (adds stall timeout, `maxSendBufferSize`) | 11.2.5, 12.0.3 |
| CVE-2024-29409 (GHSA-cj7v-w2c7-cp7c) | `@nestjs/common` < 10.4.16 and 11.0.0 to < 11.0.16: `FileTypeValidator` trusted the client `Content-Type` | 10.4.16, 11.0.16 |
| CVE-2025-54782 (GHSA-85cg-cmq5-qjm7) | `@nestjs/devtools-integration` <= 0.2.0: CSRF to sandbox escape (RCE on developer machines) | 0.2.1 |

## Upload and transport dependencies

`@nestjs/platform-express` pins `multer`: 10.4.17 and earlier use 1.4.4-lts.1; 11.0.0 to 11.1.1 use 1.4.5-lts.x; 10.4.18+ and 11.1.2+ use multer 2.0.x and later minors. Multer advisories (GitHub Advisory Database): 2.0.0 fixed `CVE-2025-47935` and `CVE-2025-47944`; 2.0.1 `CVE-2025-48997`; 2.0.2 `CVE-2025-7338`; 2.1.0 `CVE-2026-2359`, `CVE-2026-3304`; 2.1.1 `CVE-2026-3520`; 2.2.0 `CVE-2026-5079`, `CVE-2026-5038`; 2.3.0 `CVE-2026-77078`, `CVE-2026-77037`, `CVE-2026-82333`, `CVE-2026-77063` (async `fileFilter` size-limit bypass); 2.4.0 `CVE-2026-88932` (aborted-upload disk writes). On 2026-10-02 the fixed multer is **2.4.0**, shipped by `@nestjs/platform-express` 11.2.6 and 12.0.3+ (11.2.6's release notes: multer 2.4.0 and a fix mapping multer errors by code). Most are Denial of Service, mostly High (CVE-2026-77063 is Low; CVE-2026-88932 and CVE-2026-5038 are Medium). If the Nest line cannot be upgraded, use package manager overrides (`"overrides": { "multer": "2.4.0" }`) and test uploads.

`@nestjs/platform-fastify` 11.1.16 to 11.2.3 and 12.0.0 to 12.0.1 bundle a Nest-maintained copy of `@fastify/middie` that did not track upstream fixes (GHSA-9c5c-9qcx-q35q). From 11.2.4 and 12.0.2 it depends on `@fastify/middie` 9.3.4 (exact pin); earlier 11.1.x declared it as a normal dependency. Check `npm ls @fastify/middie`; upstream `@fastify/middie` advisories (CVE-2026-6270, CVE-2026-33804, CVE-2026-2880, CVE-2026-22031) are fixed in 9.3.2 or earlier.

## ORM, validation and JWT libraries

| Package | Notes |
|---|---|
| `typeorm` | `CVE-2025-60542` SQL injection through `repository.save`/`update` with crafted object values on MySQL/MariaDB, fixed 0.3.26; `GHSA-9ggv-8w38-r7pm` `UpdateQueryBuilder`/`SoftDeleteQueryBuilder` order injection (MySQL/MariaDB), fixed 0.3.29 and 1.0.0; `CVE-2026-73651` `migration:generate` code injection, fixed 0.3.31 and 1.1.0. Latest line is 1.x (1.1.1, published 2026-09-01). 1.0 changed `invalidWhereValuesBehavior` to throw on `null`/`undefined` find conditions (`injection.md`) |
| `jsonwebtoken` | `@nestjs/jwt` 12.x depends on 9.0.3 (npm metadata). `< 9.0.0` has algorithm and key-type weaknesses (`CVE-2022-23539`/`23540`/`23541`) |
| `passport` | >= 0.6.0 for the session-fixation fix (`CVE-2022-25896`); `passport-jwt` 4.0.1 is the latest release (Dec 2022) |
| `class-validator` | < 0.14.0 `CVE-2019-18413`; 0.15.1 current. `class-transformer` 0.5.1 (Nov 2021) is unmaintained; < 0.3.1 prototype pollution `CVE-2020-7637` |
| `file-type` (pinned by `@nestjs/common`) | CVE-2026-32630 (ZIP decompression bomb, 20.0.0 to 21.3.1, fixed 21.3.2) and CVE-2026-31808 (ASF parser infinite loop, fixed 21.3.1) reach `FileTypeValidator` on Nest 10.x and Nest 11 before 11.1.17. Medium (DoS) when the validator runs on untrusted uploads |
| `@apollo/server` | `@nestjs/apollo` 14 and 13.2+ require Apollo Server 5; 13.0 to 13.1 and 12.x (Nest 10) use 4. npm marks Apollo Server 4 end-of-life since 2026-01-26 (deprecation notice); plan the upgrade and check advisories for the installed major |
| `axios` (`@nestjs/axios`) | See the `nodejs-security` skill (dependencies reference) for SSRF and fetch-adapter advisories |
| `@nestjs/authentication`, `@nestjs/authorization`, `@nestjs/http-client`, `@nestjs/webhooks` | New in the Nest 12 docs; version `0.0.1` on npm (published 2026-09-27 to 2026-10-01). Pre-release maturity |

## Commands

```bash
npm ls @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/platform-fastify multer @nestjs/microservices
npx nest info                 # prints Nest package versions and Node version
npm audit --omit=dev          # pnpm audit --prod / yarn npm audit --environment production
npm view @nestjs/core dist-tags --json   # latest tag; compare with the installed version
```

Check Node: `node -v`, Dockerfile `FROM node:`, `engines`. Nest 12 requires Node 20.19+ / 22.12+ / 24+. For Node EOL status and supply-chain checks use the `nodejs-security` skill's dependencies reference.

## Reporting guidance

- Report an advisory only when the **installed version is in the affected range and the vulnerable feature is used** (for example Fastify middleware bypass: the Fastify adapter is installed **and** security checks are in path-scoped middleware; microservice advisories: the transport is actually started).
- Severity: Fastify middleware bypass is High when auth/authorization lives in that middleware, Low/Medium when it only logs or rate-limits. Exposed TCP/RabbitMQ transport DoS is High; internal-only is Medium. multer DoS is High for unauthenticated upload routes, Medium behind authentication. Nest 10 in production: Medium by default (no patches), High if an affected feature is in use.
- Do not call a project vulnerable merely because a package is old; cite the advisory ID and range.

## False positives

- Advisory ranges for the Fastify adapter on an Express app (and the reverse).
- `@nestjs/devtools-integration` in `devDependencies` with the module disabled in production.
- `typeorm` MySQL advisories on a PostgreSQL-only project.
- Findings in `node_modules` or example apps.
