---
name: aspnet-core-security
description: Security review and secure-coding guidance for ASP.NET Core on .NET 8, 9 and 10 (MVC, Razor Pages, minimal APIs, Blazor, SignalR, gRPC) with Entity Framework Core. Use when auditing, reviewing, pentest-prepping or hardening a C#/.NET web codebase, or when writing or changing Program.cs, authentication (cookies, Identity, JWT bearer), [Authorize]/[AllowAnonymous] and policies, antiforgery, model binding, EF Core or Dapper queries, Razor views, Blazor components, uploads, appsettings.json, CORS or forwarded headers. Triggers on a .csproj using Sdk="Microsoft.NET.Sdk.Web" or Microsoft.AspNetCore.* packages, or Program.cs with WebApplication.CreateBuilder. Covers authentication and JWT validation, IDOR and function-level access control, CSRF, overposting, SQL/command/dynamic LINQ injection, deserialization and XXE, XSS, SSRF, open redirects, uploads and path traversal, secrets and environment config, CORS, proxies, rate limiting, NuGet and runtime advisories, and verification with WebApplicationFactory.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "ASP.NET Core 8.0 LTS and 9.0 STS (both end support 2026-11-10), 10.0 LTS; 11.0 release candidate noted; EF Core 8 to 10"
  last-verified: "2026-10-02"
---

# ASP.NET Core Security

Find, explain, fix and verify security issues in ASP.NET Core applications, and write new ASP.NET Core code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: the user asks for an audit, security review, pentest prep, or "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: you are writing or modifying ASP.NET Core code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change. Load only the reference for the area you are touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the ASP.NET Core knowledge. If it is not installed, use the [evidence and reporting rules](#evidence-and-reporting-rules) below.

## Review workflow

### 1. Confirm the stack and version

1. Confirm ASP.NET Core: a `.csproj` with `Sdk="Microsoft.NET.Sdk.Web"` (or a `Microsoft.AspNetCore.App` framework reference), and `Program.cs` calling `WebApplication.CreateBuilder` (6.0+ hosting) or a `Startup.cs` (older pattern, still common in upgraded apps).
2. Read `<TargetFramework>` (`net8.0`, `net9.0`, `net10.0`), `global.json`, and the **runtime** patch that actually runs: the Dockerfile base image tag (`mcr.microsoft.com/dotnet/aspnet:8.0.x`), CI images, or `dotnet --list-runtimes` on the host. The shared framework is serviced separately from NuGet packages, so a clean NuGet audit says nothing about the runtime.
3. Read package versions from `.csproj`, `Directory.Packages.props` and `packages.lock.json`: EF Core and providers, Dapper, `Microsoft.AspNetCore.Authentication.JwtBearer`, Identity UI, Duende/OpenIddict, `Newtonsoft.Json`, `System.Linq.Dynamic.Core`, Swashbuckle/NSwag/`Microsoft.AspNetCore.OpenApi`, SignalR/gRPC packages, `Microsoft.AspNetCore.DataProtection.*`.
4. Check support status: .NET 8 (LTS) and .NET 9 (STS, extended to 24 months) both end support on **2026-11-10**; .NET 10 (LTS) is supported to 2028-11-14; .NET 11 is at RC1 (GA expected November 2026). Only the latest patch gets fixes (2026-09: 8.0.31, 9.0.20, 10.0.12). See `references/dependencies.md`.
5. Note version-dependent behavior: minimal API form binding requires antiforgery (8.0+), `JsonWebTokenHandler` is the JwtBearer default (8.0+), `MapOpenApi`/`MapStaticAssets` (9.0+), `BinaryFormatter` always throws (9.0+), `KnownNetworks` obsolete in favor of `KnownIPNetworks` (10.0), automatic header-based CSRF middleware (11.0).

### 2. Map the attack surface

- `Program.cs` (or `Startup.Configure`/`ConfigureServices`): middleware order, authentication schemes, `AddAuthorization` fallback policy, CORS, forwarded headers, exception handling, `MapControllers`/`MapRazorPages`/`MapHub`/`MapGrpcService`/`MapRazorComponents`, every `Map{Get,Post,Put,Delete,Group}` and its `RequireAuthorization`/`AllowAnonymous`/`DisableAntiforgery`.
- Controllers (`[ApiController]` and MVC), Razor Pages (`Pages/**/*.cshtml.cs`), Blazor components with `@page`, SignalR hubs, gRPC services, endpoint filters, middleware classes, background services consuming queues, webhooks, health and OpenAPI endpoints.
- Configuration: `appsettings*.json`, `launchSettings.json` (local only), Dockerfiles and `ASPNETCORE_*` environment variables, Kubernetes manifests, Key Vault references.

### 3. Review each area

Load the reference for each area as you reach it. Do not load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| Authentication | `references/authentication.md` | Identity options, `lockoutOnFailure: false`, custom password checks, reset/2FA flows, cookie options, `RefreshSignInAsync` |
| JWT and tokens | `references/jwt-bearer.md` | `TokenValidationParameters` flags, symmetric keys from config, `SignatureValidator`, `MapInboundClaims`, token lifetime |
| Authorization / IDOR | `references/authorization.md` | Missing `[Authorize]`, `[AllowAnonymous]` precedence, no fallback policy, `FindAsync(id)` without owner, `IgnoreQueryFilters`, handler-level attributes in Razor Pages |
| Sessions and Data Protection | `references/sessions-data-protection.md` | Cookie `SecurePolicy`/`SameSite`/`HttpOnly`, session store, key ring persistence, `SetApplicationName`, logout |
| CSRF | `references/csrf.md` | MVC POST without `[ValidateAntiForgeryToken]`, `IgnoreAntiforgeryToken`, `DisableAntiforgery()`, `SameSite=None`, state-changing GET |
| Model binding and overposting | `references/model-binding.md` | Entities as action parameters, `TryUpdateModelAsync` without include list, `[BindProperty]` entities, JSON Patch, `SetValues(input)` |
| Injection and deserialization | `references/injection.md` | `FromSqlRaw`/`ExecuteSqlRaw` with `$"..."`, Dapper/`SqlCommand` concatenation, dynamic LINQ strings, `Process.Start`, LDAP filters, `TypeNameHandling`, `BinaryFormatter`, XML resolvers |
| XSS and output | `references/xss.md` | `@Html.Raw`, `new HtmlString($"...")`, `MarkupString`, `@` inside `<script>`, `UnsafeRelaxedJsonEscaping`, user URLs in `href` |
| SSRF and redirects | `references/ssrf-redirects.md` | `HttpClient.GetAsync(userUrl)`, `Redirect(returnUrl)`, `Url.IsLocalUrl` misuse |
| Files and static content | `references/file-uploads.md` | `IFormFile.FileName` in paths, `Path.Combine` with user input, `PhysicalFile`, uploads under `wwwroot`, `ServeUnknownFileTypes`, directory browsing |
| Secrets and configuration | `references/secrets-config.md` | Secrets in `appsettings.json`, `UseDeveloperExceptionPage`, environment, HSTS, forwarded headers, host filtering, CORS, headers, logging |
| API, real-time and Blazor | `references/api-security.md`, `references/blazor.md` | OpenAPI/Swagger exposure, rate limiting, request limits, SignalR hub/group authorization, gRPC, webhooks, Blazor render modes and WASM trust |
| Dependencies | `references/dependencies.md` | Runtime patch level, NuGetAudit, notable ASP.NET Core and package advisories |
| Verification | `references/verification.md` | `WebApplicationFactory` recipes, test auth handlers, commands, proof matrix |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation. Classify findings using the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses ASP.NET Core's own mechanism (a policy, a filter, a DTO, `LocalRedirect`, `FromSql`). Then verify using `references/verification.md`: the attack no longer works, legitimate use still works, and the same pattern isn't repeated elsewhere (other actions, HTTP verbs, minimal API twins, hub methods).

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# Authorization
[AllowAnonymous]  .AllowAnonymous()  FindAsync(id)  Find(id)  FirstOrDefaultAsync(x => x.Id == id)  IgnoreQueryFilters()
[Authorize] on OnGet/OnPost handlers   no FallbackPolicy   SuppressCheckForUnhandledSecurityMetadata   IsInRole only in views
# Authentication / tokens
lockoutOnFailure: false  ValidateLifetime = false  ValidateAudience = false  ValidateIssuer = false  RequireSignedTokens = false
SignatureValidator =  SymmetricSecurityKey(Encoding.UTF8.GetBytes(  RequireHttpsMetadata = false  RefreshSignInAsync(
# CSRF
[IgnoreAntiforgeryToken]  .DisableAntiforgery()  SameSiteMode.None  [HttpPost] without ValidateAntiForgeryToken in AddControllersWithViews apps
# Binding
TryUpdateModelAsync(entity)  [BindProperty] public <Entity>  ([FromBody] <Entity>  .CurrentValues.SetValues(  JsonPatchDocument<Entity>
# Injection / deserialization
FromSqlRaw($"  ExecuteSqlRaw($"  SqlQueryRaw<  new SqlCommand($"  .Query<(  "+ id +  System.Linq.Dynamic.Core  .Where(string)
Process.Start(  "/bin/sh"  "cmd.exe"  DirectorySearcher  Filter = $"(  TypeNameHandling.  BinaryFormatter  XmlUrlResolver  DtdProcessing.Parse
# XSS
@Html.Raw(  new HtmlString(  (MarkupString)  UnsafeRelaxedJsonEscaping  <script>...@Model  href="@  innerHTML  eval( via IJSRuntime
# Files / SSRF / redirects
IFormFile.FileName  Path.Combine(  PhysicalFile(  wwwroot/uploads  ServeUnknownFileTypes = true  UseDirectoryBrowser
GetAsync(url  GetStringAsync(  Redirect(returnUrl  Redirect(Request.Query
# Config
UseDeveloperExceptionPage()  ASPNETCORE_ENVIRONMENT=Development  "AllowedHosts": "*"  KnownNetworks.Clear()  KnownProxies.Clear()
SetIsOriginAllowed(_ => true)  EnableSensitiveDataLogging()  EnableDetailedErrors  UseSwagger()  MapOpenApi()  ConnectionStrings with Password=
```

## Common false positives

Do not report these without further evidence:

- **No `app.UseAuthentication()`/`UseAuthorization()` in a `WebApplication` app.** `WebApplication` adds both automatically when `AddAuthentication`/`AddAuthorization` services exist. If the authorization middleware is missing or runs before routing, endpoints carrying `[Authorize]` metadata throw at runtime (fail closed) unless `SuppressCheckForUnhandledSecurityMetadata` is set.
- **`FromSql($"...{id}")`, `FromSqlInterpolated`, `ExecuteSql($"...")`, `SqlQuery<T>($"...")`** and `FromSqlRaw("... {0}", value)`: values become `DbParameter`s. Only `*Raw` methods given an already-built string are injectable.
- **Razor `@Model.Value`, tag helpers, `asp-for`, `@Json.Serialize(...)`**: encoded by default (the default `JavaScriptEncoder` escapes `<`, `>`, `&`, `'`). Raw output needs `Html.Raw`, `HtmlString` or `MarkupString`.
- **Razor Pages POST handlers without `[ValidateAntiForgeryToken]`**: Razor Pages validate antiforgery tokens automatically. Minimal API endpoints that bind forms validate automatically in 8.0+.
- **No antiforgery on JSON APIs**: minimal API JSON body binding returns 415 for non-JSON content types, and `[ApiController]` with `[FromBody]` only accepts configured input formatters, so cross-site HTML forms cannot reach them. Bearer-token APIs need no CSRF token.
- **`AllowAnyOrigin()` with `AllowCredentials()`**: `CorsPolicyBuilder.Build()` throws, so this cannot run. The real issue is `SetIsOriginAllowed(_ => true)` or a reflected origin with credentials.
- **`ValidateIssuerSigningKey = false`** does not disable signature validation. It only skips validating the key itself. Signatures are still checked while `RequireSignedTokens` is `true` (default).
- **`LocalRedirect(url)`, `Results.LocalRedirect(url)`, `Redirect` after `Url.IsLocalUrl(url)`**: non-local targets throw or are rejected (`//` and `/\` are rejected).
- **XML parsing with default settings** (`XmlReader.Create`, `XDocument.Load`, `XmlDocument` without a resolver): modern .NET does not resolve external entities unless a resolver is set.
- **`BinaryFormatter` on .NET 9+** throws `PlatformNotSupportedException` unless the unsupported `System.Runtime.Serialization.Formatters` package is referenced; on .NET 8 it throws unless `EnableUnsafeBinaryFormatterSerialization` is set.
- **`File("~/path")` / `VirtualFileResult` and `PhysicalFileProvider`**: they reject rooted paths and `..` above the root. `PhysicalFile(fullPath)` and `System.IO` calls do not.
- **`ASPNETCORE_ENVIRONMENT=Development` in `launchSettings.json`**, user secrets and placeholder values in `appsettings.Development.json`: local only. The default environment is Production.
- **`[AllowAnonymous]` on genuinely public endpoints** (health, login, static assets) under a fallback policy.

## Severity calibration

Common under-ratings to avoid:

- **Committed JWT symmetric signing key** (`appsettings.json`, `Jwt:Key`): anyone with repository or image access can mint tokens with any `sub` and `role`. **Critical** when roles come from the token, not "secret in config".
- **`[AllowAnonymous]` on a controller or action inside an admin area**: it overrides every `[Authorize]` on the same controller or action. Rate by what becomes unauthenticated (often **High/Critical**).
- **`TryUpdateModelAsync(entity)` without an include list, or binding EF entities directly**, on entities with role, tenant, price or status fields: privilege or tenant escalation, **High/Critical**, not "input validation".
- **`System.Linq.Dynamic.Core` < 1.3.0 parsing user strings** (`OrderBy(sort)`, `Where(filter)`) is remote code execution (CVE-2023-32571), **Critical**. On patched versions it is still a data-exposure oracle if property names are not allow-listed.
- **`TypeNameHandling` other than `None` on request data** is code execution class (CWE-502). Do not downgrade because "a gadget is needed".
- **`SetIsOriginAllowed(_ => true)` + `AllowCredentials()` with cookie authentication**: any website reads authenticated responses. **High**. With bearer tokens only, **Low**.
- **Missing antiforgery on MVC POST**: **Medium** with default `SameSite=Lax` cookies; **High** when the auth cookie is `SameSite=None`, for email/password/payment actions, or when the action accepts GET.

## Build-mode guardrails

When writing ASP.NET Core code, default to:

1. **Deny by default.** Set `AuthorizationOptions.FallbackPolicy` to require an authenticated user; mark public endpoints with `[AllowAnonymous]`/`.AllowAnonymous()`. Use named policies for roles and `IAuthorizationService.AuthorizeAsync(User, resource, policy)` for object-level checks.
2. **Scope every query** by owner or tenant (`Where(x => x.Id == id && x.OwnerId == userId)`) or a global query filter; never `FindAsync(id)` on user-owned data from a route value alone.
3. **Bind DTOs, not entities.** Map allowed fields explicitly. If you must use `TryUpdateModelAsync`, pass the include expressions.
4. **Parameterize data access.** `FromSql`/`ExecuteSql`/`SqlQuery` with interpolated `FormattableString`, Dapper with anonymous parameter objects, `SqlParameter` for ADO.NET. Allow-list column and sort names.
5. **Never deserialize types chosen by the client.** System.Text.Json with declared polymorphism only; no `TypeNameHandling`, `BinaryFormatter`, `NetDataContractSerializer`-style formats.
6. **Let Razor encode.** No `Html.Raw`/`MarkupString` on user data without an allow-list sanitizer; put data for scripts in `data-` attributes or `Json.Serialize`; validate URL schemes.
7. **Antiforgery:** `AddControllersWithViews(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()))`, never `DisableAntiforgery()` on cookie-authenticated form endpoints, no state change on GET, keep auth cookies `SameSite=Lax` or `Strict` and `SecurePolicy = Always`.
8. **Authentication:** ASP.NET Core Identity with `lockoutOnFailure: true`, `RequireConfirmedAccount`, the default PBKDF2 hasher, rate-limited login/reset/2FA endpoints. JWT: keys from a secret store, `ValidIssuer`, `ValidAudience`, lifetime validation, `ValidAlgorithms`.
9. **Files:** server-generated names (`Path.GetRandomFileName()`), storage outside `wwwroot`, size and type checks, downloads through authorized actions with a containment check on `Path.GetFullPath`.
10. **Outbound calls and redirects:** allow-list hosts for user-influenced URLs and validate resolved IPs (`SocketsHttpHandler.ConnectCallback`); redirect with `LocalRedirect` or `Url.IsLocalUrl`.
11. **Configuration:** secrets from user secrets (dev) and Key Vault or environment (prod); `UseExceptionHandler` + `UseHsts` outside Development; explicit CORS origins; forwarded headers limited to known proxies; persist and protect Data Protection keys when running more than one instance.
12. Add a **`WebApplicationFactory` test for the boundary** you just wrote (other user gets 404/403, anonymous gets 401, extra field ignored, cross-origin POST rejected).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the code/config path from attacker input to impact is fully traced, or it was safely demonstrated.
- **Likely**: strong evidence, but one runtime condition (environment variables, proxy or gateway behavior, a policy registered elsewhere, the deployed runtime patch) could not be verified. State which condition.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact × exploitability × required privileges × exposure. Do not raise severity because a scary keyword appears. Unauthenticated RCE or SQL injection, auth bypass and cross-tenant data access are Critical/High. Issues needing an admin account or an unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `Controllers/InvoicesController.cs:42` (`InvoicesController.Details`)
- **Evidence:** the exact code/config, and how attacker input reaches it
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, environment, deployment assumptions
- **Fix:** smallest ASP.NET Core-native change (code snippet)
- **Verify:** WebApplicationFactory test or request that proves the fix
- **Refs:** CWE / OWASP / Microsoft Learn link
```

**Rules:** never invent files, routes, packages, options or CVEs. Redact secrets (`"SigningKey": "****"`). Say explicitly when runtime verification was not performed. Only test applications the user is authorized to assess, and use non-destructive checks.

## References

- ASP.NET Core security docs (match the project's version): https://learn.microsoft.com/aspnet/core/security/
- EF Core raw SQL: https://learn.microsoft.com/ef/core/querying/sql-queries
- .NET support policy: https://dotnet.microsoft.com/platform/support/policy/dotnet-core
- ASP.NET Core advisories: https://github.com/dotnet/aspnetcore/security/advisories and .NET runtime advisories: https://github.com/dotnet/runtime/security/advisories
- OWASP .NET Security cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/DotNet_Security_Cheat_Sheet.html
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
