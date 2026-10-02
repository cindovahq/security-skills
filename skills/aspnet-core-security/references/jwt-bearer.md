# ASP.NET Core — JWT Bearer and Token Validation

## Contents
- How JwtBearer validates tokens
- TokenValidationParameters defaults
- What to investigate
- Fix pattern
- Severity, false positives, verification

## How JwtBearer validates tokens

`AddAuthentication().AddJwtBearer(o => ...)` (package `Microsoft.AspNetCore.Authentication.JwtBearer`). With `o.Authority` set, the handler downloads OIDC metadata and signing keys (`RequireHttpsMetadata` defaults to `true`) and validates the issuer from metadata. Without `Authority`, the app supplies `TokenValidationParameters` (`IssuerSigningKey`, `ValidIssuer`, `ValidAudience`) itself, which is where most mistakes happen.

Since ASP.NET Core 8.0 the handler uses `JsonWebTokenHandler` by default. `SecurityToken` values in events are `JsonWebToken` instead of `JwtSecurityToken`; `UseSecurityTokenValidators = true` restores the old path. Code in `OnTokenValidated` that casts to `JwtSecurityToken` silently gets `null` on 8.0+.

`MapInboundClaims` (default `true`) maps short claim names to long URIs (`sub` becomes `ClaimTypes.NameIdentifier`, `role` becomes `ClaimTypes.Role`). Code that reads `User.FindFirst("sub")` returns `null` unless mapping is off; watch for fallbacks that then trust a request value instead.

## TokenValidationParameters defaults

From `Microsoft.IdentityModel.Tokens` source:

| Property | Default | Meaning |
|---|---|---|
| `ValidateIssuer` | `true` | Requires `ValidIssuer`/`ValidIssuers` or an `IssuerValidator` |
| `ValidateAudience` | `true` | Requires `ValidAudience`/`ValidAudiences` (or `o.Audience`) |
| `ValidateLifetime` | `true` | Checks `exp`/`nbf` with `ClockSkew` (default 5 minutes) |
| `RequireExpirationTime` | `true` | |
| `RequireSignedTokens` | `true` | `false` lets unsigned (`alg: none`) tokens through |
| `ValidateIssuerSigningKey` | `false` | Validates the *key* (for example a certificate's validity), **not** the signature |
| `RequireAudience` | `true` | |

## What to investigate

**1. Disabled checks.**
```csharp
o.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = false, ValidateAudience = false, ValidateLifetime = false,   // signals
    RequireSignedTokens = false,
    SignatureValidator = (token, _) => new JsonWebToken(token),                   // skips signature checking entirely
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!))
};
```
- `SignatureValidator` returning a parsed token without verifying, or `RequireSignedTokens = false`: anyone can forge tokens. **Critical.**
- `ValidateLifetime = false`: stolen tokens never expire. **Medium/High** depending on token reach.
- `ValidateAudience = false` / `ValidateIssuer = false` with a shared key or a multi-tenant authority: tokens minted for another service or tenant are accepted. **Medium/High** when the same key or authority issues tokens for other audiences; Low otherwise.
- `IssuerValidator`/`AudienceValidator`/`LifetimeValidator` delegates that return without checking.
- `ValidAlgorithms` not restricted when keys of several types are configured. Algorithm confusion is mitigated by key-type checks in IdentityModel, so report only with a concrete path.

**2. Signing keys.** Symmetric keys (HS256) read from `appsettings.json`, a constant, or a default in `?? "dev-key"`. Anyone with repository, image or log access can mint tokens with any claims. IdentityModel 6.31+ and 7.x (what JwtBearer 8+ uses) reject HMAC keys shorter than the algorithm requires (`IDX10720`), which is why committed keys tend to be long placeholder strings. Also check: the same key for several environments, keys printed at startup, `dotnet user-jwts` signing keys copied into production config.

**3. Token issuance code.** A `/token` or `/login` endpoint that writes `role`/`scope` claims from the request body, issues tokens without password verification, sets `Expires` to months or years, or puts secrets/PII in the payload (JWT payloads are only base64url-encoded).

**4. Scheme mixing.** Policies that accept several schemes (`AuthenticationSchemes = "Cookies,Bearer"`) where one is weaker; `ForwardDefaultSelector` choosing schemes from a header; API endpoints that also accept cookies (CSRF exposure, `csrf.md`).

**5. Refresh and revocation.** Custom refresh tokens stored in plaintext, never rotated, not bound to a user, or accepted after logout. Long-lived access tokens without a revocation path.

**6. Token transport.** Tokens in query strings get logged (SignalR's `access_token` query parameter is a documented exception; see `api-security.md`), `RequireHttpsMetadata = false` outside development, tokens stored with `SaveToken` (true by default) and later echoed to clients or logged.

## Fix pattern

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = builder.Configuration["Auth:Authority"];   // keys and issuer from metadata
        o.Audience  = "portal-api";
        o.TokenValidationParameters.ValidAlgorithms = [SecurityAlgorithms.RsaSha256];
    });
```

For self-issued tokens, load the key from Key Vault or the environment, set `ValidIssuer`, `ValidAudience`, keep lifetime validation, and issue short `Expires` (minutes) with rotating refresh tokens stored hashed.

## Severity, false positives, verification

False positives: `ValidateIssuerSigningKey = false` alone (signature is still checked); `ValidateIssuer = false` when the app uses a single-tenant authority whose keys sign only its own tokens and the audience is validated (Hardening); keys in `appsettings.Development.json` or from `dotnet user-jwts` used only locally; `MapInboundClaims = false` (a deliberate choice, not a weakness).

Verify:
```csharp
[Fact]
public async Task Expired_or_wrong_audience_token_is_rejected()
{
    var client = _factory.CreateClient();
    client.DefaultRequestHeaders.Authorization = new("Bearer", TestTokens.Create(audience: "other-api", expires: DateTime.UtcNow.AddMinutes(-10)));
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/orders")).StatusCode);
}
```
Also test a token signed with a different key and an unsigned token (header `alg` set to `none`): both must return 401. Build test tokens with `JsonWebTokenHandler.CreateToken(SecurityTokenDescriptor)` in the test project only.

References: https://learn.microsoft.com/aspnet/core/security/authentication/configure-jwt-bearer-authentication, https://learn.microsoft.com/dotnet/core/compatibility/aspnet-core/8.0/securitytoken-events, https://learn.microsoft.com/dotnet/api/microsoft.identitymodel.tokens.tokenvalidationparameters; OWASP JSON Web Token cheat sheet; CWE-347, CWE-345, CWE-613, CWE-798.
