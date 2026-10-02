---
name: appsec-review
description: Evidence-based application security review for any codebase, pull request or diff. Use when the user asks for a security review, security audit, vulnerability assessment, secure code review, pentest preparation, threat model, OWASP check, or "is this code secure", or before shipping auth, payment, upload, API or AI/LLM features. Detects the tech stack, routes to installed framework skills (e.g. laravel-security), and otherwise applies built-in checklists for authentication and sessions, access control, injection, XSS/CSRF/CORS, SSRF and file uploads, secrets and configuration, cryptography, APIs, dependencies and CI/CD supply chain, business logic, and LLM/agent features. Produces findings with evidence, severity, confidence, fixes and verification steps, and keeps false positives low.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  last-verified: "2026-10-02"
---

# AppSec Review

A repeatable method for finding, explaining, fixing and verifying security issues, with evidence instead of speculation.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Ground rules

1. **Authorized scope only.** Review code the user owns or is authorized to assess. Dynamic testing only against environments the user controls, with non-destructive, low-volume checks. No denial-of-service, no data destruction, no attacks on third-party systems.
2. **Evidence over speculation.** Never report something you haven't traced in the actual code or config. Never invent files, routes, packages or settings.
3. **Separate vulnerabilities from hardening.** A missing best practice is not a vulnerability unless you can show impact.
4. **Redact secrets** in all output (`sk_live_****`).
5. **Explain before changing code.** Fix only when asked, or when the user's request implies it.

Read `references/methodology.md` once per review. It defines the evidence standard, confidence levels and the severity rubric used below.

## Workflow

### 1. Scope

Establish what is being reviewed. If the user didn't say, infer it and state the assumption:

- **Full review:** the whole repository.
- **Diff / PR review:** only changed files plus the code they call and are called by. Use `git diff <base>...HEAD` or the PR. Report pre-existing issues only if the change makes them reachable or worse.
- **Feature review:** one flow (e.g. checkout, file upload, login), traced end to end.

### 2. Detect the stack

Use `references/stack-detection.md`. Record languages, frameworks **with versions from lock files**, auth mechanism, data stores, deployment/infra files, and AI/LLM usage.

### 3. Load the right knowledge

- If a matching framework skill is installed (e.g. `laravel-security`), **use it** for that part of the code. It has the framework-specific locations, APIs, defaults and false positives.
- For anything without a framework skill, use the built-in checklists:

| Area | Reference |
|---|---|
| Authentication, sessions, tokens, OAuth/OIDC, JWT, MFA | `references/authentication-sessions.md` |
| Authorization, IDOR/BOLA, multi-tenancy | `references/authorization.md` |
| SQL/NoSQL/command/template injection, deserialization, path traversal, XXE | `references/injection.md` |
| XSS, CSRF, CORS, clickjacking, open redirects, client-side issues | `references/client-side.md` |
| SSRF and file uploads/downloads | `references/ssrf-files.md` |
| Secrets, configuration, headers, logging, rate limiting, cryptography | `references/secrets-config-crypto.md` |
| API-specific risks (REST, GraphQL, WebSockets, webhooks) | `references/api-security.md` |
| Dependencies, lock files, CI/CD and supply chain, containers | `references/supply-chain.md` |
| Business logic, race conditions, payments, workflows | `references/business-logic.md` |
| LLM / AI agent features (prompt injection, tool use, RAG, MCP) | `references/llm-security.md` |

Load a reference only when you reach that area.

### 4. Map the attack surface

List entry points (HTTP routes, GraphQL resolvers, WebSocket handlers, queue consumers, webhooks, CLI/cron, mobile deep links, LLM tools) and mark: authentication required? role required? takes identifiers, URLs, files, HTML or queries? Prioritize **unauthenticated → authenticated → admin** and **money / PII / credentials / code execution** paths.

For a quick threat model (when asked, or for new features), answer: what are the assets, who are the actors (anonymous, user, other tenant, admin, integration), where are the trust boundaries, and what is the worst outcome per boundary?

### 5. Review and trace

For each candidate issue, trace **source → transformations/controls → sink** with file:line references. Check that the control isn't applied somewhere else (middleware, decorators, base classes, gateways, ORM scopes, framework defaults) before reporting it missing.

### 6. Classify

Assign **confidence** (Confirmed / Likely / Hardening / Informational) and **severity** (Critical / High / Medium / Low / Info) using `references/methodology.md`. Drop anything you can't support with evidence, or move it to "Needs verification" with the specific question that would settle it.

### 7. Report

Use `references/report-template.md`. Order findings by severity and put Confirmed before Likely. Be concise: one finding per root cause, listing all affected locations.

### 8. Fix and verify (when asked)

Make the smallest change using the framework's own security mechanism. Add a regression test that fails before and passes after. Search for and fix sibling occurrences. Rotate any exposed secret. Report what was verified and what couldn't be.

## Build mode (writing secure code)

When you are writing code rather than reviewing it, apply these defaults without being asked:

- Validate input at the boundary with an allow-list schema. Use only the validated object downstream.
- Enforce authorization server-side on every request and object. Scope queries by owner/tenant.
- Use parameterized queries and ORM APIs. Never build SQL, shell commands or templates with string concatenation.
- Encode output for its context. Avoid raw-HTML APIs (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`, `{!! !!}`) unless the content is sanitized.
- Store secrets in environment or secret managers, never in code or client bundles.
- Use framework-provided auth, session, CSRF and crypto. Never write custom crypto.
- Make outbound requests to user-supplied URLs only through an allow-list. Treat uploads as hostile (random names, type allow-list, private storage).
- For LLM features: treat model output as untrusted input, give tools least privilege, and require human confirmation for destructive actions.
- Add a test that proves the security boundary.

## References

- OWASP Top 10 (2025): https://owasp.org/Top10/2025/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
- OWASP API Security Top 10 (2023): https://owasp.org/API-Security/
- OWASP Top 10 for LLM Applications (2025): https://genai.owasp.org/llm-top-10/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- CWE: https://cwe.mitre.org/
