# Next.js — Dependencies, Versions and Advisories

## Contents
- Support status
- Reading the installed version
- Minimum safe versions
- Notable advisories
- React Server Components packages
- Auth and adjacent libraries
- Audit commands and hygiene
- Verification

## Support status

From https://nextjs.org/support-policy (checked 2026-10-02):

| Major | Status | Notes |
|---|---|---|
| 16.x (released 2025-10-21) | Active LTS | Latest 16.3.8 (2026-09-30). |
| 15.x (released 2024-10-21) | Maintenance LTS | Critical bug fixes and security updates only, delivered on the 15.5.x line (latest 15.5.27). The policy keeps a major in Maintenance LTS "for two years following the initial release", so 15.x support ends **2026-10-21**. Plan the move to 16. |
| 14.x and older | Unsupported | Last 14.x release is 14.2.35 (Dec 2025). 2026 advisories whose ranges include 14.x have no 14.x fix. |

An app on an unsupported major, or on an older minor of 15.x than 15.5.x, is a finding: **Medium** by itself, raised to the severity of the worst applicable advisory.

## Reading the installed version

- `package-lock.json`: `"node_modules/next": { "version": ... }`. `pnpm-lock.yaml`: `next@<version>`. `yarn.lock`: `next@^x:` block → `version`. `bun.lock`: `"next": ["next@<version>", ...]`.
- `npm ls next react react-dom`, or `node -p "require('next/package.json').version"`.
- The App Router uses React builds **vendored inside `next`**, so RSC advisories are fixed by upgrading `next`, regardless of the top-level `react` version. Pages Router uses the installed `react`/`react-dom`.

## Minimum safe versions

As of 2026-10-02, the releases that include every published Next.js fix are **16.3.8** and **15.5.27**. Anything lower in those lines is affected by at least one advisory below. Always re-check https://github.com/vercel/next.js/security/advisories.

## Notable advisories

Ranges are from the GitHub advisories (vercel/next.js). "App Router" means only apps using `app/` are affected.

| Advisory | Issue | Affected | Fixed |
|---|---|---|---|
| CVE-2025-55182 "React2Shell" (Next.js advisory GHSA-9qr9-h5gf-34mp; originally announced for Next.js as CVE-2025-66478, since rejected as a duplicate) | **Critical** unauthenticated RCE in the RSC protocol (App Router) | 15.x, 16.x, 14.3.0-canary.77+ canaries. 13.x, 14.x stable, Pages Router and Edge runtime not affected | 15.0.5, 15.1.9, 15.2.6, 15.3.6, 15.4.8, 15.5.7, 16.0.7. Rotate secrets of apps that were exposed unpatched |
| CVE-2025-55184 + CVE-2025-67779 | DoS (infinite loop) via crafted RSC request; first fix incomplete | >=13.3 (App Router) | 14.2.35, 15.0.7, 15.1.11, 15.2.8, 15.3.8, 15.4.10, 15.5.9, 16.0.10 |
| CVE-2025-55183 | Server Function source code exposure | 15.x, 16.x (App Router) | 15.0.6 … 15.5.8, 16.0.9 (take the CVE-2025-67779 versions) |
| CVE-2026-23864 / CVE-2026-23869 / CVE-2026-23870 | Further RSC DoS | 13.x–15.x, 16.x | 15.5.10 & 16.1.5 / 15.5.15 & 16.2.3 / 15.5.16 & 16.2.5 |
| CVE-2025-29927 | **Critical** middleware bypass via `x-middleware-subrequest` | 11.1.4–<12.3.5, 13.0.0–<13.5.9, 14.0–<14.2.25, 15.0–<15.2.3 | 12.3.5, 13.5.9, 14.2.25, 15.2.3 |
| CVE-2024-51479 | Pathname-based middleware authorization bypass | 9.5.5–14.2.14 | 14.2.15 |
| CVE-2026-44573, -44574, -44575, -45109, -64642 | Middleware/proxy bypasses (i18n, param injection, segment prefetch, Turbopack single locale) | see `middleware-proxy.md` | 15.5.16–15.5.18, 16.2.5–16.2.11 |
| CVE-2024-34351 / CVE-2026-64649 | SSRF via Host header in Server Actions | 13.4–<14.1.1 / 14.1.1–<15.5.21, 16.0.0–<16.2.11 | 14.1.1 / 15.5.21, 16.2.11 |
| CVE-2026-64645 | SSRF / open redirect via dynamic hostnames in `rewrites`/`redirects` | 12.0.0–<15.5.21, 16.0.0–<16.2.11 | 15.5.21, 16.2.11 |
| CVE-2026-27978 | `Origin: null` bypassed Server Actions CSRF check | 16.0.1–16.1.6 | 16.1.7 |
| CVE-2026-64643 | Server Function / `use cache` endpoint IDs disclosed to unauthenticated users | 13.0.0–<15.5.21, 16.0.0–<16.2.11 | 15.5.21, 16.2.11 |
| GHSA-2xp9-vwfh-vxw4 | **Critical** RCE in image optimization of AVIF files (`libheif` via `sharp`) | 10.0.0–<15.5.24, 16.x <16.3.3 | 15.5.24, 16.3.3 |
| CVE-2026-75604 | **Critical** unauthenticated RCE on Windows-hosted servers | 13.4–<15.5.24, 16.0–<16.3.3 | 15.5.24, 16.3.3 |
| CVE-2026-94545 | **Critical** RCE in Node.js `next/og` `ImageResponse` with attacker values in SVG | 16.2.0–<16.3.6 | 16.3.6 |
| CVE-2026-94483 | SSRF in image optimization via allow-listed hosts | 16.x before 16.3.8 | 16.3.8 (per release notes; the advisory lists a placeholder patched version) |
| CVE-2026-44581 / CVE-2026-44580 | XSS via CSP nonce reflection / `beforeInteractive` scripts | 13.x–<15.5.16, 16.0.0–<16.2.5 | 15.5.16, 16.2.5 |
| CVE-2026-94543, -94484, -94544, -103004 | Cache poisoning / cross-user content / draft-mode and root-param `use cache` leaks | 15.x and 16.x (some 16.3.x only) | 15.5.27, 16.3.8 (per release notes) |

Not exhaustive: there are also many DoS and cache-poisoning advisories (image optimizer, Server Actions, PPR). Rate reachability: an image-optimizer advisory doesn't apply if `next/image` remote optimization is unused; App Router advisories don't apply to Pages-Router-only apps; Vercel-hosted apps were auto-mitigated for some middleware issues (stated per advisory).

## React Server Components packages

Other RSC frameworks (React Router RSC, Waku, Parcel, custom setups) use `react-server-dom-webpack`, `-turbopack` or `-parcel` directly:

| Advisory | Affected | Fixed |
|---|---|---|
| CVE-2025-55182 (RCE) | 19.0.0, 19.1.0, 19.1.1, 19.2.0 | 19.0.1, 19.1.2, 19.2.1 |
| CVE-2025-55183 / CVE-2025-55184 / CVE-2025-67779 | 19.0.0–19.2.2 | 19.0.3, 19.1.4, 19.2.3 |
| CVE-2026-23864, -23869, -23870, CVE-2026-44907 (DoS) | up to 19.2.7 | 19.0.8, 19.1.9, 19.2.8 |

## Auth and adjacent libraries

- `next-auth`: fixed in 4.24.15 / 5.0.0-beta.32 (`@auth/core` 0.41.3) for the July 2026 advisories. See `authentication-sessions.md`.
- `@clerk/nextjs`: CVE-2026-41248 middleware bypass (fixed 5.7.6 / 6.39.2 / 7.2.1), CVE-2026-42349 (fixed 6.39.3 / 7.2.4).
- Sanitizers and Markdown renderers (`dompurify`, `isomorphic-dompurify`, `sanitize-html`, `marked`, `rehype-*`) matter most among runtime libraries. Check `npm audit` output for them.

## Audit commands and hygiene

```bash
npm audit --omit=dev            # or: pnpm audit --prod / yarn npm audit --environment production
npm ls next react react-dom
npx fix-react2shell-next        # Vercel's interactive checker for the RSC advisories
```

- Lock file committed and used in CI (`npm ci`), otherwise the deployed version is unknown.
- Dev-only packages that run in production (`next dev` in production start scripts) → see `secrets-config.md`.
- Install scripts and typosquats in `dependencies` (supply chain): review new packages, prefer `npm ci --ignore-scripts` where feasible.
- Renovate/Dependabot configured for `next` patch releases.

## Verification

After upgrading: `npm ls next` shows the fixed version, the lock file changed, `next build` passes, and the advisory-specific test passes (for example, a request to a protected page carrying `x-middleware-subrequest` is still rejected; a protected page still checks auth when called without proxy).

References: OWASP A03:2025 Software Supply Chain Failures; CWE-1104, CWE-1395; https://nextjs.org/support-policy, https://github.com/vercel/next.js/security/advisories, https://github.com/facebook/react/security/advisories, https://nextjs.org/blog/CVE-2025-66478, https://nextjs.org/blog/security-update-2025-12-11.
