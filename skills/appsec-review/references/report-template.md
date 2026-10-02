# Report Template

## Contents
- Report structure
- Finding format (Markdown)
- Finding format (structured / machine-readable)
- Writing guidance

## Report structure

```markdown
# Security Review — <project> (<scope: full | PR #123 | feature X>)

**Date:** YYYY-MM-DD · **Reviewer:** <agent/model> · **Commit:** <sha>

## Summary
2–4 sentences: overall posture, most important risks, what to fix first.

| Severity | Confirmed | Likely |
|---|---|---|
| Critical | n | n |
| High | n | n |
| Medium | n | n |
| Low | n | n |

## Scope and stack
- In scope: <paths / PR / flows>
- Stack: <framework + version, auth, data stores, infra>
- Skills applied: <appsec-review, laravel-security, ...>
- Not covered: <e.g. infrastructure, mobile client, runtime testing>

## Findings
<findings, highest severity first>

## Hardening recommendations
<short list: control, where, why>

## Needs verification
<open questions that would confirm or dismiss suspected issues>

## Remediation plan
1. <Critical/High fixes, smallest safe change first>
2. ...

## Verification performed
<tests added/run, commands, what could not be verified>

## Limitations
Static review of the provided code at <commit>; no production access; <other limits>.
```

## Finding format (Markdown)

```markdown
### F-01 [HIGH] Any user can read any order (IDOR) — Confirmed

- **Location:** `src/orders/orders.controller.ts:88` (`OrdersController.findOne`); also `:120` (`update`)
- **Category:** Broken access control — CWE-639, OWASP API1:2023
- **Evidence:**
  ```ts
  @Get(':id')
  findOne(@Param('id') id: string) { return this.orders.findOne(id); }   // no owner check
  ```
  `OrdersService.findOne` (`orders.service.ts:31`) queries by `id` only. `RolesGuard` is applied only to `AdminController` (`app.module.ts:41`).
- **Impact:** Any authenticated user can read and modify other customers' orders (names, addresses, items).
- **Preconditions:** A user account (self-registration is open).
- **Fix:**
  ```ts
  findOne(@Param('id') id: string, @User() user) {
    return this.orders.findOneForUser(id, user.id); // WHERE id = ? AND user_id = ?
  }
  ```
- **Verification:** e2e test: user B requests user A's order → 404. Same for PATCH/DELETE.
- **References:** OWASP Authorization Cheat Sheet; https://docs.nestjs.com/security/authorization
```

## Finding format (structured / machine-readable)

When the user wants JSON/YAML output, or for CI integration:

```yaml
- id: F-01
  title: Any user can read any order (IDOR)
  severity: high            # critical | high | medium | low | info
  confidence: confirmed     # confirmed | likely | hardening | informational
  category: broken-access-control
  cwe: [CWE-639]
  owasp: [API1:2023]
  locations:
    - file: src/orders/orders.controller.ts
      line: 88
      symbol: OrdersController.findOne
  evidence: >
    findOne queries by id only; no guard or ownership filter on this route.
  impact: Any authenticated user can read other customers' orders.
  preconditions: [authenticated user]
  remediation: Scope the query by user id or apply an ownership policy.
  verification: [e2e test cross-user access returns 404 on GET/PATCH/DELETE]
  references: [https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html]
```

For SARIF 2.1.0 output, map: `ruleId` = category, `level` = error (critical/high) / warning (medium) / note (low/info), `locations[].physicalLocation` = file/line, `message.text` = title + impact, and put `confidence` and `cwe` in `properties`.

## Writing guidance

- Title = impact in plain words ("Any user can read any order"), not the mechanism alone ("Missing check").
- One finding per root cause. List all affected locations under it.
- Show the minimum code needed as evidence. Redact secrets.
- Fixes should be concrete and framework-native, and as small as possible.
- Don't pad the report with generic advice. Every hardening item should name a location.
