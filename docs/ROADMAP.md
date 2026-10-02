# Roadmap

Priorities are based on how widely each stack is used with AI coding agents and how often its real-world breaches come from code-level mistakes.

## Released

| Skill | Version |
|---|---|
| `appsec-review` (methodology, stack routing, generic checklists incl. LLM/agent security) | 1.0.0 |
| `laravel-security` (Laravel 10–13) | 1.0.0 |
| `wordpress-security` (WordPress 6.x–7.x, WooCommerce) | 1.0.0 |
| `nextjs-security` (Next.js 14–16) | 1.0.1 |
| `supabase-security` | 1.0.0 |
| `nodejs-security` (Express, Fastify, Koa, Hono) | 1.0.1 |
| `nestjs-security` (NestJS 10–12) | 1.0.0 |
| `react-security` (React 18–19, Vite, React Router, TanStack) | 1.0.0 |
| `django-security` (Django 4.2–6.1, Django REST framework) | 1.0.0 |

## Next: framework skills

Each one follows the `laravel-security` template: a short `SKILL.md` workflow, references for authentication, authorization, sessions, CSRF, validation, injection, XSS, SSRF, uploads, secrets/config, APIs, dependencies and verification, plus a vulnerable fixture with an answer key.

| Order | Skill | Notes |
|---|---|---|
| 1 | `spring-boot-security` | `SecurityFilterChain`, method security, Actuator, SpEL, deserialization, JPA queries |
| 2 | `aspnet-core-security` | Authorization policies, antiforgery, EF Core raw SQL, Data Protection, model binding |
| 3 | `flutter-security` | Secure storage, certificate pinning, deep links, WebViews, secrets in binaries, platform channels |

## Later

- **Frameworks:** Ruby on Rails, FastAPI, Flask, Express (separate from Node), SvelteKit, Nuxt, Go (net/http, Gin, Echo), Rust (Axum, Actix), Symfony, Angular, Vue, React Native, Android (Kotlin), iOS (Swift), Electron, browser extensions, Shopify apps.
- **Platforms and data:** Firebase (security rules), PostgreSQL (roles, RLS), MySQL, MongoDB, Redis, Elasticsearch.
- **Infrastructure:** Docker, Kubernetes, Terraform, Nginx/Apache, AWS, Azure, GCP, Cloudflare (Workers/WAF), serverless (Lambda, Vercel, Netlify).
- **CI/CD:** GitHub Actions and GitLab CI skills (currently covered in `appsec-review` → `supply-chain.md`).
- **AI:** dedicated `llm-app-security` and `mcp-server-security` skills (currently covered in `appsec-review` → `llm-security.md`).
- **Payments:** Stripe, PayPal and Razorpay integration checks (webhooks, idempotency, amount integrity).

## Tooling

- Vulnerable fixture and answer key for `nodejs-security` (the skill ships without one in 1.2.0). Parked, see [PENDING.md](PENDING.md) P-001.
- Automated eval runner: run each fixture through supported agents in CI and track recall and false-positive rate per release.
- SARIF output helper for GitHub code scanning.
- More fixtures per framework, including "secure twin" fixtures where no finding should be reported.
- Publish to Anthropic's plugin directory and community skill registries.

Have a request? [Open an issue](https://github.com/cindovahq/security-skills/issues/new/choose).
