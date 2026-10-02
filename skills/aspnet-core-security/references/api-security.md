# ASP.NET Core — APIs, Rate Limiting, SignalR, gRPC and Webhooks

## Contents
- Data exposure
- OpenAPI and documentation endpoints
- Rate limiting and resource limits
- SignalR
- gRPC
- Webhooks and machine clients
- Severity, false positives, verification

## Data exposure

- Returning EF entities (`return Ok(user)`, `Results.Ok(await db.Users.ToListAsync())`) serializes every public property: `IdentityUser` alone exposes `PasswordHash`, `SecurityStamp`, `ConcurrencyStamp`, `PhoneNumber`, `LockoutEnd`, `AccessFailedCount`. Navigation properties leak related rows (and cause cycles). Use response DTOs/projections (`Select(u => new UserDto(...))`).
- Unbounded queries: `pageSize` from the query without a cap, `ToListAsync()` on whole tables, OData `$top` without `MaxTop`, GraphQL without depth/complexity limits.
- `ProblemDetails`/`ValidationProblemDetails` echoing internal exception text (`secrets-config.md`).

## OpenAPI and documentation endpoints

- .NET 9 templates replaced Swashbuckle with `Microsoft.AspNetCore.OpenApi`: `builder.Services.AddOpenApi()` + `app.MapOpenApi()` (serves `/openapi/{documentName}.json`), usually inside `if (app.Environment.IsDevelopment())`. Older apps use `UseSwagger()`/`UseSwaggerUI()` (Swashbuckle) or NSwag; UI is often added with Scalar.
- Production exposure is a finding when the document reveals internal/admin endpoints or the UI allows authenticated "try it out" calls; documenting public APIs deliberately is not. `MapOpenApi()` returns an endpoint builder, so `.RequireAuthorization()` can protect it. Under a fallback policy, an anonymous-access OpenAPI endpoint needs explicit `.AllowAnonymous()`, which tells you the exposure was intentional.

## Rate limiting and resource limits

- Built-in since .NET 7 (`Microsoft.AspNetCore.RateLimiting`): `AddRateLimiter(o => ...)` + `UseRateLimiter()`, with `[EnableRateLimiting("policy")]`, `.RequireRateLimiting("policy")`, `[DisableRateLimiting]`, or `GlobalLimiter`. Not added automatically. `UseRateLimiter` must run after `UseRouting` when endpoint-specific policies are used. `RejectionStatusCode` defaults to **503**; set 429.
- Partition keys decide effectiveness: `RemoteIpAddress` is the proxy's IP unless forwarded headers are processed, and spoofable if forwarded headers are trusted from anywhere (`secrets-config.md`); `User.Identity.Name` is null for anonymous login attempts (all anonymous requests share one bucket or none).
- Look for missing limits on login, registration, password reset, OTP/2FA, invitation, search/export, file conversion and outbound-call endpoints. Gateways (Azure Front Door, API Management, NGINX) may enforce limits; confirm before reporting.
- Kestrel limits (`MaxRequestBodySize`, `MaxRequestHeadersTotalSize`, `MaxConcurrentConnections`), `FormOptions` limits, `[DisableRequestSizeLimit]` on public endpoints, request timeouts middleware (`AddRequestTimeouts`, .NET 8+).

## SignalR

- `[Authorize]` on the `Hub` class or methods (and `.RequireAuthorization()` on `MapHub`) controls connection and invocation. Every public hub method is callable by any connected client with any arguments; treat them like controller actions.
- **Group and user targeting:** `Groups.AddToGroupAsync(Context.ConnectionId, $"ticket-{ticketId}")` with a client-supplied ID and no ownership check lets users subscribe to other customers' messages. `Clients.User(userIdFromClient)` lets them message anyone. Use `Context.UserIdentifier`/`Context.User` and check access per call.
- CORS does not apply to WebSockets; restrict origins for cookie-authenticated hubs (WebSockets origin restriction) and do not use `SetIsOriginAllowed(_ => true)` with credentials.
- Browser clients send bearer tokens as the `access_token` query string for WebSockets/SSE; ASP.NET Core logs request URLs at Information level, so tokens can land in logs. Read the token from the query only for the hub path (`OnMessageReceived`).
- `EnableDetailedErrors` sends exception messages to clients (development only). `MaximumReceiveMessageSize` (32 KB default) raised without need is DoS surface.
- Advisories: CVE-2026-26130 (SignalR buffer exhaustion, fixed 8.0.25 / 9.0.14 / 10.0.4), CVE-2026-45591 (MessagePack hub protocol stack overflow, fixed 8.0.28 / 9.0.17 / 10.0.9), CVE-2026-56170 (stateful reconnect DoS, only when stateful reconnect is enabled; fixed 8.0.26 / 9.0.15 / 10.0.6). See `dependencies.md`.

## gRPC

`MapGrpcService<T>()` endpoints honor `[Authorize]`/`.RequireAuthorization()` like controllers; check each service and method, and object-level checks inside methods. `MapGrpcReflectionService()` in production exposes the full service schema; `EnableDetailedErrors` returns exception messages in status details; `MaxReceiveMessageSize` (4 MB default) raised or set to `null`; gRPC-Web/JSON transcoding exposing the same methods over HTTP with different CORS settings.

## Webhooks and machine clients

- Provider webhooks (Stripe, GitHub, payment gateways) must verify the signature over the raw body (`HMACSHA256` + `CryptographicOperations.FixedTimeEquals`), check a timestamp for replay, and be idempotent. `[AllowAnonymous]` + no verification = forgeable events (paid orders, account changes). Reading the body after model binding loses the raw bytes; use `Request.EnableBuffering()` or bind the raw body.
- API keys compared with `==` on strings (timing, Low), keys in query strings (logged), one shared key for all tenants, keys without scopes; client-credential tokens accepted without audience checks (`jwt-bearer.md`).

## Severity, false positives, verification

Severity: unsigned webhooks that change payment or account state **Critical/High**; SignalR group subscription to other tenants' data **High**; entity serialization leaking password hashes or tokens **High**; missing rate limits on login/OTP **Medium**; OpenAPI exposure **Low/Info** unless it reveals hidden privileged endpoints; detailed errors **Low/Medium**.

False positives: OpenAPI mapped only in Development; DTO responses; webhook endpoints with verified signatures; limits enforced at a documented gateway; hub methods that only act on `Context.UserIdentifier`.

Verify:
```csharp
[Fact]
public async Task Hub_rejects_joining_another_customers_ticket()
{
    await using var conn = new HubConnectionBuilder()
        .WithUrl(new Uri(_factory.Server.BaseAddress, "/hubs/support"), o => { o.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler(); o.AccessTokenProvider = () => Task.FromResult<string?>(TestTokens.For("bob")); })
        .Build();
    await conn.StartAsync();
    await Assert.ThrowsAsync<HubException>(() => conn.InvokeAsync("JoinTicket", aliceTicketId));
}
```
Webhooks: post an unsigned and a wrongly signed payload and assert 401/400 and no state change. Rate limits: N+1 requests return the configured rejection status.

References: https://learn.microsoft.com/aspnet/core/fundamentals/openapi/overview, https://learn.microsoft.com/aspnet/core/performance/rate-limit, https://learn.microsoft.com/aspnet/core/signalr/security, https://learn.microsoft.com/aspnet/core/signalr/authn-and-authz, https://learn.microsoft.com/aspnet/core/grpc/security; OWASP API Security Top 10 2023 (API1, API3, API4, API8); CWE-770, CWE-345, CWE-213.
