# Review Methodology

## Contents
- Evidence standard
- Confidence levels
- Severity rubric
- False-positive discipline
- Safe operating rules
- Common reasoning errors

## Evidence standard

A finding is reportable when another engineer could reproduce your reasoning from the report alone. It needs:

| Element | Example |
|---|---|
| Location | `src/orders/orders.controller.ts:88` (`OrdersController.findOne`) |
| Source | `req.params.id` from `GET /orders/:id`, any authenticated user |
| Path | controller → `OrdersService.findOne(id)` → `repo.findOneBy({ id })` (no owner filter) |
| Missing or broken control | No guard or ownership check on this route; `RolesGuard` applies only to `/admin/*` (`app.module.ts:41`) |
| Impact | Any user reads any order, including address and payment last-4 |
| Preconditions | Authenticated account (self-registration is open) |

Not acceptable: "may be vulnerable to SQL injection", "authentication could be insecure", "consider adding rate limiting" (without saying where it's missing and why it matters).

## Confidence levels

- **Confirmed:** the full source→sink path is traced in code/config, and no compensating control exists, **or** it was demonstrated safely.
- **Likely:** evidence is strong, but a runtime or deployment condition couldn't be verified (production env vars, web-server config, a gateway in front of the app). **Name the condition.**
- **Hardening:** no demonstrated vulnerability; a stronger control is recommended (missing CSP, long session lifetime, no HSTS).
- **Informational:** useful context (an unusual pattern that is safe, a deprecated API).

If you are guessing, it's not a finding. Put it in **Needs verification** with the exact question (e.g. "Is `/internal/*` reachable from the internet, or only via the VPC?").

## Severity rubric

Score **impact** and **likelihood**, then combine. Use the business context (what data, what users, what money).

**Impact**
- *Severe:* remote code execution; full auth bypass; admin takeover; cross-tenant access to sensitive data; mass PII/credential exposure; arbitrary money movement.
- *Significant:* single-account takeover; reading or modifying other users' sensitive data; stored XSS affecting admins; SSRF to internal services.
- *Moderate:* limited data exposure; actions requiring user interaction; CSRF on meaningful actions; DoS of one feature.
- *Minor:* information leaks with little direct value; defense-in-depth gaps.

**Likelihood**
- *High:* unauthenticated or any-user; simple request; no special conditions.
- *Medium:* needs an account with a common role, user interaction, or one non-default but plausible condition.
- *Low:* needs admin/privileged access, an unlikely configuration, a race window, or chained prerequisites.

| | High likelihood | Medium | Low |
|---|---|---|---|
| **Severe** | Critical | High | Medium |
| **Significant** | High | Medium | Low |
| **Moderate** | Medium | Low | Low |
| **Minor** | Low | Info | Info |

Adjust with stated reasons (e.g. "raised: the app handles health records"). You can include a CVSS v4.0 vector when the user wants it, but the matrix above is the primary scale. Never raise severity because of a keyword (`eval`, `md5`, `raw`). Severity comes from reachable impact.

## False-positive discipline

Before reporting, check:

1. **Reachability:** is the code actually reachable (routed, exported, called)? Dead code → Informational at most.
2. **Attacker control:** can an attacker influence the value? Constants, server config and admin-only settings usually don't count.
3. **Compensating controls:** framework defaults (auto-escaping, ORM binding, CSRF middleware), global middleware, API gateways, validation schemas, DB constraints, type systems.
4. **Framework behavior:** confirm the framework's actual behavior for the installed version instead of assuming (e.g. some auth guards regenerate sessions automatically, and some ORMs quote identifiers).
5. **Intent:** public endpoints, admin features and debug tools in local-only config can be deliberate. Report the risk only if the deployment exposes it.
6. **Test and fixture code:** findings in tests, seeders, examples and local tooling are rarely vulnerabilities, unless they ship to production or contain real secrets.

## Safe operating rules

- Read-only analysis is the default. Run commands that inspect (list routes, show config, audit dependencies), not ones that mutate (migrate, seed, delete, deploy).
- Dynamic checks: user-authorized environments only, test accounts, benign payloads (`'"><x>`, `' OR '1'='1` in a search box, not `DROP TABLE`), a handful of requests, never brute force or load.
- Don't access, copy or display real user data or secrets beyond what's minimally needed to prove the issue. Redact in output.
- If you find an exposed live secret, recommend immediate rotation. Don't test it against the provider.
- State clearly when runtime verification was not performed.

## Common reasoning errors

- Reporting "missing CSRF" on APIs that only use bearer tokens.
- Reporting SQL injection on ORM calls that bind values.
- Reporting XSS where the template engine auto-escapes and no raw-output API is used.
- Treating UUIDs or unguessable IDs as access control, or reporting a sequential ID as a vulnerability by itself.
- Calling a dependency vulnerable because it's old, without a matching advisory.
- Missing the real issue because it spans files: the check exists on `GET`, but not on `PUT`/`DELETE` or an alternate API route.
- Assuming an environment variable's production value from `.env.example`.
