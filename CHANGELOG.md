# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-10-02

### Added
- `nextjs-security` skill (Next.js 14–16): Server Actions, Route Handlers, proxy/middleware limits, RSC advisories, data exposure to Client Components, secrets, caching, XSS, SSRF and image optimization, auth libraries, security headers/CSP, dependencies, verification. Includes a vulnerable App Router fixture.
- `supabase-security` skill: API keys, Data API exposure and grants, RLS policies, multi-tenancy, functions/views/triggers, Storage, Auth configuration, SSR clients, Edge Functions, Realtime, webhooks/cron/Vault, verification. Includes a vulnerable Supabase project fixture.
- `nodejs-security` skill (Express 4/5, Fastify, Koa, Hono): authentication, authorization, sessions and cookies, CSRF/CORS, input validation, injection, XSS in templates, SSRF and redirects, files and paths, secrets and config, API security, framework specifics, dependencies, verification. A fixture for this skill is not included yet.
- `scripts/run-eval.mjs`: blinded, one-command evaluations with Claude Code on a chosen model.

### Changed
- Fixtures keep their "deliberately insecure" notice only in `FIXTURE-NOTICE.md`, so code doesn't reveal the answers during evaluations.

## [1.1.0] - 2026-10-02

### Added
- `wordpress-security` skill for WordPress 6.x–7.x and WooCommerce 8.x–11.x: authorization and capabilities, nonces/CSRF, SQL injection, XSS and escaping, input handling and object injection, file uploads, REST/AJAX/Abilities API exposure, SSRF and redirects, authentication, configuration and secrets, WooCommerce, dependencies (including the 2026 core security releases), and verification.
- Deliberately vulnerable WordPress plugin fixture with an answer key (`tests/fixtures/wordpress-vulnerable`).

### Changed
- `laravel-security`: added a severity-calibration section (`orderBy` oracle, Livewire IDOR, mass-assignment chains).
- Validator now rejects unquoted frontmatter values containing `: ` (invalid YAML that strict agents fail to parse).

## [1.0.0] - 2026-10-02

### Added
- `appsec-review` skill: framework-agnostic review methodology (evidence standard, confidence levels, severity matrix, false-positive discipline), stack detection and routing, report template (Markdown, YAML and SARIF mapping), and checklists for authentication/sessions, authorization, injection, client-side issues, SSRF and files, secrets/config/crypto, APIs, supply chain and CI/CD, business logic, and LLM/agent security.
- `laravel-security` skill for Laravel 10.x–13.x, with references for authentication, authorization, sessions, CSRF (including Laravel 13 `PreventRequestForgery`), validation and mass assignment, injection and deserialization, XSS, SSRF and redirects, file uploads, secrets and configuration, API security, dependencies, and verification.
- Claude Code plugin and marketplace manifests (`cindova-security@cindova`).
- Zero-dependency installer (`npx github:cindovahq/security-skills install`) for Claude Code, GitHub Copilot, Kiro, Cursor, Codex, Google Antigravity, Gemini CLI, Windsurf/Devin, JetBrains Junie, OpenCode and Cline, per project or global, plus an `agents-md` fallback for agents that only read `AGENTS.md`.
- Cindova logo and plugin icon (`assets/`).
- Repository validator (`scripts/validate.mjs`) and fixture scorer (`scripts/score-eval.mjs`).
- Deliberately vulnerable Laravel fixture with an answer key (`tests/fixtures/laravel-vulnerable`).
- CI workflow, issue and PR templates, Apache-2.0 license, Contributor Covenant code of conduct.
