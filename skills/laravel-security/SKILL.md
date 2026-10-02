---
name: laravel-security
description: Security review and secure-coding guidance for Laravel (10.x–13.x) applications. Use when auditing, reviewing, pentest-prepping or hardening a Laravel/PHP codebase, or when writing or changing Laravel authentication, authorization (policies, gates), sessions, CSRF, Sanctum/Passport APIs, Eloquent queries, form requests and validation, Blade views, file uploads, Livewire/Inertia/Filament code, or configuration (.env, config/*.php, bootstrap/app.php). Triggers on projects containing artisan and laravel/framework in composer.json. Covers authentication, authorization/IDOR, sessions, CSRF, validation and mass assignment, SQL/command/deserialization injection, XSS, SSRF, uploads, secrets and debug exposure, API security, dependencies, and fix verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.1.0"
  status: beta
  framework-versions: "Laravel 10.x, 11.x, 12.x, 13.x"
  last-verified: "2026-10-02"
---

# Laravel Security

Find, explain, fix and verify security issues in Laravel applications, and write new Laravel code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: the user asks for an audit, security review, pentest prep, or "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: you are writing or modifying Laravel code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change. Load only the reference for the area you are touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the Laravel-specific knowledge. If it is not installed, use the [evidence and reporting rules](#evidence-and-reporting-rules) below.

## Review workflow

### 1. Confirm the stack and version

1. Confirm Laravel: `artisan` at the project root and `laravel/framework` in `composer.json`.
2. Read the **installed** version from `composer.lock` (`"name": "laravel/framework"` → `"version"`), not the constraint in `composer.json`.
3. Determine the application structure era. Upgraded apps often keep the old structure, so check the files rather than assuming from the version:
   - **Laravel ≤10 structure**: `app/Http/Kernel.php`, `app/Http/Middleware/*.php` (`VerifyCsrfToken`, `TrustProxies`, `TrustHosts`, `EncryptCookies`), `app/Exceptions/Handler.php`.
   - **Laravel 11+ structure**: middleware, exceptions and routing configured in `bootstrap/app.php` via `->withMiddleware(...)` and `->withExceptions(...)`. There is no `routes/api.php` until `php artisan install:api` is run.
4. Record security-relevant packages from `composer.lock` and `package.json`: Sanctum, Passport, Fortify, Breeze, Jetstream, Socialite, Livewire, Inertia, Filament, Nova, Telescope, Horizon, Pulse, Debugbar, Ignition, spatie/laravel-permission, Cashier, Lighthouse, any JWT package.
5. Check support status. Laravel 10 (security fixes ended Feb 2025) and 11 (ended Mar 2026) no longer receive security patches. 12 is supported until Feb 2027 and 13 until Mar 2028. An unsupported framework version is a finding; see `references/dependencies.md`.

### 2. Map the attack surface

- Routes: `routes/web.php`, `routes/api.php`, `routes/channels.php`, `routes/console.php`, and any route files registered in `bootstrap/app.php` or a `RouteServiceProvider`. If you can run commands, `php artisan route:list -v` shows each route's middleware.
- Entry points beyond controllers: Livewire components (`app/Livewire`, `app/Http/Livewire`), Filament resources and panels, Nova resources, broadcast channels, queued jobs and listeners, console commands and scheduled tasks, webhook controllers, GraphQL schema.
- Unauthenticated routes, admin routes, file download/upload routes, and anything taking an ID, URL, path, filename, sort column or HTML.

### 3. Review each area

Load the reference for each area as you reach it. Do not load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| Authentication | `references/authentication.md` | Custom login code, password hashing, reset flows, throttling, `Auth::loginUsingId`, `TrustHosts` |
| Authorization / IDOR | `references/authorization.md` | Route model binding without policies, `find($request->id)`, Livewire actions, Filament/Nova access, `Gate::before` |
| Sessions | `references/sessions.md` | `config/session.php`, logout code, custom session-based auth, `serialization`, remember-me |
| CSRF | `references/csrf.md` | CSRF `except` lists, state-changing `GET` routes, `allowSameSite`, Sanctum stateful domains |
| Validation & mass assignment | `references/validation-mass-assignment.md` | `$request->all()`, `$guarded = []`, `Model::unguard()`, `forceFill`, `array` rules without keys |
| Injection & deserialization | `references/injection.md` | `DB::raw`, `*Raw(` with interpolation, dynamic column names, `Process`/`exec`, `unserialize`, `decrypt(`, `Blade::render` |
| XSS & output | `references/xss.md` | `{!! !!}`, `href="{{ ... }}"`, `Str::markdown`, raw `response()` HTML, SVG uploads |
| SSRF & redirects | `references/ssrf-redirects.md` | `Http::get($userUrl)`, `file_get_contents`, PDF renderers, `redirect()->to($request->...)` |
| File uploads & storage | `references/file-uploads.md` | `storeAs(..., getClientOriginalName())`, `public` disk, `response()->download($path)`, `mimes` vs extension |
| Secrets & configuration | `references/secrets-config.md` | `.env` in VCS, `APP_DEBUG`, `APP_KEY`, `env()` outside `config/`, debug tools, CORS, `trustProxies` |
| API security | `references/api-security.md` | Sanctum/Passport config, returning models directly, `paginate($request->per_page)`, webhooks, broadcast channels, rate limits |
| Dependencies | `references/dependencies.md` | `composer audit`, `composer.lock`, dev packages in `require`, EOL versions |
| Verification | `references/verification.md` | How to prove each finding and each fix |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation. Classify findings using the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses Laravel's own mechanism. Then verify using `references/verification.md`: the attack no longer works, legitimate use still works, and the same pattern isn't repeated elsewhere (search for siblings).

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# Injection / RCE
DB::raw(  ->whereRaw(  ->selectRaw(  ->orderByRaw(  ->havingRaw(  DB::statement(  DB::unprepared(  DB::select("...$
->orderBy($request  ->where($request->input('field')  DB::table($request
exec(  shell_exec(  system(  passthru(  proc_open(  popen(  `backticks`  Process::run("...$
unserialize(  decrypt($request  Crypt::decrypt(  Blade::render(  Blade::compileString(  eval(
'serialization' => 'php'   'serializable_classes' => true

# Authorization
Route::get('{model}') + controller without authorize/policy     ::find($request->     ::findOrFail($id)
public function authorize() { return true; }   Gate::before(   withoutGlobalScopes(   canAccessPanel   viewNova
Broadcast::channel(... => true)

# Mass assignment
$guarded = []   Model::unguard(   ->forceFill($request   ::create($request->all())   ->update($request->all())

# XSS
{!!   Str::markdown(   ->toHtml()   new HtmlString(   href="{{   response($request   v-html   dangerouslySetInnerHTML

# Files
getClientOriginalName()   getClientOriginalExtension()   storeAs(   ->download(   Storage::disk('public')   'image:allow_svg'

# Config / secrets
APP_DEBUG=true   APP_ENV=local   env(  (outside config/)   'supports_credentials' => true   trustProxies(at: '*')   $proxies = '*'
Telescope  Debugbar  Horizon  Pulse  log-viewer  phpinfo(

# SSRF / redirect
Http::get($   file_get_contents($   fopen($url   redirect()->to($request   redirect($request   away($request   isRemoteEnabled
```

## Common false positives

Do not report these without further evidence:

- **No `session()->regenerate()` after `Auth::attempt()` / `Auth::login()`.** Laravel's `SessionGuard` regenerates the session ID itself during login (`updateSession()` → `$this->session->regenerate(true)`), so this alone is **not** session fixation. It is a finding only for custom auth that writes user identity into the session manually.
- **`DB::raw` / `whereRaw` with `?` placeholders or named bindings** and only constant SQL text.
- **`{!! !!}` on output from a trusted sanitizer** (HTMLPurifier, symfony/html-sanitizer) or framework helpers like `$errors`/`csrf_field()`. Confirm the sanitizer config before clearing it.
- **`FormRequest::authorize()` returning `true`** when authorization is enforced by a policy, `can` middleware or `Gate::authorize()` elsewhere on the same route.
- **`orderBy($column)` with an allow-listed column** (`in_array`, `Rule::in`, an enum, or spatie/laravel-query-builder `allowedSorts`).
- **Paths passed to Flysystem (`Storage::...`) containing user input.** Flysystem rejects `..` traversal outside the disk root, so treat it as a disk-scoped access-control question, not arbitrary file read. Native PHP paths (`response()->download(storage_path(...))`, `file_get_contents`) have no such protection.
- **`APP_DEBUG=true` in `.env.example` or a local-only `.env`** that is not deployed.
- **CSRF exclusions for webhook routes** that verify a provider signature.
- **`$fillable` containing `password`** when the value is hashed via the `hashed` cast or a mutator and only the user's own record is updated.
- **Sanctum `expiration => null`** is a hardening point, not a vulnerability, unless tokens are long-lived in a high-risk context or there is no revocation path.

## Severity calibration

Common under-ratings to avoid:

- **User-controlled `orderBy`/`where` column names** reaching a table with secret columns (`password`, `remember_token`, `two_factor_secret`, API tokens): the sort order is an oracle that leaks secret values character by character. Rate it **High** (Medium if no secret columns exist), not Low "input validation".
- **Livewire action IDOR** (unlocked ID property plus an action without authorization) has the same impact as a controller IDOR. Rate it by the data and action exposed (usually **High**).
- **Mass assignment of a privilege field + an admin area that trusts it** is a chain. Rate the chain (often **Critical**), and fix both parts.

## Build-mode guardrails

When writing Laravel code, default to:

1. **Validate with Form Requests and only use `$request->validated()` / `$request->safe()->only([...])`.** Never `$request->all()` into `create`, `update`, `fill` or a query.
2. **Authorize every action server-side.** Use policies plus `Gate::authorize()`, `can:` middleware or `->can()` on routes. Scope queries through the owner (`$request->user()->posts()->findOrFail($id)`). `@can` in Blade only hides UI.
3. **Models declare `$fillable`.** Never put `role`, `is_admin`, `team_id`, `user_id`, `email_verified_at`, balances or status fields in `$fillable` if they're set from user input. Set those explicitly.
4. **Use Eloquent and the query builder with bindings.** Never interpolate variables into raw SQL. Allow-list dynamic column names and sort directions.
5. **Escape output with `{{ }}`.** Use `@json`/`Js::from` for data in `<script>`. Validate URLs before putting them in `href`/`src` (`http`/`https` only). Sanitize any HTML you must render raw.
6. **Uploads:** validate with `File::types([...])->max(...)` or `mimes:`, store with `store()` (random name), keep private files off the `public` disk, and serve them through an authorized controller or `Storage::temporaryUrl()`.
7. **Secrets:** read through `config()`, never `env()` outside `config/*.php`. Never commit `.env` or keys, and never put real defaults in `env('KEY', 'real-secret')`.
8. **Sessions & auth:** use the starter kit / Fortify flows. On logout call `Auth::logout()`, `$request->session()->invalidate()` and `$request->session()->regenerateToken()`. Throttle login, OTP and reset endpoints with `RateLimiter`/`throttle:`.
9. **Outbound requests** to user-supplied URLs go through an allow-list. Redirects to user-supplied targets use `redirect()->intended()` or a relative-path check.
10. **Never** use `unserialize`, `decrypt()` (it unserializes by default; use `decryptString`), `eval` or `Blade::render` on user input. Never shell out with interpolated strings; pass `Process::run([...])` an argument array.
11. **APIs** return API Resources with explicit fields, not raw models. Clamp `per_page`. Enforce token abilities or scopes.
12. Add a **feature test for the security boundary** you just wrote (e.g. another user gets `403`, `is_admin` is ignored, a `.php` upload gets `422`).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the code/config path from attacker input to impact is fully traced, or it was safely demonstrated.
- **Likely**: strong evidence, but one runtime condition (deployment config, a middleware applied elsewhere, environment values) could not be verified. State which condition.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact × exploitability × required privileges × exposure. Do not raise severity because a scary keyword appears. Unauthenticated RCE, auth bypass and cross-tenant data access are Critical/High. Issues needing an admin account or an unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `path/to/File.php:42` (`Class::method`)
- **Evidence:** the exact code/config, and how attacker input reaches it
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, configuration, deployment assumptions
- **Fix:** smallest Laravel-native change (code snippet)
- **Verify:** test or request that proves the fix
- **Refs:** CWE / OWASP / Laravel docs link
```

**Rules:** never invent files, routes, packages or config values. Redact secrets (show `APP_KEY=base64:****`). Say explicitly when runtime verification was not performed. Only test applications the user is authorized to assess, and use non-destructive checks.

## References

- Laravel docs (match the project's version): https://laravel.com/docs
- Laravel security advisories: https://github.com/laravel/framework/security/advisories
- OWASP Cheat Sheet Series (Laravel cheat sheet): https://cheatsheetseries.owasp.org/cheatsheets/Laravel_Cheat_Sheet.html
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
