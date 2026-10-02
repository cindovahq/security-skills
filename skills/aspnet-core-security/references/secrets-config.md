# ASP.NET Core — Secrets, Environment and Deployment Configuration

## Contents
- Configuration sources and environments
- Secrets
- Error handling and diagnostics
- HTTPS, HSTS and forwarded headers
- Host filtering
- CORS
- Security headers
- Logging
- Severity, false positives, verification

## Configuration sources and environments

`WebApplication.CreateBuilder` loads, in increasing precedence: `appsettings.json`, `appsettings.{Environment}.json`, user secrets (**only when the environment is Development**), environment variables, command-line arguments. The environment comes from `ASPNETCORE_ENVIRONMENT` or `DOTNET_ENVIRONMENT` and defaults to **Production** when neither is set. `Properties/launchSettings.json` is used only by local tooling (`dotnet run`, Visual Studio) and is not deployed.

Determine the production environment from Dockerfiles (`ENV ASPNETCORE_ENVIRONMENT=...`), Kubernetes/Helm values, App Service settings, CI deployment steps, `web.config` `<environmentVariable>` entries. A `Development` value there turns on the developer exception page (automatically added by `WebApplication` in Development), user secrets and any `if (app.Environment.IsDevelopment())` branches (Swagger UI, detailed errors, seeding).

## Secrets

**Investigate:** `appsettings.json` and `appsettings.{Production,Staging}.json` committed with `ConnectionStrings` containing `Password=`/`Pwd=`, JWT signing keys, API keys, SMTP passwords, storage account keys, client secrets; secrets in `docker-compose.yml`, Helm values, `web.config`, `Directory.Build.props`; `?? "fallback-secret"` defaults in code; secrets logged at startup; `git log -p -- appsettings.json` for removed values (history still leaks them).

**Fix:** user secrets for development (`dotnet user-secrets set`), environment variables or a secret store in production (Azure Key Vault via `builder.Configuration.AddAzureKeyVault(...)`, AWS Secrets Manager, Kubernetes secrets), managed identity instead of connection-string passwords where possible. Rotate anything that was committed. Never print values in reports (`"SigningKey": "****"`).

## Error handling and diagnostics

- `app.UseDeveloperExceptionPage()` called unconditionally, or Development environment in production: stack traces, source snippets, headers, cookies and route data are shown to anyone. Templates call `UseExceptionHandler("/Error")` and `UseHsts()` only outside Development.
- `AddProblemDetails()` + `UseExceptionHandler()` return RFC 7807 responses without exception details by default; leaks come from custom code (`CustomizeProblemDetails = ctx => ctx.ProblemDetails.Detail = ctx.Exception?.ToString()`, exception filters returning `ex.Message`/`ex.StackTrace`, `catch (Exception ex) { return BadRequest(ex.ToString()); }`).
- `CircuitOptions.DetailedErrors` (Blazor Server), `HubOptions.EnableDetailedErrors` (SignalR), gRPC `EnableDetailedErrors`, EF Core `EnableDetailedErrors()`/`EnableSensitiveDataLogging()`: development-only switches. `EnableSensitiveDataLogging` puts parameter values (passwords, tokens, PII) into logs and exception messages.
- Diagnostic endpoints: `MapHealthChecks` with a detailed response writer exposing dependency names and connection info; `/swagger`, `/openapi/v1.json`, Scalar or NSwag UI in production (`api-security.md`); Elmah, MiniProfiler, Hangfire dashboard without authorization (Hangfire's dashboard allows only local requests by default; a custom `IDashboardAuthorizationFilter` returning `true` exposes it).

## HTTPS, HSTS and forwarded headers

- `UseHttpsRedirection()` + `UseHsts()` (HSTS defaults: `MaxAge` 30 days, excludes `localhost`, `127.0.0.1`, `[::1]`). Missing HSTS is Hardening; can also be set at the proxy.
- Behind a reverse proxy or load balancer, the app sees the proxy's IP and scheme unless `UseForwardedHeaders` processes `X-Forwarded-For`/`-Proto`/`-Host`. Defaults: only `KnownProxies = [::1]` and `KnownNetworks`/`KnownIPNetworks` = `127.0.0.0/8` are trusted, `ForwardLimit = 1`, `ForwardedHeaders = None` until configured.
- **Trusting everyone:** `options.KnownNetworks.Clear(); options.KnownProxies.Clear();` (or `KnownIPNetworks.Clear()` on 10.0, where `KnownNetworks` is obsolete as `ASPDEPR005`) accepts forwarded headers from any client that can reach the app directly. The `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` switch does the same: it sets `XForwardedFor | XForwardedProto` and clears both lists (by design, for cloud proxies). Impact: spoofed client IPs (rate limiter partitions, IP allow-lists, audit logs) and spoofed scheme. Report as **Likely**, naming the condition "the app is reachable without passing through the proxy" or "the proxy appends rather than overwrites".
- `ForwardedHeaders.XForwardedHost` without `ForwardedHeadersOptions.AllowedHosts` lets clients choose the host used in generated links (password reset emails).

## Host filtering

`AllowedHosts` in `appsettings.json` drives host filtering middleware (added by the default host). Templates ship `"AllowedHosts": "*"`, which disables filtering. Where emails or redirects use `Request.Host` or `Url.Action(..., protocol: Request.Scheme)` absolute URLs (Identity confirmation and reset links), a spoofed `Host` header produces poisoned links: **Medium** when an ingress does not validate hosts, Hardening otherwise. Set explicit hosts (`"AllowedHosts": "portal.example.com"`).

## CORS

Middleware order: `UseCors()` after `UseRouting()` and before `UseAuthorization()` (and before `UseResponseCaching`). Investigate:
- `SetIsOriginAllowed(_ => true)` or `SetIsOriginAllowed(o => o.Contains("example.com"))` with `AllowCredentials()`: any (or a look-alike) origin can make credentialed reads. With cookie auth **High**.
- `AllowAnyOrigin().AllowCredentials()`: rejected at runtime (`CorsPolicyBuilder.Build()` throws `InvalidOperationException`), so it can't be the deployed config. Not a finding unless the policy is built differently.
- `WithOrigins("https://*.example.com").SetIsOriginAllowedToAllowWildcardSubdomains()` trusts every subdomain, including user-content or takeover-prone ones.
- `AllowAnyOrigin()` without credentials on endpoints that return per-user data authorized by something browsers send automatically (Windows auth, client certs, IP allow-lists).
- CORS is not CSRF protection and not authorization; see `csrf.md`.

## Security headers

No built-in middleware sets CSP, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`; antiforgery adds `X-Frame-Options: SAMEORIGIN` to responses that generate tokens unless `SuppressXFrameOptionsHeader` is set. Missing headers are Hardening; check the proxy before reporting.

## Logging

Findings: request/response body logging middleware or `AddHttpLogging` with `HttpLoggingFields.RequestBody`/`All` on auth endpoints; `UseW3CLogging` or request logging capturing `Authorization`/`Cookie` headers; logging DTOs that contain passwords or tokens; SignalR/WebSocket query-string tokens in request logs (`Microsoft.AspNetCore.Hosting` logs the URL at Information level).

## Severity, false positives, verification

Severity: committed production secrets that grant access (DB password reachable from the internet, signing keys) **High/Critical**; developer exception page in production **Medium** (High if it exposes connection strings or secrets in variables); `EnableSensitiveDataLogging` in production **Medium**; trust-all forwarded headers **Medium/Low** (Likely); permissive CORS with credentials and cookie auth **High**; `AllowedHosts: *` with host-derived reset links **Medium**.

False positives: secrets or `Development` settings in `appsettings.Development.json`, `launchSettings.json` or user secrets; placeholders (`"<set in Key Vault>"`); `UseDeveloperExceptionPage` inside `if (app.Environment.IsDevelopment())`; forwarded-header clearing in a container that only the proxy can reach (state it as the condition).

Verify:
```bash
dotnet user-secrets list --project src/Portal       # dev only; confirms which keys are expected
grep -rnE '"(Password|Pwd|SigningKey|Secret|ApiKey|ClientSecret)"' --include='appsettings*.json' .
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: attacker.invalid' https://staging.example.com/    # expect 400 with host filtering
curl -sI https://staging.example.com/ | grep -iE 'strict-transport|x-content-type|content-security|set-cookie'
```
In tests: `factory.WithWebHostBuilder(b => b.UseEnvironment("Production"))` and assert an exception returns a ProblemDetails body without a stack trace.

References: https://learn.microsoft.com/aspnet/core/fundamentals/configuration/, https://learn.microsoft.com/aspnet/core/security/app-secrets, https://learn.microsoft.com/aspnet/core/fundamentals/environments, https://learn.microsoft.com/aspnet/core/fundamentals/error-handling, https://learn.microsoft.com/aspnet/core/host-and-deploy/proxy-load-balancer, https://learn.microsoft.com/aspnet/core/security/enforcing-ssl, https://learn.microsoft.com/aspnet/core/security/cors; OWASP Top 10:2025 A02; CWE-798, CWE-209, CWE-942, CWE-348.
