# Roadmap

Priorities are based on how widely each stack is used with AI coding agents and how often its real-world breaches come from code-level mistakes.

## Released

| Skill | Version |
|---|---|
| `appsec-review` (methodology, stack routing, generic checklists incl. LLM/agent security) | 1.0.0 |
| `laravel-security` (Laravel 10–13) | 1.0.0 |

## Next: framework skills

Each one follows the `laravel-security` template: a short `SKILL.md` workflow, references for authentication, authorization, sessions, CSRF, validation, injection, XSS, SSRF, uploads, secrets/config, APIs, dependencies and verification, plus a vulnerable fixture with an answer key.

| Order | Skill | Notes |
|---|---|---|
| 1 | `wordpress-security` | Plugins/themes: nonces, capabilities, `$wpdb->prepare`, escaping functions, REST `permission_callback`, AJAX actions, uploads. Includes WooCommerce. |
| 2 | `nextjs-security` | App Router, Server Actions, Route Handlers, middleware limits, `NEXT_PUBLIC_` leaks, caching of personalized data |
| 3 | `supabase-security` | RLS policies, `service_role` exposure, storage policies, Edge Functions, `SECURITY DEFINER` functions |
| 4 | `nodejs-security` | Express/Fastify/Hono middleware, prototype pollution, `child_process`, path handling, JWT libraries |
| 5 | `nestjs-security` | Guards, global pipes/`ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), Passport strategies, WebSocket gateways |
| 6 | `react-security` | Raw-HTML sinks, URL handling, token storage, SSR data leaks, dependency risk |
| 7 | `django-security` | `settings.py` hardening, ORM raw SQL, DRF permissions and serializers, templates, CSRF |
| 8 | `spring-boot-security` | `SecurityFilterChain`, method security, Actuator, SpEL, deserialization, JPA queries |
| 9 | `aspnet-core-security` | Authorization policies, antiforgery, EF Core raw SQL, Data Protection, model binding |
| 10 | `flutter-security` | Secure storage, certificate pinning, deep links, WebViews, secrets in binaries, platform channels |

## Later

- **Frameworks:** Ruby on Rails, FastAPI, Flask, Express (separate from Node), SvelteKit, Nuxt, Remix/React Router, Go (net/http, Gin, Echo), Rust (Axum, Actix), Symfony, Angular, Vue, React Native, Android (Kotlin), iOS (Swift), Electron, browser extensions, Shopify apps.
- **Platforms and data:** Firebase (security rules), PostgreSQL (roles, RLS), MySQL, MongoDB, Redis, Elasticsearch.
- **Infrastructure:** Docker, Kubernetes, Terraform, Nginx/Apache, AWS, Azure, GCP, Cloudflare (Workers/WAF), serverless (Lambda, Vercel, Netlify).
- **CI/CD:** GitHub Actions and GitLab CI skills (currently covered in `appsec-review` → `supply-chain.md`).
- **AI:** dedicated `llm-app-security` and `mcp-server-security` skills (currently covered in `appsec-review` → `llm-security.md`).
- **Payments:** Stripe, PayPal and Razorpay integration checks (webhooks, idempotency, amount integrity).

## Tooling

- Automated eval runner: run each fixture through supported agents in CI and track recall and false-positive rate per release.
- SARIF output helper for GitHub code scanning.
- More fixtures per framework, including "secure twin" fixtures where no finding should be reported.
- Publish to Anthropic's plugin directory and community skill registries.

Have a request? [Open an issue](https://github.com/cindovahq/security-skills/issues/new/choose).
