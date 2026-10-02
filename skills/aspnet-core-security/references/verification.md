# ASP.NET Core — Verifying Findings and Fixes

## Contents
- Ground rules
- Static commands and analyzers
- WebApplicationFactory setup
- Recipes
- Running-environment checks
- Verification matrix

## Ground rules

- Read-only analysis first: `dotnet list package`, `dotnet --list-runtimes`, reading configuration. Don't run migrations, seeders or `dotnet ef database update` against shared databases; integration tests use a throwaway database (SQLite in-memory, Testcontainers) via `ConfigureTestServices`.
- Dynamic requests only against environments the user owns or is authorized to test, with test accounts and benign probes. No brute force, no load, no real user data.
- State what was not run. A fully traced code path is **Confirmed** (code), not "exploited".

## Static commands and analyzers

```bash
dotnet build -p:AnalysisMode=All                                 # surfaces CA2100, CA2326/CA2327, CA3075, CA5391 and other security rules
dotnet list package --vulnerable --include-transitive
dotnet --list-runtimes
semgrep --config p/csharp .                                      # optional
grep -rnE 'FromSqlRaw\(\$|ExecuteSqlRaw\(\$|SqlQueryRaw<|AllowAnonymous|IgnoreAntiforgeryToken|DisableAntiforgery|Html\.Raw|MarkupString|TypeNameHandling|BinaryFormatter|SetIsOriginAllowed|KnownNetworks\.Clear|KnownIPNetworks\.Clear|UseDeveloperExceptionPage|EnableSensitiveDataLogging|lockoutOnFailure: false|ValidateLifetime = false|Process\.Start|PhysicalFile\(|\.FileName' --include=*.cs --include=*.cshtml --include=*.razor .
```
Relevant .NET analyzer rules: `CA2100` (SQL built from strings), `CA2326`/`CA2327` (Newtonsoft `TypeNameHandling`), `CA3075` (insecure DTD processing), `CA5391` (MVC actions without antiforgery), and the taint rules `CA3001` (SQL injection), `CA3003` (file path injection), `CA3006` (process command injection), `CA3007` (open redirect). Many are off by default; enable them with `AnalysisMode` or `.editorconfig` (`dotnet_diagnostic.CA3001.severity = warning`). They find candidates, not findings.

Route inventory without running the app: search `Map(Get|Post|Put|Patch|Delete|Methods|Group|Hub|GrpcService|Controllers|RazorPages|RazorComponents)` in `Program.cs`, controller `[Route]`/`[Http*]` attributes, and `Pages/**/*.cshtml` `@page` directives. In a test, enumerate `factory.Services.GetRequiredService<EndpointDataSource>().Endpoints` and print each route with its `IAuthorizeData`/`IAllowAnonymous` metadata.

## WebApplicationFactory setup

Package `Microsoft.AspNetCore.Mvc.Testing`; the test project must be able to reference the app's `Program` (expose it with `public partial class Program { }` if needed).

```csharp
public sealed class PortalFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            services.PostConfigure<AuthenticationOptions>(o => { o.DefaultAuthenticateScheme = "Test"; o.DefaultChallengeScheme = "Test"; });
            // replace the DbContext with a per-test database here
        });
    }

    public HttpClient CreateClientAs(string user, params string[] roles)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("X-Test-User", user);
        if (roles.Length > 0) client.DefaultRequestHeaders.Add("X-Test-Roles", string.Join(',', roles));
        return client;
    }
}

public sealed class TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e)
    : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-User", out var user)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user!), new(ClaimTypes.Name, user!) };
        claims.AddRange(Request.Headers["X-Test-Roles"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(r => new Claim(ClaimTypes.Role, r)));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")), "Test")));
    }
}
```
The header-driven handler exists only in the test project. Policies that name a specific scheme (`AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme`) need the test scheme registered under that name, or real tokens.

## Recipes

```csharp
public class SecurityTests(PortalFactory f) : IClassFixture<PortalFactory>
{
    [Fact] public async Task Anonymous_gets_401_or_login_redirect()                       // authorization.md
        => Assert.Contains((await f.CreateClient(new() { AllowAutoRedirect = false }).GetAsync("/Invoices/Details/1")).StatusCode,
                           new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Redirect, HttpStatusCode.Found });

    [Fact] public async Task Other_users_invoice_is_not_found()                           // IDOR
        => Assert.Equal(HttpStatusCode.NotFound, (await f.CreateClientAs("bob").GetAsync($"/Invoices/Details/{Seed.AliceInvoiceId}")).StatusCode);

    [Fact] public async Task Non_admin_cannot_export_users()                              // function-level
        => Assert.Equal(HttpStatusCode.Forbidden, (await f.CreateClientAs("bob").GetAsync("/admin/users/export")).StatusCode);

    [Fact] public async Task Download_rejects_traversal()                                 // file-uploads.md
        => Assert.Equal(HttpStatusCode.NotFound, (await f.CreateClientAs("alice").GetAsync("/files/download?name=..%2F..%2Fappsettings.json")).StatusCode);

    [Fact] public async Task Login_redirect_stays_local()                                  // ssrf-redirects.md
    {
        var res = await LoginAsync(f.CreateClient(new() { AllowAutoRedirect = false }), returnUrl: "https://other.example.net/");
        Assert.False(res.Headers.Location?.IsAbsoluteUri ?? false);
    }

    [Fact] public async Task Production_errors_have_no_stack_trace()                       // secrets-config.md
    {
        var client = f.WithWebHostBuilder(b => b.UseEnvironment("Production")).CreateClient();
        var body = await (await client.GetAsync("/diagnostics/throw-test")).Content.ReadAsStringAsync();
        Assert.DoesNotContain(" at ", body);
    }
}
```
CSRF: post a form without the token using an authenticated client and expect 400 (`csrf.md`). Overposting: send extra JSON or form fields and reload the entity from the test database (`model-binding.md`). JWT: build tokens with a wrong key, audience or past expiry and expect 401 (`jwt-bearer.md`). CORS: send `Origin: https://other.example.net` and assert no `Access-Control-Allow-Origin` echo (`secrets-config.md`). SignalR: `HubConnectionBuilder` with `HttpMessageHandlerFactory = _ => f.Server.CreateHandler()` (`api-security.md`).

## Running-environment checks

Only against an authorized staging environment:
```bash
curl -sI https://staging.example.com/ | grep -iE 'strict-transport|x-content-type|content-security|set-cookie|server'
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: attacker.invalid' https://staging.example.com/
curl -s -H 'Origin: https://other.example.net' -I https://staging.example.com/api/me | grep -i 'access-control'
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/openapi/v1.json
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/swagger/index.html
```
A developer exception page is recognizable by its "An unhandled exception occurred while processing the request" heading and stack/query/cookies/headers tabs; do not trigger errors with destructive inputs to see it.

## Verification matrix

| Finding class | Prove the issue | Prove the fix |
|---|---|---|
| Missing authorization / AllowAnonymous | Anonymous or low-role client gets 200 | 401/403; endpoint inventory shows metadata |
| IDOR / tenant | User B reads/edits user A's object | 404/403 on every verb |
| Overposting | Extra field changes the stored entity | Field ignored after reload |
| CSRF | Authenticated POST without token succeeds | 400 |
| SQL / dynamic LINQ injection | Code trace to raw string; quote-containing benign value breaks the query | Parameterized query; allow-list rejects unknown sort fields |
| Deserialization | Code trace to `TypeNameHandling`/`BinaryFormatter` on request data | Settings use `TypeNameHandling.None`; DTO-only binding |
| XSS | Stored marker rendered unencoded | Response contains `&lt;` |
| Open redirect | Absolute `Location` to another host | Local path only |
| SSRF | Request to a local test listener or blocked range attempted | Rejected by allow-list/IP policy |
| Path traversal / upload | `..` name reads or writes outside root | 404/400; generated names |
| JWT validation | Expired/wrong-audience/wrong-key token accepted | 401 |
| Config | `UseDeveloperExceptionPage` reachable, secrets in repo | Production environment returns ProblemDetails; secret moved and rotated |
| Dependencies | `dotnet list package --vulnerable` / runtime version below fix | Clean audit; image rebuilt on fixed patch |

References: https://learn.microsoft.com/aspnet/core/test/integration-tests, https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/security-warnings, https://learn.microsoft.com/nuget/concepts/auditing-packages; OWASP Web Security Testing Guide.
