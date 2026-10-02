# ASP.NET Core — Authentication

## Contents
- How authentication is wired
- ASP.NET Core Identity defaults
- What to investigate
- Fix patterns
- Severity, false positives, verification

## How authentication is wired

- `builder.Services.AddAuthentication(...)` registers schemes (`.AddCookie()`, `.AddJwtBearer()`, `.AddOpenIdConnect()`, `.AddNegotiate()`), and `AddIdentity<TUser, TRole>()` / `AddDefaultIdentity<TUser>()` register ASP.NET Core Identity with its application cookie (`IdentityConstants.ApplicationScheme`). `AddIdentityCore<TUser>()` registers only the user-management services (no cookie scheme, no `SignInManager`).
- `WebApplication` adds `UseAuthentication()` right after `UseRouting()` and then `UseAuthorization()` when the services are registered and user code didn't call them (Microsoft Learn, "WebApplication and WebApplicationBuilder"). Explicit calls must come after `UseRouting`, after `UseCors`, and before endpoints.
- .NET 8 added Identity API endpoints: `AddIdentityApiEndpoints<TUser>()` + `app.MapIdentityApi<TUser>()` (`/register`, `/login`, `/refresh`, `/confirmEmail`, `/forgotPassword`, `/resetPassword`, `/manage/2fa`, `/manage/info`). Its bearer tokens are opaque Data Protection tokens, not JWTs (`BearerTokenOptions.BearerTokenExpiration` 1 hour, `RefreshTokenExpiration` 14 days by default).
- Blazor Web App templates (8.0+) scaffold Identity as Razor components under `Components/Account`; MVC/Razor Pages apps use the Identity UI Razor class library or scaffolded pages under `Areas/Identity`.

## ASP.NET Core Identity defaults

| Option | Default | Note |
|---|---|---|
| `Lockout.MaxFailedAccessAttempts` | 5 | Only counts when `PasswordSignInAsync(..., lockoutOnFailure: true)` or `AccessFailedAsync` is called |
| `Lockout.DefaultLockoutTimeSpan` | 5 minutes | |
| `Lockout.AllowedForNewUsers` | `true` | |
| `Password.RequiredLength` | 6 | Plus digit, lower, upper and non-alphanumeric required; `RequiredUniqueChars` 1 |
| `SignIn.RequireConfirmedEmail` / `RequireConfirmedAccount` | `false` | Templates set `RequireConfirmedAccount = true` |
| `User.RequireUniqueEmail` | `false` | |
| `PasswordHasherOptions.IterationCount` | 100,000 (PBKDF2, `IdentityV3`) | 100,000 since ASP.NET Core 7.0; 10,000 in 6.0 and earlier; old hashes are rehashed on successful login |
| `SecurityStampValidatorOptions.ValidationInterval` | 30 minutes | How quickly a password change or `UpdateSecurityStampAsync` invalidates other cookies |

**Template gotcha:** the Identity UI login page calls `PasswordSignInAsync(Input.Email, Input.Password, Input.RememberMe, lockoutOnFailure: false)` with a comment explaining how to enable lockout. Scaffolded or copied login code therefore usually has **no lockout**. `MapIdentityApi`'s `/login` passes `lockoutOnFailure: true`.

## What to investigate

**1. Brute force and credential stuffing.** ASP.NET Core has no built-in login throttling apart from Identity lockout. Look for `lockoutOnFailure: false`, custom login code calling `CheckPasswordAsync` or `PasswordHasher.VerifyHashedPassword` without `AccessFailedAsync`, and no rate limiter (`[EnableRateLimiting]`, `.RequireRateLimiting()`) on login, 2FA (`TwoFactorSignInAsync`, `TwoFactorAuthenticatorSignInAsync`), recovery code, and forgot-password endpoints. An IP-partitioned limiter is bypassable if forwarded headers are trusted from anywhere (`secrets-config.md`).

**2. Custom password storage.** `SHA256`/`MD5` over passwords, `string ==` comparisons of hashes, plaintext columns, or a custom `IPasswordHasher<T>`. The built-in `PasswordHasher<TUser>` (PBKDF2) can be used standalone without full Identity.

**3. Weak Identity options.** `RequiredLength` below 8, all character classes turned off with no length compensation, `Lockout.AllowedForNewUsers = false`, `MaxFailedAccessAttempts` very high. OWASP ASVS favors length (≥ 8, preferably 15 for single-factor) over composition rules, so long minimums with composition off are fine.

**4. Account recovery and confirmation.** `GeneratePasswordResetTokenAsync` tokens built into links using `Request.Host` (host header poisoning unless host filtering is configured, see `secrets-config.md`); reset or confirm endpoints that reveal whether an account exists; `ResetPasswordAsync` called with a user looked up from a client-supplied ID instead of the token's user; `RequireConfirmedAccount` off where email identity matters; email change without confirmation (`ChangeEmailAsync` requires a token; direct `user.Email = ...; UpdateAsync` skips it).

**5. Sign-in logic.** `SignInAsync(user, ...)` or `HttpContext.SignInAsync(principal)` reached without verifying the password or second factor; claims built from request data (`new Claim(ClaimTypes.Role, model.Role)`); `RefreshSignInAsync` called with a user that was not loaded from the current principal (CVE-2025-24070 fixed the framework side in 8.0.14 / 9.0.3; app code passing the wrong user is still a bug).

**6. Session invalidation.** Password change or disable-account flows that don't call `UpdateSecurityStampAsync` (other sessions stay valid up to the cookie lifetime), long `ExpireTimeSpan` with `SlidingExpiration` (cookie default 14 days, sliding), logout that only deletes client state. Cookie options are in `sessions-data-protection.md`.

**7. External and Windows auth.** OIDC: `ResponseType`, `SaveTokens`, `GetClaimsFromUserInfoEndpoint`, `TokenValidationParameters` overrides (`jwt-bearer.md`), account linking by unverified email. Negotiate/Kerberos with LDAP role lookup: CVE-2026-47300 and CVE-2026-47303 (elevation of privilege in `Microsoft.AspNetCore.Authentication.Negotiate`, fixed in 8.0.29, 9.0.18, 10.0.10).

**8. 2FA.** Authenticator setup that accepts a client-supplied shared key, recovery codes shown or stored in plaintext beyond the setup page, `TwoFactorEnabled` toggled through a bound model (`model-binding.md`).

## Fix patterns

```csharp
builder.Services.AddIdentity<PortalUser, IdentityRole>(o =>
{
    o.SignIn.RequireConfirmedAccount = true;
    o.Password.RequiredLength = 12;
    o.Lockout.MaxFailedAccessAttempts = 5;
    o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
}).AddEntityFrameworkStores<PortalDbContext>().AddDefaultTokenProviders();

builder.Services.AddRateLimiter(o => o.AddPolicy("login", ctx =>
    RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) })));

var result = await _signInManager.PasswordSignInAsync(email, password, remember, lockoutOnFailure: true);
```

After a password or email change: `await _userManager.UpdateSecurityStampAsync(user); await _signInManager.RefreshSignInAsync(user);` where `user` comes from `_userManager.GetUserAsync(User)`.

## Severity, false positives, verification

Severity: sign-in reachable without a valid password or second factor **Critical**; role claims from request data **Critical**; no lockout and no throttling on an internet-facing login **Medium** (High for admin portals or where MFA is absent and accounts hold sensitive data); weak password policy **Low/Medium**; missing `UpdateSecurityStampAsync` after password change **Low/Medium**.

False positives: `lockoutOnFailure: false` when a rate limiter or upstream gateway demonstrably throttles the endpoint (name it); `PasswordHasher<T>` used outside Identity (it is the framework PBKDF2 hasher); `RequiredLength = 6` alone without other evidence (report as Hardening at most); Identity UI pages you can't see because they come from the Razor class library (defaults apply).

Verify with `WebApplicationFactory` (`verification.md`): N+1 failed logins then a correct password returns a lockout result; the rate limiter returns its `RejectionStatusCode` (503 unless set to 429); reset tokens are single-use; old cookie rejected after password change and security stamp refresh (after `ValidationInterval`, or set it to `TimeSpan.Zero` in the test).

References: https://learn.microsoft.com/aspnet/core/security/authentication/identity-configuration, https://learn.microsoft.com/aspnet/core/security/authentication/identity-api-authorization, https://learn.microsoft.com/aspnet/core/performance/rate-limit, https://github.com/dotnet/aspnetcore/security/advisories; OWASP Authentication cheat sheet; CWE-307, CWE-521, CWE-287.
