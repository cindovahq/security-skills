# ASP.NET Core — CSRF and Antiforgery

## Contents
- How protection works per app model
- Version differences
- What to investigate
- Fix patterns
- Severity, false positives, verification

## How protection works per app model

| App model | Token generation | Validation |
|---|---|---|
| MVC views (`AddControllersWithViews`) | Form tag helper / `Html.BeginForm` add a hidden token to `method="post"` forms | **Only where a filter applies:** `[ValidateAntiForgeryToken]` (all methods), `[AutoValidateAntiforgeryToken]` (skips GET, HEAD, OPTIONS, TRACE), or a global filter. `[IgnoreAntiforgeryToken]` overrides both |
| `AddControllers` only (APIs) | None | `AddControllers` does not enable antiforgery; protection must come from non-cookie auth |
| Razor Pages | Form tag helper | **Automatic** for unsafe methods; opt out with `[IgnoreAntiforgeryToken]` on the `PageModel` |
| Minimal APIs (8.0+) | `IAntiforgery.GetAndStoreTokens` | Endpoints binding forms (`[FromForm]`, `IFormFile`, `IFormCollection`) require validation automatically; `UseAntiforgery()` middleware validates POST/PUT/PATCH; `.DisableAntiforgery()` opts out |
| Blazor Web App (8.0+) | `AntiforgeryToken` component inside `EditForm` | `UseAntiforgery()` (in the template, after `UseAuthentication`/`UseAuthorization`) |

Details from the docs:
- The antiforgery middleware does not short-circuit; the form-binding code rejects the request. If an endpoint requires antiforgery and no antiforgery middleware ran, `EndpointMiddleware` throws, so a missing `UseAntiforgery()` fails closed for minimal API form endpoints.
- `UseAntiforgery()` validates only POST, PUT and PATCH. `HttpMethodOverrideMiddleware` in form-field mode placed before it lets a POST become DELETE and skip validation.
- Tokens are protected with Data Protection; key ring problems make validation fail across instances (see `sessions-data-protection.md`).

## Version differences

- **8.0+:** minimal API form binding and Blazor SSR forms require antiforgery; `DisableAntiforgery()` added.
- **ASP.NET Core 11 (release candidate as of 2026-10):** a header-based CSRF middleware (`Sec-Fetch-Site`, falling back to `Origin`) is registered automatically by `WebApplication.CreateBuilder`. It records a verdict that is enforced (400) only where the endpoint already requires antiforgery validation: Blazor SSR, minimal API form binding, Razor Pages, and MVC actions with `[ValidateAntiForgeryToken]`/`[AutoValidateAntiforgeryToken]` (or a global auto-validate filter). Unannotated MVC POST actions get no new protection, and JSON endpoints are not rejected. Requests with neither header are allowed (non-browser clients). It can be disabled globally with the `DisableCsrfProtection` configuration key; trusted cross-origin callers come from a CORS policy that names the origin **and** calls `AllowCredentials()` (`AllowAnyOrigin` is not a trust signal, but `SetIsOriginAllowed(_ => true)` with `AllowCredentials()` trusts every origin and defeats the check). `DisableAntiforgery()`/`[IgnoreAntiforgeryToken]` opt out of both mechanisms. When `UseAntiforgery()` is also called, the token result is authoritative.

## What to investigate

**1. MVC POST actions without a filter.** In apps using `AddControllersWithViews`/`AddMvc` and cookie authentication, check whether a global `AutoValidateAntiforgeryTokenAttribute` filter is registered. If not, every `[HttpPost]`/`[HttpPut]`/`[HttpDelete]` action without `[ValidateAntiForgeryToken]` (on the action or controller) is unprotected. Prioritize email/password/2FA changes, payments, role changes, deletes.

**2. Explicit opt-outs.** `[IgnoreAntiforgeryToken]` on controllers or pages, `.DisableAntiforgery()` on groups or endpoints that use cookie authentication and accept forms. Justified only for bearer/API-key/signature-authenticated endpoints.

**3. Cookie SameSite.** The default `Lax` auth cookie is not sent on cross-site POSTs in modern browsers, which mitigates most form CSRF but not same-site attacks (sibling subdomains), top-level GET, or older clients. `Cookie.SameSite = SameSiteMode.None` (often set for iframes or SSO widgets) removes that mitigation; combined with a missing token it is a straightforward CSRF.

**4. State-changing GET.** Actions with `[HttpGet]` (or no verb attribute on a conventional route) that delete, approve, change settings or log out. Neither tokens nor `Lax` cookies protect top-level GET navigation.

**5. Cookie-authenticated APIs.** `[ApiController]` endpoints that accept the auth cookie and bind `[FromForm]` (form posts work cross-site) or accept `text/plain` via a custom input formatter. JSON-only bodies require `application/json`, which a cross-site form cannot send without a CORS preflight.

**6. SPA token patterns.** An endpoint returning `IAntiforgery.GetAndStoreTokens(...).RequestToken` to any origin combined with permissive CORS (`SetIsOriginAllowed(_ => true)` + credentials) leaks the token.

**7. Login CSRF.** Custom login actions without antiforgery (Low; higher when the app links payment methods or uploads to the logged-in identity).

## Fix patterns

```csharp
builder.Services.AddControllersWithViews(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));

builder.Services.ConfigureApplicationCookie(o => o.Cookie.SameSite = SameSiteMode.Lax);

app.MapPost("/support/tickets/{id:int}/close", CloseTicket);   // form-bound: antiforgery validated automatically (8.0+)
// Only for bearer-authenticated, non-browser endpoints:
app.MapPost("/api/devices/{id}/upload", Upload).RequireAuthorization("ApiClients").DisableAntiforgery();
```

## Severity, false positives, verification

Severity: unprotected email/password/MFA change or money movement with `SameSite=None` cookies **High**; the same with default `Lax` cookies **Medium** (state the browser assumption); low-impact settings **Low**; state-changing GET **Medium/Low** by impact.

False positives: Razor Pages handlers without attributes (automatic validation); minimal API form endpoints without explicit calls (automatic in 8.0+); JSON-only APIs; bearer-token or API-key endpoints; webhooks verifying a signature; `[IgnoreAntiforgeryToken]` on a public, side-effect-free endpoint.

Verify (the test server does not add `Sec-Fetch-Site`):
```csharp
[Fact]
public async Task ChangeEmail_without_token_is_rejected()
{
    var client = _factory.CreateClientAs("alice");                       // test auth helper, see verification.md
    var res = await client.PostAsync("/Account/ChangeEmail",
        new FormUrlEncodedContent(new Dictionary<string, string> { ["email"] = "x@example.test" }));
    Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);              // MVC antiforgery failure = 400
}
```
Note that a test auth handler that bypasses cookies proves the filter, not the SameSite behavior; check cookie attributes separately.

References: https://learn.microsoft.com/aspnet/core/security/anti-request-forgery, https://learn.microsoft.com/aspnet/core/blazor/security/#antiforgery-support, https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/security; OWASP CSRF Prevention cheat sheet; CWE-352.
