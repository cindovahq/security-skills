<p align="center">
  <a href="https://cindova.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-on-light.png">
      <img src="assets/logo.png" alt="Cindova Technologies" width="320">
    </picture>
  </a>
</p>

<h1 align="center">Cindova Security Skills</h1>

<p align="center"><b>Framework-aware security skills for AI coding agents.</b></p>

They give Claude Code, GitHub Copilot (VS Code), Kiro, Cursor, Codex, Google Antigravity, Gemini CLI, JetBrains Junie, Windsurf/Devin, Cline, OpenCode and other agents a precise, repeatable method to **find, explain, fix and verify** security issues, and to avoid introducing them when writing code.

[![Validate](https://github.com/cindovahq/security-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/cindovahq/security-skills/actions/workflows/validate.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-8A2BE2)](https://agentskills.io)

- **Evidence over speculation.** Every finding is traced from attacker input to the vulnerable code, with file:line evidence, a confidence level, and a way to verify the fix.
- **Framework-aware.** Skills know each framework's real APIs, defaults and version differences, and the false positives a generic security prompt would raise.
- **Low noise.** Vulnerabilities, likely issues and hardening suggestions are kept separate, and each skill documents what *not* to report.
- **Two modes.** *Review mode* audits code, PRs or diffs. *Build mode* applies secure defaults while the agent writes code.
- **Open standard.** Plain `SKILL.md` files in the [Agent Skills](https://agentskills.io) format work in any compatible agent, installed per project or globally.

> [!WARNING]
> **AI can make mistakes. Review every finding and fix before you act on it.**
> These skills guide AI agents, and AI output can be wrong or incomplete. A review may miss real vulnerabilities, report issues that aren't exploitable, misjudge severity, or suggest a fix that breaks behavior or introduces a new bug. The skills themselves were written with AI assistance and checked against official documentation, but framework guidance changes over time. Treat results as a starting point for a qualified human reviewer, test every fix before deploying it, and don't rely on these skills as your only security control. They're provided "as is", without warranty, under the [Apache License 2.0](LICENSE).

## Skills

| Skill | Use it for | Status |
|---|---|---|
| [`appsec-review`](skills/appsec-review/SKILL.md) | Security reviews of any codebase, PR or diff. Detects the stack, routes to framework skills, and falls back to built-in checklists for auth, access control, injection, XSS/CSRF/CORS, SSRF, uploads, secrets, crypto, APIs, supply chain/CI, business logic and **LLM/AI features**. | beta |
| [`wordpress-security`](skills/wordpress-security/SKILL.md) | WordPress 6.x–7.x plugins, themes and sites, plus **WooCommerce**: capability checks, nonces, `$wpdb->prepare`, escaping, AJAX/REST/admin-post handlers, the Abilities API, object injection, uploads and file operations, SSRF/redirects, `wp-config.php`, order IDOR, price tampering and payment callbacks. | beta |
| [`nextjs-security`](skills/nextjs-security/SKILL.md) | Next.js 14–16 (App and Pages Router): Server Actions, Route Handlers, `proxy.ts`/middleware limits, React Server Components advisories (React2Shell), data leaks to Client Components, `NEXT_PUBLIC_` secrets, cross-user caching, XSS, image-optimizer SSRF, Auth.js/Clerk/Supabase sessions, CSP. | beta |
| [`supabase-security`](skills/supabase-security/SKILL.md) | Supabase: RLS and policies, API keys (publishable/secret/service role), exposed schemas and grants, `SECURITY DEFINER` functions and views, Storage policies, Auth settings, `@supabase/ssr` server clients, Edge Functions, Realtime authorization, pg_net/cron/Vault, Security Advisor. | beta |
| [`react-security`](skills/react-security/SKILL.md) | React 18–19 apps (Vite, React Router 7–8 framework mode, TanStack, legacy CRA): raw-HTML sinks and sanitization, Markdown rendering, URL and redirect handling, SSR state serialization, secrets in `VITE_`/`REACT_APP_` bundles, token storage, client-only route guards, loader/action authorization and CSRF, `postMessage`, iframes, dynamic code, CSP, dependency advisories. | beta |
| [`nodejs-security`](skills/nodejs-security/SKILL.md) | Node.js servers (Express 4/5, Fastify, Koa, Hono): auth, sessions and cookies, CSRF/CORS, middleware ordering and IDOR, SQL/NoSQL/command/template injection, prototype pollution, path traversal, SSRF, uploads, secrets and config, npm supply chain. | beta |
| [`nestjs-security`](skills/nestjs-security/SKILL.md) | NestJS 10–12: guards and the request pipeline, fail-open `@Public()`/`handleRequest` patterns, `ValidationPipe` and DTO mass assignment, serialization leaks, Passport/JWT, TypeORM/Prisma/Mongoose injection, CORS/CSRF, throttling, GraphQL field resolvers, WebSocket gateways, microservice transports, uploads, Swagger exposure, dependency advisories. | beta |
| [`django-security`](skills/django-security/SKILL.md) | Django 4.2–6.1 and Django REST framework: `settings.py` and `check --deploy`, password hashing, IDOR and queryset scoping, CSRF, ORM injection and lookup abuse (`raw`, `extra`, `order_by`, `filter(**…)`), templates and `mark_safe`, serializer mass assignment, DRF permissions and throttling, uploads and `serve`, SSRF, pickle, Celery tasks, admin. | beta |
| [`laravel-security`](skills/laravel-security/SKILL.md) | Laravel 10–13: authentication, authorization/IDOR, sessions, CSRF (incl. Laravel 13 `PreventRequestForgery`), validation and mass assignment, SQL/command/deserialization injection, XSS, SSRF, uploads, secrets/debug exposure, Sanctum/Passport APIs, Livewire/Filament, dependencies, and fix verification. | beta |

More frameworks are on the way: Spring Boot, ASP.NET Core, Flutter. See the [roadmap](docs/ROADMAP.md).

## Install

Works per project (commit it so your whole team gets it) or globally (all your projects).

### Option 1: Cindova installer (recommended)

No dependencies, just Node.js 18+:

```bash
# Interactive: choose your agents
npx github:cindovahq/security-skills install

# This project, for specific agents
npx github:cindovahq/security-skills install --agent claude,kiro,agents

# Everything, globally
npx github:cindovahq/security-skills install --agent all --global

# One skill, one agent
npx github:cindovahq/security-skills install --agent antigravity --skill laravel-security

# See agent ids and folders
npx github:cindovahq/security-skills list
```

The `agents` target writes to `.agents/skills`, the shared folder read by **Codex, GitHub Copilot, Cursor, Gemini CLI, Google Antigravity, Windsurf/Devin, JetBrains Junie and OpenCode**. `claude`, `kiro` and `cline` have their own folders. `--agent all` covers all of them.

**Agent without Agent Skills support?** (e.g. Zed, Aider, or older tools that only read an instructions file.) Use `agents-md`. It copies the skills into `.agents/skills` and adds a short block to `AGENTS.md`, or any file you pass with `--file`, telling the agent when to open each skill:

```bash
npx github:cindovahq/security-skills agents-md
npx github:cindovahq/security-skills agents-md --file CONVENTIONS.md
```

### Option 2: Claude Code plugin

```text
/plugin marketplace add cindovahq/security-skills
/plugin install cindova-security@cindova
```

Skills appear as `/cindova-security:appsec-review` and `/cindova-security:laravel-security`, and load automatically when relevant.

### Option 3: `skills` CLI

The community [`skills` CLI](https://github.com/vercel-labs/skills) also works:

```bash
npx skills add cindovahq/security-skills            # interactive
npx skills add cindovahq/security-skills -g         # global
```

### Option 4: Kiro import or manual copy

In Kiro's skills panel, import from GitHub and paste a **skill folder** URL, e.g. `https://github.com/cindovahq/security-skills/tree/main/skills/laravel-security`. To install by hand, copy a folder from `skills/` into your agent's skills directory:

| Agent | Project | Global |
|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| GitHub Copilot (VS Code / Visual Studio / CLI) | `.github/skills/` or `.agents/skills/` | `~/.copilot/skills/` or `~/.agents/skills/` |
| Kiro | `.kiro/skills/` | `~/.kiro/skills/` |
| Cursor | `.agents/skills/` or `.cursor/skills/` | `~/.agents/skills/` or `~/.cursor/skills/` |
| OpenAI Codex | `.agents/skills/` | `~/.agents/skills/` |
| Google Antigravity | `.agents/skills/` | `~/.gemini/config/skills/` (IDE), `~/.gemini/antigravity-cli/skills/` (CLI) |
| Gemini CLI | `.agents/skills/` or `.gemini/skills/` | `~/.agents/skills/` or `~/.gemini/skills/` |
| Windsurf / Devin Desktop | `.agents/skills/` or `.devin/skills/` | `~/.agents/skills/` or `~/.config/devin/skills/` |
| JetBrains Junie | `.agents/skills/` or `.junie/skills/` | `~/.agents/skills/` or `~/.junie/skills/` |
| OpenCode | `.agents/skills/` or `.opencode/skills/` | `~/.agents/skills/` or `~/.config/opencode/skills/` |
| Cline | `.cline/skills/` | `~/.cline/skills/` |

See [docs/INSTALL.md](docs/INSTALL.md) for updating, uninstalling and troubleshooting.

## Usage

Skills load automatically when your request matches. You can also invoke them by name (`/laravel-security` in most agents).

```text
Do a security review of this Laravel app.
Review this PR for security issues.
Is the file upload in AvatarController safe?
Threat-model the new checkout flow before we build it.
Add a password-reset flow (the agent applies build-mode guardrails automatically).
Fix the IDOR you found and add a regression test.
```

A finding looks like this:

```markdown
### F-03 [HIGH] Any user can view any invoice (IDOR) — Confirmed
- **Location:** `app/Http/Controllers/InvoiceController.php:11` (`InvoiceController::show`)
- **Evidence:** route `GET /invoices/{invoice}` is only behind `auth`. `show(Invoice $invoice)` returns the
  model with no policy, Gate check or ownership scope.
- **Impact:** any logged-in user can read any customer's invoice (amounts, billing address) by changing the ID.
- **Fix:** `Gate::authorize('view', $invoice);` with `InvoicePolicy@view` comparing `user_id`.
- **Verify:** feature test — user B requesting user A's invoice gets 403.
```

## How it's built

```text
skills/<name>/
├── SKILL.md          # short workflow + triggers (loaded when relevant)
└── references/*.md   # deep, topic-specific guidance (loaded only when needed)
```

Progressive disclosure keeps the agent's context small: only skill descriptions load at startup, and each reference file loads only when the review reaches that area.

## Quality

- `node scripts/validate.mjs` checks every skill against the Agent Skills spec and repository rules: names, descriptions, metadata, size limits, broken references, and accidentally committed secrets. CI also runs the official `skills-ref` validator and `claude plugin validate`.
- `tests/fixtures/` contains **deliberately vulnerable** sample apps with an answer key (`expected-findings.json`): issues a review must find, and safe patterns it must *not* report. `node scripts/score-eval.mjs` scores a review against it. See [tests/README.md](tests/README.md).
- Framework claims are checked against official documentation and framework source for the versions listed in each skill's `metadata.last-verified`.

## Responsible use

Use these skills only on code and systems you own or are authorized to assess. They're built for static review and safe, non-destructive verification. They don't contain exploit payloads for third-party systems. Their output can be wrong: a review by these skills doesn't guarantee an application is secure, and it doesn't replace a professional penetration test.

## Contributing

Contributions are welcome: new framework skills, fixes to framework-specific guidance, new false-positive notes, and new test fixtures. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [skill authoring spec](docs/SKILL-SPEC.md).

To report a security issue in this repository, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). Copyright 2026 Cindova Technologies.

---

Built and maintained by [Cindova Technologies](https://cindova.com).
