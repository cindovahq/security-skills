# Skill Authoring Specification

How to write a skill for this repository. Skills must follow the open [Agent Skills specification](https://agentskills.io/specification) so they work in every compatible agent, plus the conventions below.

## Contents
1. Design principles
2. Directory layout
3. Frontmatter
4. Writing the description
5. SKILL.md body
6. Reference files
7. Framework skill template
8. Evidence, confidence and severity
9. Version-specific guidance
10. Fixtures and evaluation
11. Quality checklist

## 1. Design principles

1. **Evidence first.** Teach the agent to trace source → sink and cite file:line. Never instruct it to report a pattern without tracing.
2. **Framework-aware.** Name the real files, APIs, config keys, defaults and middleware for the framework and version.
3. **False positives are content.** Every skill documents what looks dangerous but isn't, e.g. framework behavior that already provides the control.
4. **Actionable and verifiable.** Every class of finding has a framework-native fix and a way to verify it (test, command, or safe request).
5. **Concise.** The agent is already capable. Add only what it wouldn't know or would get wrong. Every line costs context.
6. **Safe.** Non-destructive verification only. No exploit payloads aimed at third parties. Authorized use only.
7. **Self-contained.** A framework skill must work even if `appsec-review` isn't installed. It can refer to `appsec-review` by name but must not depend on its files.

## 2. Directory layout

```text
skills/<skill-name>/
├── SKILL.md              # required: frontmatter + workflow (≤ 500 lines, aim for < 200)
├── references/           # topic files, loaded on demand
│   ├── authentication.md
│   └── ...
├── scripts/              # optional: helper scripts the agent can run
└── assets/               # optional: templates, data files
```

- Folder name = `name` in frontmatter.
- Keep references **one level deep**: `SKILL.md` links to `references/x.md`. Reference files may mention each other by filename (`see authorization.md`), but don't build long chains.
- No `README.md` inside skill folders. Documentation for humans goes in `docs/`.
- No `.DS_Store` or other OS files.

## 3. Frontmatter

```yaml
---
name: laravel-security
description: <what it does and when to use it, ≤ 1024 chars, single line>
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "Laravel 10.x, 11.x, 12.x, 13.x"
  last-verified: "2026-10-02"
---
```

| Field | Rule |
|---|---|
| `name` | Required. Lowercase letters, digits and single hyphens, ≤ 64 chars, matches folder. Convention: `<technology>-security` for framework skills. |
| `description` | Required. Single line, ≤ 1024 chars. See section 4. |
| `license` | `Apache-2.0`. |
| `metadata` | String values only. Required keys: `author`, `version` (semver), `status` (`draft`, `experimental`, `beta`, `stable`, `deprecated`). Recommended: `framework-versions`, `last-verified` (date the content was last checked against official docs). |

Don't add other top-level fields (`id`, `tags`, `category`, ...). They aren't part of the spec and some agents reject them. Put extra data under `metadata`. Use single-line values: block scalars (`>`/`|`) aren't parsed consistently across agents.

## 4. Writing the description

Agents decide whether to load a skill **from the description alone**. It must say:

1. **What** the skill does ("Security review and secure-coding guidance for Laravel 10.x–13.x applications").
2. **When** to use it, with the words users actually type ("Use when auditing, reviewing or hardening ... or when writing or changing ...").
3. **Detection cues** ("projects containing `artisan` and `laravel/framework` in composer.json").
4. **Coverage keywords** (authentication, IDOR, CSRF, SQL injection, uploads, ...).

Write in the third person. Don't describe the skill's internal structure.

## 5. SKILL.md body

Recommended structure for framework skills:

1. One-line purpose.
2. **Path note:** "All paths (`references/...`) are relative to the directory containing this SKILL.md."
3. **Modes:** review mode and build mode.
4. **Review workflow:** confirm stack and version (from lock files) → map attack surface → review by area (table: area → reference file → first things to look for) → classify → remediate and verify.
5. **High-signal patterns:** grep-able strings, clearly labeled as investigation signals, not findings.
6. **Common false positives:** framework behaviors that make scary-looking code safe.
7. **Build-mode guardrails:** numbered secure defaults for writing new code.
8. **Evidence and reporting rules:** a compact version, for when `appsec-review` isn't installed.
9. **References:** official docs, OWASP, CWE.

## 6. Reference files

- One topic per file, 60–200 lines. Files over 100 lines start with a `## Contents` list.
- Per topic: how the framework implements the control (with version differences) → what to investigate (with code) → fix pattern (with code) → severity notes → false positives → verification (test code) → references (OWASP / CWE / official docs).
- Code examples are minimal and idiomatic for the current framework version.
- Every factual claim about framework behavior must be verifiable in official docs or framework source. Prefer quoting config keys, class and method names exactly.

## 7. Framework skill template

Required reference topics for a framework skill (combine or split as the framework requires):

| File | Covers |
|---|---|
| `authentication.md` | Login, password storage, brute force, reset, MFA, remember-me, SSO |
| `authorization.md` | Object- and function-level access control, admin areas, multi-tenancy, framework-specific entry points |
| `sessions.md` | Session config, fixation, logout, token lifecycle |
| `csrf.md` | Framework CSRF mechanism, exclusions, SPA/API interplay |
| `validation-mass-assignment.md` | Validation APIs, mass assignment, type issues |
| `injection.md` | SQL/NoSQL/command/template injection, deserialization, file inclusion |
| `xss.md` | Template escaping model, raw-output sinks, context traps |
| `ssrf-redirects.md` | Outbound requests, open redirects |
| `file-uploads.md` | Upload validation, storage, serving, downloads |
| `secrets-config.md` | Secrets, debug/production config, proxies, CORS, headers, rate limiting, logging, crypto |
| `api-security.md` | Token auth, data exposure, resource limits, webhooks, real-time, GraphQL |
| `dependencies.md` | Support status, audit commands, notable advisories |
| `verification.md` | How to prove findings and fixes for this framework |

## 8. Evidence, confidence and severity

Use the shared model from `skills/appsec-review/references/methodology.md`:

- Confidence: **Confirmed**, **Likely** (name the unverified condition), **Hardening**, **Informational**.
- Severity: impact × likelihood matrix → Critical / High / Medium / Low / Info, adjusted for business context.
- Severity guidance in a skill should give ranges with conditions ("High if unauthenticated; Medium if admin-only"), not a fixed label per pattern.

## 9. Version-specific guidance

- Name versions explicitly ("Laravel 13 renamed `VerifyCsrfToken` to `PreventRequestForgery`").
- Teach the agent to read the **installed** version from the lock file and to check the actual project structure. Upgraded apps keep old structures.
- When behavior differs across supported versions, use a version table rather than separate files, unless the differences are large.
- Update `metadata.last-verified` whenever content is re-checked against a new framework release.

## 10. Fixtures and evaluation

Each framework skill ships with at least one fixture in `tests/fixtures/<framework>-vulnerable/`:

- A minimal, realistic app skeleton with **seeded vulnerabilities** across the skill's topics.
- **Traps:** safe code that looks dangerous, covering the skill's documented false positives.
- `expected-findings.json` with `findings` (must report), `optional`, and `traps` (must not report as vulnerabilities).
- No real secrets, no working exploit chains against third parties, and a clear "do not deploy" notice.

See [tests/README.md](../tests/README.md) for running evaluations.

## 11. Quality checklist

```text
[ ] node scripts/validate.mjs passes (no errors, no new warnings)
[ ] name matches folder; description says what + when + detection cues
[ ] SKILL.md < 500 lines; references one level deep; files > 100 lines have ## Contents
[ ] versions documented; claims checked against official docs/source; last-verified updated
[ ] every topic: investigate → fix → severity → false positives → verification
[ ] build-mode guardrails present
[ ] fixture with findings + traps; eval run recorded in the PR
[ ] no real secrets; no destructive or third-party-targeting instructions
[ ] README skill table and CHANGELOG updated
```
