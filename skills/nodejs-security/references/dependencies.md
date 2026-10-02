# Node.js — Runtime Support, Dependencies and npm Supply Chain

## Contents
- Node.js release status (as of 2026-10-02)
- Recent Node.js security releases
- Framework support status
- Auditing dependencies
- Notable package advisories to check
- npm supply-chain risks
- Hardening installs and CI
- False positives
- Verification

## Node.js release status (as of 2026-10-02)

From the Node.js release schedule (`nodejs/Release` `schedule.json`) and nodejs.org previous-releases page:

| Line | Status on 2026-10-02 | Next milestone |
|---|---|---|
| 26.x | Current | Becomes LTS 2026-10-28; EOL 2029-04-30 |
| 24.x (Krypton) | Active LTS | Maintenance from 2026-10-20; EOL 2028-04-30 |
| 22.x (Jod) | Maintenance LTS | EOL 2027-04-30 |
| 25.x | EOL (2026-06-01) | none |
| 20.x (Iron) | EOL (2026-04-30) | none |
| ≤ 19, 21, 23 | EOL | none |

- Production should run Active or Maintenance LTS. An EOL Node line in production (Dockerfile `FROM node:20`, `.nvmrc`, `engines`, CI matrix, Lambda runtime) is a **Medium** finding by default, **High** if internet-facing and behind on known exploitable CVEs.
- From Node 27 (April 2027) the project moves to one major per year, each becoming LTS. Don't assume odd-numbered lines are short-lived after that.
- Read the actual runtime: Dockerfile base image tag, `.nvmrc`/`.node-version`, `package.json` `engines`, `volta`, platform config (Vercel/Lambda/Cloud Run).

## Recent Node.js security releases

Being on a supported line isn't enough; check the patch version. The latest security releases in 2026:

| Date | Patched versions | Highlights |
|---|---|---|
| 2026-07-29 | 22.23.2, 24.18.1, 26.5.1 | HTTP/2 memory and use-after-free (High), Permission Model path over-grant CVE-2026-58043 (High), HTTPS agent session reuse skipping hostname verification, HTTP parser header truncation (request smuggling, Low) |
| 2026-06-18 | 22.23.0, 24.17.0, 26.3.1 | WebCrypto AES DoS CVE-2026-48933 (High), TLS wildcard hostname bypass CVE-2026-48618 (High), several Permission Model bypasses |
| 2026-03-24 | 20.20.2, 22.22.2, 24.14.1, 25.8.2 | TLS SNI DoS CVE-2026-21637 (High), `__proto__` header crash in `req.headersDistinct` CVE-2026-21710 (High), V8 hash-flooding DoS CVE-2026-21717 (Medium; `JSON.parse` is the common trigger), HMAC timing |

Check https://nodejs.org/en/blog/vulnerability for anything newer than this table.

**Permission Model:** `--permission` with `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, etc. is stable since v22.13.0/v23.5.0 (`--allow-net` was added later, in v25.0.0, and is still in active development). The docs call it a "seat belt" for trusted code: it "does not provide security guarantees in the presence of malicious code", follows symlinks outside granted paths, and has had several bypass CVEs in 2026. Recommend it as defense-in-depth, not as a sandbox.

## Framework support status

| Package | Supported | Notes |
|---|---|---|
| express | 5.x current, 4.x maintenance | 3.x and older EOL |
| fastify | 5.x | 4.x end of LTS 2025-06-30; 5.x needs Node 20+ |
| koa | 3.x | 2.x still published; confirm support before relying on it |
| hono | 4.x | frequent advisories; stay on latest 4.x |
| passport | ≥ 0.6.0 | session fixation fix (CVE-2022-25896) |
| jsonwebtoken | 9.x | < 9 has algorithm/key-type weaknesses (CVE-2022-23539/23540/23541) |
| csurf | deprecated/archived | replace (see `csrf-cors.md`) |

## Auditing dependencies

```bash
npm ls express fastify koa hono path-to-regexp body-parser qs multer ejs mongoose axios lodash
npm audit --omit=dev            # production tree; add --audit-level=high in CI
npm audit signatures            # registry signatures and provenance attestations
npx better-npm-audit audit      # optional allow-list workflow
pnpm audit --prod / yarn npm audit --environment production
```

- Read installed versions from `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`, not `package.json` ranges.
- A vulnerable package only matters if its vulnerable code is reachable. Report reachable ones with evidence; summarize the rest.
- Production apps without a lockfile, or deploying with `npm install` instead of `npm ci` → Medium/Low supply-chain hardening.

## Notable package advisories to check

- `path-to-regexp` ReDoS: 0.1.x (Express 4) needs ≥ 0.1.13; 8.x (Express 5 via `router`) needs ≥ 8.4.0. See `api-security.md`.
- `express` < 4.19.2 open redirect (CVE-2024-29041); < 4.20.0 `res.redirect` XSS (CVE-2024-43796).
- `body-parser` < 1.20.3 URL-encoded DoS (CVE-2024-45590); < 1.20.6 / 2.3.0 invalid `limit` disables size check.
- `ejs` < 3.1.7 `outputFunctionName` RCE (CVE-2022-29078); < 3.1.10 pollution hardening (CVE-2024-33883).
- `mongoose` < 8.9.5 / 7.8.4 / 6.13.6 `$where` via `populate` match (CVE-2025-23061).
- `mysql2` < 3.17.0: objects as values expand into SQL (see `input-validation.md`).
- `sequelize` < 6.19.1 replacements SQLi (CVE-2023-25813).
- `lodash` < 4.18.0 (`_.template` imports, CVE-2026-4800; `unset`/`omit` pollution CVE-2025-13465 and its bypass CVE-2026-2950, fully fixed in 4.18.0).
- `axios` < 1.8.2 absolute-URL SSRF (CVE-2025-27152); >= 1.17.0 < 1.20.0 fetch-adapter redirects (CVE-2026-101907, fetch adapter only); September 2026 batch of advisories.
- `multer` 2.x: many 2026 DoS fixes; use the latest release.
- `hono` < 4.11.4 JWT algorithm confusion (CVE-2026-22817), plus 2026 advisories.
- `node-serialize` (any version): unsafe by design.

## npm supply-chain risks

Recent incidents worth naming when explaining risk:
- **2025-09-08:** phishing of a maintainer led to malicious releases of `chalk`, `debug`, `ansi-styles` and other very widely used packages (browser crypto-wallet hijacking payload).
- **2025-09 "Shai-Hulud":** a self-replicating worm compromised 500+ packages (e.g. `@ctrl/tinycolor`), stole npm/GitHub/cloud credentials with secret scanners and republished itself (CISA alert, 2025-09-23). Variants followed into 2026 (e.g. "Mini Shai-Hulud" in `keyv` and related packages, August 2026).
- **2026-03-31:** `axios` 1.14.1 and 0.30.4 were published from a hijacked maintainer account with a malicious dependency (`plain-crypto-js`) whose `postinstall` dropped a remote-access trojan.
- Typosquats and dependency-confusion packages (internal package names not reserved on the public registry).

Response actions npm/GitHub took: classic tokens revoked (2025-12-09), granular tokens with short lifetimes, trusted publishing (OIDC) with provenance.

## Hardening installs and CI

- Commit lockfiles; use `npm ci` (fails on lockfile drift).
- **Install scripts:** npm 12 (released 2026-07-08) no longer runs dependency `preinstall`/`install`/`postinstall` scripts unless approved in `package.json` `allowScripts` (`npm approve-scripts <pkg>`), and defaults `allow-git`/`allow-remote` to `none`. npm 11.16+ offers the same policy as a warning (`strict-allow-scripts=true` to enforce). Node 24 and 26 bundle npm 11 and Node 22 bundles npm 10; none bundles npm 12, so check `npm -v` and upgrade npm explicitly. Otherwise use `npm ci --ignore-scripts` and rebuild only what needs native builds.
- **Cooldown:** `min-release-age=7` in `.npmrc` (npm ≥ 11.10.0) skips versions published in the last N days, which avoids most short-lived malicious releases. pnpm and Yarn have equivalents.
- `overrides` (npm) / `resolutions` (Yarn) / `pnpm.overrides` to force patched transitive versions; check they don't pin a vulnerable version.
- Scope internal packages and configure the registry per scope (dependency confusion).
- Least-privilege CI tokens; don't expose publish tokens or cloud credentials to `npm install` steps; prefer trusted publishing.
- Dependabot/Renovate with a cooldown and grouped updates; review new dependencies (maintainers, install scripts, download history).

## False positives

- `npm audit` findings in `devDependencies` that never ship or run in production (still relevant for CI/developer machines when install scripts are involved).
- ReDoS advisories in packages that never see untrusted input (build tools).
- A package version that matches an advisory range but where the vulnerable function isn't used. Report as Informational with that reasoning.

## Verification

```bash
node -v && npm -v
npm audit --omit=dev --audit-level=high
npm ls path-to-regexp
npm config get min-release-age ignore-scripts
grep -E '"(preinstall|install|postinstall)"' -r node_modules/*/package.json | head   # which deps have install scripts
```

References: OWASP NPM Security Cheat Sheet, OWASP Top 10 A06/A08; CWE-1104, CWE-494, CWE-829; https://nodejs.org/en/about/previous-releases, https://github.com/nodejs/Release, https://nodejs.org/en/blog/vulnerability, https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem, https://docs.npmjs.com/cli/v11/using-npm/config.
