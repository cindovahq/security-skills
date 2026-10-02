# Stack Detection

## Contents
- Procedure
- Signals by ecosystem
- Framework skill routing
- Infrastructure and services
- AI / LLM usage

## Procedure

1. List the repository root and top-level directories. Monorepos: repeat per package/app (`apps/*`, `packages/*`, `services/*`).
2. Read manifests **and lock files**. Versions come from lock files (`composer.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `Gemfile.lock`, `go.sum`, `Cargo.lock`, `gradle.lockfile`, `packages.lock.json`), not from ranges in manifests.
3. Confirm with code: imports, entry points, config files. Never decide a framework from a directory name alone.
4. Record: languages, frameworks + versions, auth libraries, ORM/data stores, front-end framework, mobile, infra-as-code, CI, AI/LLM SDKs.

## Signals by ecosystem

| Ecosystem | Strong signals |
|---|---|
| **Laravel** | `artisan`, `laravel/framework` in `composer.json`/`composer.lock`, `bootstrap/app.php` |
| **WordPress** | `wp-config.php`, `wp-content/`, `wp-includes/`; plugin header `Plugin Name:` in a PHP file; theme `style.css` with `Theme Name:` |
| **WooCommerce** | `woocommerce` plugin directory or `woocommerce/woocommerce` dependency; `WC_` classes |
| **Symfony** | `symfony/framework-bundle`, `bin/console`, `config/packages/` |
| **Node / Express** | `package.json` with `express`; `app.listen`, `express()` |
| **NestJS** | `@nestjs/core`, `nest-cli.json`, `*.module.ts` with `@Module` |
| **Next.js** | `next` dependency, `next.config.*`, `app/` or `pages/` router, `middleware.ts` |
| **React / Vue / Angular / Svelte** | `react`/`react-dom`, `vue`, `@angular/core`, `svelte`/`@sveltejs/kit` |
| **Django** | `manage.py`, `django` in requirements/lock, `settings.py`, `urls.py` |
| **FastAPI / Flask** | `fastapi` / `flask` in requirements; `FastAPI()` / `Flask(__name__)` |
| **Rails** | `Gemfile` with `rails`, `config/routes.rb`, `app/controllers` |
| **Spring Boot** | `pom.xml`/`build.gradle` with `spring-boot-starter-*`, `@SpringBootApplication` |
| **ASP.NET Core** | `*.csproj` with `Microsoft.AspNetCore.*` / `Sdk="Microsoft.NET.Sdk.Web"`, `Program.cs` |
| **Go** | `go.mod`; `net/http`, `gin-gonic/gin`, `labstack/echo`, `gofiber/fiber` |
| **Rust** | `Cargo.toml`; `axum`, `actix-web`, `rocket` |
| **Flutter** | `pubspec.yaml` with `flutter:` SDK, `lib/main.dart` |
| **React Native** | `react-native` dependency, `ios/` + `android/`, `app.json`/`expo` |
| **Android / iOS native** | `AndroidManifest.xml`, `build.gradle(.kts)`; `*.xcodeproj`, `Info.plist`, `Package.swift` |
| **Supabase / Firebase** | `supabase/` dir, `@supabase/supabase-js`; `firebase.json`, `firestore.rules`, `storage.rules`, `firebase` SDK |
| **GraphQL** | `schema.graphql`, `apollo-server`, `graphql-yoga`, `lighthouse`, `graphene`, `strawberry`, `HotChocolate` |
| **Electron** | `electron` dependency, `BrowserWindow`, `preload.js` |

## Framework skill routing

Use a framework skill when it's installed. Otherwise fall back to this skill's built-in references.

| Detected | Skill | Status |
|---|---|---|
| Laravel | `laravel-security` | available |
| WordPress / WooCommerce | `wordpress-security` | available |
| Next.js (+ Supabase) | `nextjs-security`, `supabase-security` | available |
| Node.js / Express | `nodejs-security` | available |
| NestJS | `nestjs-security` | available |
| React | `react-security` | available |
| Django | `django-security` | available |
| Spring Boot | `spring-boot-security` | planned |
| ASP.NET Core | `aspnet-core-security` | planned |
| Flutter | `flutter-security` | planned |

To check what's installed, look in the agent's skills directories (project or home: `.agents/skills/`, `.claude/skills/`, `.kiro/skills/`, `.github/skills/`, `.cursor/skills/`, `.cline/skills/`, `.junie/skills/`, `~/.gemini/config/skills/`) or the agent's skill list.

## Infrastructure and services

| Signal | Review focus (see `secrets-config-crypto.md`, `supply-chain.md`) |
|---|---|
| `Dockerfile`, `docker-compose*.yml` | Root user, secrets in layers/`ENV`, exposed ports, `latest` tags, mounted Docker socket |
| `k8s/`, `helm/`, `*.yaml` with `kind:` | Privileged pods, `hostPath`, secrets in plain manifests, missing NetworkPolicies, RBAC wildcards |
| `*.tf`, `cdk.json`, `serverless.yml`, CloudFormation | Public buckets, `0.0.0.0/0` ingress, wildcard IAM, unencrypted stores, IMDSv1 |
| `nginx.conf`, `.htaccess`, `Caddyfile` | Document root, PHP execution in upload dirs, missing TLS/HSTS, `autoindex`, proxy header handling |
| `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile` | See `supply-chain.md` → CI/CD |
| `vercel.json`, `netlify.toml`, `wrangler.toml` | Exposed env vars to client, headers, edge middleware auth |

## AI / LLM usage

Signals: `openai`, `@anthropic-ai/sdk`, `anthropic`, `@google/genai`, `langchain`, `llamaindex`, `ai` (Vercel AI SDK), `@modelcontextprotocol/sdk`, `mcp` servers, vector DB clients (`pinecone`, `weaviate`, `qdrant`, `pgvector`, `chromadb`), prompt files, `tools`/`function_calling` definitions. If present, review with `llm-security.md`.
