# ASP.NET Core — Authorization, IDOR and Access Control

## Contents
- How authorization is applied
- Precedence rules that cause bugs
- What to investigate
- Fix patterns
- Severity, false positives, verification

## How authorization is applied

- Endpoint routing: `UseAuthorization()` (added automatically by `WebApplication` when `AddAuthorization` is registered) reads `IAuthorizeData`/`IAllowAnonymous`/policy metadata from the matched endpoint. If an endpoint carries `[Authorize]` metadata but the authorization middleware did not run for it, `EndpointMiddleware` throws (`RouteOptions.SuppressCheckForUnhandledSecurityMetadata` turns that check off). Missing or misordered middleware therefore usually fails closed for decorated endpoints.
- MVC/Razor Pages: `[Authorize]`, `[Authorize(Roles = "...")]`, `[Authorize(Policy = "...")]` on controllers, actions or `PageModel` classes; Razor Pages conventions (`AuthorizeFolder`, `AuthorizePage`, `AllowAnonymousToPage`) in `AddRazorPages(o => o.Conventions...)`.
- Minimal APIs: `.RequireAuthorization("Policy")`, `.AllowAnonymous()`, `MapGroup("/admin").RequireAuthorization(...)`, or `[Authorize]` on the handler delegate.
- Policies: `AddAuthorization(o => o.AddPolicy(...))` or `AddAuthorizationBuilder()`, requirements + `AuthorizationHandler<TRequirement>` or `AuthorizationHandler<TRequirement, TResource>` for resource-based checks via `IAuthorizationService.AuthorizeAsync(User, resource, "Policy")`.
- `AuthorizationOptions.DefaultPolicy` (used by bare `[Authorize]`, default: authenticated user) and `FallbackPolicy` (used when an endpoint has **no** authorization metadata; default `null`, meaning public).
- Blazor: `@attribute [Authorize]` on routable components is enforced on the server for SSR and interactive server rendering; `AuthorizeView` only controls what renders. See `blazor.md`. SignalR hubs and gRPC services take `[Authorize]` on the class or method; see `api-security.md`.

## Precedence rules that cause bugs

- **`[AllowAnonymous]` wins.** For MVC, it bypasses authorization statements: combined with any `[Authorize]`, the `[Authorize]` attributes are ignored. On a controller it makes every action public, including actions with their own `[Authorize(Roles = "Admin")]`. A global `AuthorizeFilter` or fallback policy is also bypassed.
- **Multiple `[Authorize]` attributes are ANDed** (controller `[Authorize(Roles = "Staff")]` + action `[Authorize(Roles = "Admin")]` requires both). `Roles = "Admin,Manager"` in one attribute is OR.
- **Razor Pages: `[Authorize]` cannot be applied to page handlers** (`OnGet`, `OnPostDelete`). Only the `PageModel` class attributes and conventions count, so a role attribute on a single handler is not enforced (no runtime error: the analyzer `MVC1001` only warns at build time when `[Authorize]`, `[AllowAnonymous]` or filters are put on handlers). Use separate pages, a page filter, or an `IAuthorizationService` call inside the handler.
- **Conventions:** `.AllowAnonymousToFolder("/Public").AuthorizePage("/Public/Private")` does not protect the inner page (the docs call this combination invalid). The reverse (authorize a folder, allow one page anonymously) works.
- **Static files** served by `UseStaticFiles()` before `UseAuthorization()` are public even with a fallback policy. On 9.0+ `MapStaticAssets()` endpoints are subject to the fallback policy unless marked anonymous.
- **Role checks in views** (`User.IsInRole` in `.cshtml`, `AuthorizeView`) hide UI only.

## What to investigate

**1. Endpoints without authorization.** List every controller, page, minimal API, hub and gRPC service. Without a `FallbackPolicy`, anything missing `[Authorize]`/`RequireAuthorization` is public. Check `Map*` calls registered outside the authorized group, `[AllowAnonymous]` added "for a background job", "for the mobile app" or "temporarily", and `.AllowAnonymous()` on group members.

**2. Object-level access (IDOR/BOLA).** The classic pattern:
```csharp
[Authorize]
public async Task<IActionResult> Details(int id) => View(await _db.Invoices.FindAsync(id));   // any user, any invoice
```
Look for `Find`/`FindAsync(id)`, `FirstOrDefaultAsync(x => x.Id == id)`, `SingleAsync`, `ExecuteDeleteAsync`/`ExecuteUpdateAsync` with an ID filter only, Dapper `WHERE Id = @id`. Check every verb: GET is often scoped while `PUT`/`DELETE`/export/download twins are not. Check child resources (`/orders/{orderId}/items/{itemId}` must verify the item belongs to the order and the order to the user).

**3. Multi-tenancy.** EF Core global query filters (`HasQueryFilter(e => e.TenantId == _tenant.Id)`) are bypassed by `IgnoreQueryFilters()`, raw SQL (`FromSqlRaw`/Dapper), `ExecuteSqlRaw`, and queries on a `DbContext` instance created without the tenant (background services, `IDbContextFactory`). Tenant IDs taken from a header, route or body instead of the authenticated principal are a finding.

**4. Function-level access.** Admin controllers protected by `[Authorize]` alone (any authenticated user), role names compared case-sensitively by hand, policies whose handler calls `context.Succeed` unconditionally, custom `IAuthorizationFilter`/middleware that checks only a path prefix (`StartsWith("/admin")` misses `/Admin`, `/api/admin`), `IsInRole` checks on claims the user controls.

**5. Claims trust.** Policies built on claims that the app itself writes from user input (`ClaimsTransformation` reading a header or profile field the user edits).

## Fix patterns

```csharp
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("Admin", p => p.RequireRole("Admin"));

// Object-level: scope the query by the authenticated user
var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
var invoice = await _db.Invoices.SingleOrDefaultAsync(i => i.Id == id && i.CustomerId == userId);
if (invoice is null) return NotFound();

// Or resource-based authorization
var result = await _authz.AuthorizeAsync(User, document, "CanEditDocument");
if (!result.Succeeded) return Forbid();
```

Remove `[AllowAnonymous]` from privileged actions; give machine callers their own scheme or policy (API key or client-credentials token) rather than anonymity.

## Severity, false positives, verification

Severity: unauthenticated access to admin functions or bulk data **Critical**; cross-tenant read/write **Critical/High**; IDOR on personal or financial records **High**; IDOR on low-value data **Medium**; UI-only role checks with server enforcement present: not a finding.

False positives: missing `UseAuthorization()` in a `WebApplication` app (added automatically); IDs that are guessable but every query is owner-scoped; `[AllowAnonymous]` on login, health, public content; endpoints protected by a fallback policy rather than an attribute; `FindAsync(id)` followed by an explicit ownership check or `AuthorizeAsync` before any data leaves.

Verify with two users and `WebApplicationFactory` (`verification.md`): user B requesting user A's object gets 404/403 on every verb; anonymous requests to every non-public endpoint get 401 (or a login redirect for cookie-auth MVC); a non-admin calling admin actions gets 403. A route-table test that enumerates `EndpointDataSource.Endpoints` and fails on endpoints without authorization metadata (except an allow-list) catches regressions.

References: https://learn.microsoft.com/aspnet/core/security/authorization/simple, https://learn.microsoft.com/aspnet/core/razor-pages/security/authorization/simple, https://learn.microsoft.com/aspnet/core/security/authorization/policies, https://learn.microsoft.com/aspnet/core/security/authorization/resource-based, https://learn.microsoft.com/ef/core/querying/filters; OWASP Authorization cheat sheet; OWASP API1:2023, API5:2023; CWE-639, CWE-285, CWE-862.
