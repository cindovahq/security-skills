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
| `spring-boot-security` (Spring Boot 3.x–4.x, Spring Security 6.5–7.x) | 1.0.0 |
| `aspnet-core-security` (ASP.NET Core on .NET 8–10) | 1.0.0 |
| `flutter-security` (Flutter 3.x, Dart 3.x) | 1.0.0 |

## Next

The first framework roadmap is complete. Next candidates, in rough priority order (open an issue to vote):

| Skill | Notes |
|---|---|
| `rails-security` | Strong parameters, `find` scoping, `html_safe`/`raw`, `send`/`constantize`, Active Storage, credentials |
| `fastapi-security` | Dependency-based auth, Pydantic models and response filtering, SQLAlchemy raw SQL, CORS, background tasks |
| `firebase-security` | Firestore/RTDB/Storage rules, App Check, Cloud Functions auth, Admin SDK keys |
| `go-security` | `net/http`, Gin/Echo, `database/sql`, `html/template` vs `text/template`, SSRF, path handling |
| `github-actions-security` | `pull_request_target`, script injection, token permissions, pinned actions, OIDC |

## Later

- **Frameworks:** Flask, SvelteKit, Nuxt, Rust (Axum, Actix), Symfony, Angular, Vue, React Native, Android (Kotlin), iOS (Swift), Electron, browser extensions, Shopify apps.
- **Platforms and data:** PostgreSQL (roles, RLS), MySQL, MongoDB, Redis, Elasticsearch.
- **Infrastructure:** Docker, Kubernetes, Terraform, Nginx/Apache, AWS, Azure, GCP, Cloudflare (Workers/WAF), serverless (Lambda, Vercel, Netlify).
- **CI/CD:** GitLab CI, CircleCI and Jenkins skills (currently covered in `appsec-review` → `supply-chain.md`).
- **AI:** dedicated `llm-app-security` and `mcp-server-security` skills (currently covered in `appsec-review` → `llm-security.md`).
- **Payments:** Stripe, PayPal and Razorpay integration checks (webhooks, idempotency, amount integrity).

## Tooling

- Vulnerable fixture and answer key for `nodejs-security` (the skill ships without one in 1.2.0). Parked, see [PENDING.md](PENDING.md) P-001.
- Automated eval runner: run each fixture through supported agents in CI and track recall and false-positive rate per release.
- SARIF output helper for GitHub code scanning.
- More fixtures per framework, including "secure twin" fixtures where no finding should be reported.
- Publish to Anthropic's plugin directory and community skill registries.

Have a request? [Open an issue](https://github.com/cindovahq/security-skills/issues/new/choose).
