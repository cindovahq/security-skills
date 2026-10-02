# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
