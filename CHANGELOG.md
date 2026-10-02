# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- `flutter-vulnerable` fixture: the placeholder Firebase API keys no longer match Google's API-key format, so GitHub secret scanning doesn't flag them. They still start with `AIzaSy` so reviewers recognize the public-by-design pattern.

## [1.4.0] - 2026-10-02

### Added
- `spring-boot-security` skill (Spring Boot 3.x–4.x, Spring Security 6.5–7.x): filter chains and request matchers, authorization and method security, authentication, sessions, CSRF/CORS, API security and Spring Data REST, validation and mass assignment, injection (SQL, JPQL, SpEL), templates and XSS/SSTI, deserialization and XXE, SSRF and redirects, file uploads, Actuator and configuration, dependencies, verification. Includes a vulnerable Spring Boot fixture.
- `aspnet-core-security` skill (ASP.NET Core on .NET 8–10): authentication, JWT bearer, authorization, sessions and Data Protection, CSRF, model binding, injection and deserialization, XSS, SSRF and redirects, file uploads, secrets and configuration, API security (SignalR, gRPC, rate limiting, OpenAPI), Blazor, dependencies, verification. Includes a vulnerable ASP.NET Core fixture.
- `flutter-security` skill (Flutter 3.x, Dart 3.x): secrets in the binary, local storage, network and TLS, authentication, authorization and backend rules, deep links, WebViews, platform channels and native code, platform configuration, logging and privacy, resilience and dynamic code, dependencies, Flutter web, verification. Includes a vulnerable Flutter fixture.

### Changed
- `appsec-review` stack routing now points to the Spring Boot, ASP.NET Core and Flutter skills.
- Fixture `.env` files are no longer git-ignored, so fixtures that plant secrets in `.env` work from a clone.

## [1.3.0] - 2026-10-02

### Added
- `nestjs-security` skill (NestJS 10–12): request pipeline and guard ordering, authentication, authorization, validation and mass assignment, serialization and data exposure, injection, CORS/CSRF/headers, rate limiting and DoS, GraphQL, WebSockets and microservices, file uploads, SSRF and redirects, secrets and config, dependencies, verification. Includes a vulnerable NestJS fixture.
- `react-security` skill (React 18–19, Vite, React Router 7–8, TanStack): XSS sinks, sanitization and Markdown, SSR and hydration, secrets in client bundles, authentication and token storage, authorization, React Router loaders/actions, other React frameworks, CSRF/CORS, SSRF and redirects, browser APIs, dynamic code, security headers/CSP, dependencies, verification. Includes a vulnerable React Router fixture.
- `django-security` skill (Django 4.2–6.1, Django REST framework): settings and secrets, authentication, authorization, sessions, CSRF, validation and mass assignment, injection, XSS, SSRF and redirects, file uploads, DRF permissions, API security, background tasks, dependencies, verification. Includes a vulnerable Django + DRF fixture.
- README notice that AI output can be wrong and every finding and fix needs human review.
- `docs/PENDING.md` for parked work items.

### Changed
- `appsec-review` stack routing now points to the NestJS, React and Django skills.

### Fixed
- `nextjs-security` 1.0.1 and `nodejs-security` 1.0.1: the same-origin redirect helpers could be bypassed. The Next.js one accepted `/<TAB>/evil.example`, which browsers resolve to `//evil.example`, and the Node.js one returned `//evil.example` for `/..//evil.example` after URL normalization. Both now reject control characters and protocol-relative results; all three helpers are tested against the same bypass list.

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
