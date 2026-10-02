---
name: django-security
description: Security review and secure-coding guidance for Django (4.2 to 6.1) and Django REST framework applications. Use when auditing, reviewing, pentest-prepping or hardening a Django/Python codebase, or when writing or changing Django settings, authentication, authorization (permissions, mixins, LoginRequiredMiddleware), sessions, CSRF, ORM queries and raw SQL, forms and DRF serializers and viewsets, templates, file uploads, admin, Celery tasks or deployment configuration. Triggers on projects containing manage.py and settings.py with django in requirements.txt, pyproject.toml or poetry.lock. Covers settings hardening and check --deploy, authentication and password hashing, IDOR/BOLA and function-level access, CSRF, mass assignment, SQL injection and ORM lookup abuse, XSS, SSRF, open redirects, uploads and downloads, pickle and other deserialization, DRF permissions and throttling, dependencies, and fix verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "Django 4.2 (end-of-life), 5.2 LTS, 6.0, 6.1; Django REST framework 3.15 to 3.18"
  last-verified: "2026-10-02"
---

# Django Security

Find, explain, fix and verify security issues in Django and Django REST framework applications, and write new Django code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: the user asks for an audit, security review, pentest prep, or "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: you are writing or modifying Django code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change. Load only the reference for the area you are touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the Django-specific knowledge. If it is not installed, use the [evidence and reporting rules](#evidence-and-reporting-rules) below.

## Review workflow

### 1. Confirm the stack and version

1. Confirm Django: `manage.py` at the project root, and `django` in `requirements*.txt`, `pyproject.toml`, `Pipfile` or a lock file.
2. Read the **installed** version from the lock file (`poetry.lock`, `uv.lock`, `Pipfile.lock`, pinned `requirements.txt`), not the constraint. If only ranges exist, say the installed version is unknown.
3. Find the settings module(s). `DJANGO_SETTINGS_MODULE` in `manage.py`, `wsgi.py`, `asgi.py`, `pytest.ini`, Dockerfiles and CI shows which one runs in production. Projects often have `settings/base.py`, `production.py`, `local.py`, `test.py`. Findings in a settings file production never imports are not findings.
4. Record security-relevant packages: `djangorestframework`, `django-filter`, `simplejwt`, `django-allauth`, `django-cors-headers`, `django-axes`/`django-ratelimit`, `django-storages`, `channels`, `celery`, `Pillow`, `whitenoise`, `django-debug-toolbar`, `drf-spectacular`, GraphQL libraries.
5. Check support status. Django 4.2 security support ended April 2026; 5.2 LTS is supported until April 2028, 6.0 until April 2027, 6.1 until December 2027. Only the latest patch of a supported series gets fixes. DRF: 3.17.2 or later fixes two 2026 advisories. An unsupported framework or a patch with a reachable advisory is a finding; see `references/dependencies.md`.
6. Note version-dependent behavior: `LoginRequiredMiddleware` (5.1+), built-in CSP (6.0+), `PickleSerializer` removed (5.0), `MAILERS` (6.1), signed-cookie salt change (5.2.15/6.0.6, legacy fallback off by default in 6.1), `TASKS` framework (6.0+).

### 2. Map the attack surface

- URLs: root `urls.py` plus every `include()`; `admin.site.urls`; DRF routers (`DefaultRouter`/`SimpleRouter`); `re_path(..., serve, ...)` for media; schema and docs routes.
- Views: function views, class-based views, viewsets and `@action`s, `csrf_exempt` views (webhooks), `login_not_required` views, anything taking an ID, URL, path, filename, sort field, filter dict, template name or HTML.
- Other entry points: Channels consumers, Celery tasks and beat schedules, management commands called from code, signal handlers, GraphQL schema, admin custom views (`get_urls`), template tags and filters, middleware order.

### 3. Review each area

Load the reference for each area as you reach it. Do not load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| Settings & deployment | `references/secrets-config.md` | `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`, `SECURE_*`, cookie flags, proxy header trust, CORS, logging, `check --deploy` |
| Authentication | `references/authentication.md` | `PASSWORD_HASHERS`, validators, login throttling (none built in), reset flow, remote-user auth, MFA |
| Authorization / IDOR / admin | `references/authorization.md` | `get_object_or_404(Model, pk=pk)`, generic views without `get_queryset`, `@login_required` only, `get_urls` without `admin_view`, unscoped `ModelChoiceField` |
| Sessions | `references/sessions.md` | `SESSION_ENGINE`, `signed_cookies`, custom serializers, cookie flags, logout, `SESSION_COOKIE_DOMAIN` |
| CSRF | `references/csrf.md` | `csrf_exempt`, state-changing `GET`, `CSRF_TRUSTED_ORIGINS`, DRF `SessionAuthentication` |
| Validation & mass assignment | `references/validation-mass-assignment.md` | `fields = "__all__"`, `exclude`, `**request.POST.dict()`, `read_only_fields`, nested writes |
| Injection & deserialization | `references/injection.md` | `.raw(`/`.extra(`/`RawSQL`/`cursor.execute` with f-strings, `order_by(user)`, `filter(**user)`, `shell=True`, `pickle`, `yaml.load` |
| XSS & output | `references/xss.md` | `\|safe`, `mark_safe(f"...")`, `autoescape off`, `href="{{ user_url }}"`, `json.dumps` in `<script>`, `HttpResponse(f"<...")` |
| SSRF & redirects | `references/ssrf-redirects.md` | `requests.get(user_url)`, `redirect(request.GET["next"])`, missing `url_has_allowed_host_and_scheme` |
| Uploads & downloads | `references/file-uploads.md` | `FileField` without validation, `serve` view in `urls.py`, `FileResponse(open(os.path.join(base, user)))`, `extractall` |
| DRF permissions & auth | `references/drf-permissions.md` | No `DEFAULT_PERMISSION_CLASSES` (default is `AllowAny`), `queryset = X.objects.all()`, `has_object_permission` reliance, token/JWT settings |
| API security | `references/api-security.md` | Throttling, pagination caps, `ordering_fields = "__all__"`, `search_fields`, browsable API, schema routes, unsigned webhooks |
| Background tasks | `references/background-tasks.md` | Celery serializers and broker exposure, task IDOR, shell in tasks, Flower, secrets in task args |
| Dependencies | `references/dependencies.md` | Support status, `pip-audit`, notable Django and DRF advisories, supply-chain hygiene |
| Verification | `references/verification.md` | Test-client and `APIClient` recipes, commands, matrix of proofs per finding class |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation. Classify findings using the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses Django's own mechanism. Then verify using `references/verification.md`: the attack no longer works, legitimate use still works, and the same pattern is not repeated elsewhere (search for siblings, other HTTP methods and DRF equivalents of the same view).

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# Injection / RCE
.raw(  .extra(  RawSQL(  cursor.execute(f"  cursor.execute("..." %   .format(   in SQL strings
order_by(request  .values(request  filter(**request  exclude(**  Q(**  annotate(**  .alias(**
subprocess shell=True  os.system(  pickle.loads  yaml.load(  marshal.loads  Template(request  jinja2.Template(

# Authorization
get_object_or_404(Model, pk=  Model.objects.get(pk=request  queryset = Model.objects.all()  @login_required (only)
permission_classes = [] / [AllowAny]   authentication_classes = []   admin_view missing in get_urls   @login_not_required

# Mass assignment / exposure
fields = "__all__"  exclude = [  create(**request  update(**request.data  ordering_fields = "__all__"  depth =

# XSS / output
|safe  mark_safe(  autoescape off  SafeString(  HttpResponse(f"  href="{{  <script>... {{ ...|safe

# Files / SSRF / redirects
FileResponse(open(  os.path.join(BASE_DIR, request  serve  extractall  upload_to  requests.get(  urlopen(  redirect(request

# Config / secrets
DEBUG = True  SECRET_KEY = "  ALLOWED_HOSTS = ["*"]  SESSION_ENGINE ...signed_cookies  MD5PasswordHasher  csrf_exempt  CORS_ALLOW_ALL_ORIGINS
SECURE_PROXY_SSL_HEADER  USE_X_FORWARDED_HOST  CSRF_TRUSTED_ORIGINS  PickleSerializer  CELERY_ACCEPT_CONTENT pickle
```

## Common false positives

Do not report these without further evidence:

- **No explicit `cycle_key()` after `authenticate()`/`login()`.** `django.contrib.auth.login()` rotates the session key itself. A finding only for custom auth that writes identity into the session manually.
- **ORM calls with user values** (`filter(title__icontains=q)`, `get(pk=pk)`), and **`raw()`, `extra()`, `RawSQL`, `cursor.execute()` that pass user data through `params`** with constant SQL text.
- **`format_html()` with user data as arguments**: it escapes every argument. It becomes unsafe only if an argument is wrapped in `mark_safe`. `json_script`, `linebreaksbr`, `urlize` and ordinary `{{ var }}` are escaped.
- **`@csrf_exempt` on webhooks that verify a provider signature** (HMAC over `request.body` with `compare_digest`), and **no CSRF on DRF token/JWT APIs**: `SessionAuthentication` is the only DRF class that enforces CSRF.
- **Fast password hashers (`MD5PasswordHasher`) or `DEBUG = True` in test-only settings** that production does not import.
- **`CSRF_COOKIE_HTTPONLY` unset, `/admin/` at the default path, `SECRET_KEY` placeholders in `.env.example`.**
- **`ALLOWED_HOSTS = ["*"]` or missing HSTS** are conditional: report with the exploitation condition (reset-link host poisoning, proxy that does not validate hosts) or as Hardening.
- **`DEFAULT_PERMISSION_CLASSES` unset** when every view sets `permission_classes` explicitly, or when a project base class does. Check before reporting.
- **`has_object_permission` not called on list views** when `get_queryset` already scopes by owner.
- **Throttling absent in the app** when a documented gateway enforces it. DRF's own docs say its throttles are not brute-force protection.
- **Paths via `default_storage` / `FileField`**: Django sanitizes names and rejects `..` for standard storage. Raw `open(os.path.join(...))` and `FileResponse(open(...))` have no such protection.
- **Unsalted/legacy hashers listed after a strong first hasher** only verify and upgrade old hashes.

## Severity calibration

Common under-ratings to avoid:

- **User-controlled `order_by`/`filter(**dict)` field names** on models with secret columns (`password`, tokens, reset codes, MFA secrets): ordering and lookups are oracles that leak values character by character, including across relations (`owner__password`). Rate **High** when plaintext tokens, API keys or reset codes are reachable (`filter` lookups like `__startswith` extract them outright), **Medium** for salted password hashes only or no secret columns, never Low "input validation".
- **DRF `AllowAny` default + `ModelSerializer` with `fields = "__all__"`** on a user/account model is a chain: unauthenticated read/write of privilege fields and password hashes. Rate the chain (often **Critical**).
- **Hard-coded `SECRET_KEY` + `signed_cookies` sessions (or pickle anywhere)** is session forgery or code execution. Rate the chain **High/Critical**, not the key alone.
- **`@login_required` on an admin-like action** (promote user, export all) is function-level access control failure, **High/Critical**, not "missing role check".
- **Stored XSS rendered to staff in the admin** outranks the same bug for ordinary users.
- **`@csrf_exempt` on a session-authenticated email or password change** is account takeover (change the email, then use password reset). Rate **High**, not Low because "only profile fields" are exposed.

## Build-mode guardrails

When writing Django code, default to:

1. **Settings from the environment, secure by default:** `DEBUG` parsed explicitly and `False` by default, `SECRET_KEY` from the environment, explicit `ALLOWED_HOSTS`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, HSTS and `SECURE_PROXY_SSL_HEADER` only when the proxy guarantees it. Run `check --deploy` in CI.
2. **Authorize every action server-side.** Scope querysets through the owner/tenant (`get_object_or_404(Invoice, pk=pk, owner=request.user)`, `get_queryset()`), add `PermissionRequiredMixin`/`permission_required` for privileged actions. On 5.1+ consider `LoginRequiredMiddleware` with explicit `login_not_required`.
3. **Forms and serializers declare `fields` explicitly.** Never `"__all__"` or `exclude` on models with privilege, ownership or secret fields; set owner/role in the view. Never `Model.objects.create(**request.POST.dict())`.
4. **Use the ORM with values only.** Raw SQL always with `params`; allow-list sort fields and filter keys; never splat request dicts into `filter()`, `annotate()`, `values()` or `extra()`.
5. **Let templates escape.** Use `format_html` instead of `mark_safe(f"...")`, `json_script` for data in scripts, scheme-check user URLs before `href`, sanitize rich text with an allow-list library, `JsonResponse` for JSON.
6. **Uploads:** server-generated names, content validation and size limits, store private files outside `MEDIA_ROOT` and serve through an authorized view, never route `serve` in production, serve user content from a separate domain.
7. **Passwords and sessions:** keep the default or Argon2 hasher first, enable `AUTH_PASSWORD_VALIDATORS`, throttle login/reset/OTP (`django-axes`, rate limiter or proxy), use `login()`/`logout()`, keep JSON session serialization.
8. **Redirects and outbound requests:** `url_has_allowed_host_and_scheme(next, allowed_hosts={request.get_host()}, require_https=request.is_secure())`; allow-list hosts for fetches, validate resolved IPs, disable or re-check redirects.
9. **Never** `pickle`/`yaml.load` untrusted data, `shell=True` with interpolation, or `Template(user_input)`. Keep Celery on JSON with an authenticated private broker.
10. **DRF:** set `DEFAULT_PERMISSION_CLASSES` to `IsAuthenticated`, scope `get_queryset`, use separate output serializers, set `ordering_fields`/`filterset_fields` lists, cap pagination (`max_limit`), enable throttles, JSON renderer only in production, verify webhook signatures.
11. Keep Django and DRF on the latest patch of a supported series and run `pip-audit` in CI.
12. Add a **test for the security boundary** you just wrote (other user gets 404/403, `is_staff` ignored, `.html` upload rejected, anonymous API call gets 401/403).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the code/config path from attacker input to impact is fully traced, or it was safely demonstrated.
- **Likely**: strong evidence, but one runtime condition (production settings, proxy behavior, a gateway, environment values) could not be verified. State which condition.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact x exploitability x required privileges x exposure. Do not raise severity because a scary keyword appears. Unauthenticated RCE or SQL injection, auth bypass and cross-tenant data access are Critical/High. Issues needing an admin account or an unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `app/views.py:42` (`invoice_detail`)
- **Evidence:** the exact code/config, and how attacker input reaches it
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, settings module, deployment assumptions
- **Fix:** smallest Django-native change (code snippet)
- **Verify:** test or request that proves the fix
- **Refs:** CWE / OWASP / Django docs link
```

**Rules:** never invent files, URLs, packages, settings or CVEs. Redact secrets (`SECRET_KEY = "****"`). Say explicitly when runtime verification was not performed. Only test applications the user is authorized to assess, and use non-destructive checks.

## References

- Django docs (match the project's version): https://docs.djangoproject.com/ — security overview https://docs.djangoproject.com/en/stable/topics/security/, deployment checklist https://docs.djangoproject.com/en/stable/howto/deployment/checklist/
- Django security releases: https://docs.djangoproject.com/en/stable/releases/security/
- Django REST framework: https://www.django-rest-framework.org/ and advisories https://github.com/encode/django-rest-framework/security/advisories
- OWASP Django Security cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Django_Security_Cheat_Sheet.html
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
