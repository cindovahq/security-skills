# ASP.NET Core — Cookies, Sessions and Data Protection

## Contents
- Authentication cookie defaults
- Session middleware
- Data Protection key ring
- What to investigate
- Severity, false positives, verification

## Authentication cookie defaults

`CookieAuthenticationOptions` (also used by Identity's application cookie via `ConfigureApplicationCookie`):

| Setting | Default | Note |
|---|---|---|
| `Cookie.HttpOnly` | `true` | `false` exposes the auth cookie to any XSS |
| `Cookie.SecurePolicy` | `SameAsRequest` | Behind a TLS-terminating proxy without forwarded headers, requests look like HTTP and the cookie loses `Secure`; prefer `Always` |
| `Cookie.SameSite` | `Lax` | `None` re-enables cross-site POSTs carrying the cookie (CSRF), and browsers require `Secure` with it |
| `ExpireTimeSpan` | 14 days | Lifetime of the authentication ticket |
| `SlidingExpiration` | `true` | Reissued when more than half the window has elapsed |
| `Cookie.Expiration` | ignored | Use `ExpireTimeSpan` |

The cookie content is the serialized `AuthenticationTicket` protected with Data Protection. Anyone who can read the key ring can forge cookies; anyone who steals a cookie can replay it until it expires (no server-side session unless `SessionStore` is set). Logout with `SignOutAsync` removes the cookie from the browser but a copied cookie remains valid until expiry unless the app validates the security stamp (Identity, every 30 minutes by default) or uses a server-side `ITicketStore`.

ASP.NET Core 10 changed cookie authentication to return 401/403 instead of login redirects for known API endpoints (`[ApiController]`, minimal APIs reading or writing JSON, `TypedResults`, SignalR). Not a security change, but explains differing test expectations across versions.

## Session middleware

`AddSession()` + `UseSession()` stores data server-side (`IDistributedCache`) keyed by a cookie (`.AspNetCore.Session`). Defaults: `IdleTimeout` 20 minutes, `Cookie.HttpOnly = true`, `Cookie.SameSite = Lax`, `Cookie.SecurePolicy = None` (set `Always`). Session is **not** tied to authentication: it survives sign-in and sign-out unless the app clears it, so storing `UserId`, `IsAdmin` or "MFA passed" flags in `ISession` and trusting them is a session-fixation and privilege bug. Call `HttpContext.Session.Clear()` on sign-in and sign-out when the session holds user state. `AddDistributedMemoryCache` loses sessions on restart and doesn't share them across instances.

## Data Protection key ring

Data Protection protects auth cookies, antiforgery tokens, `TempData` (cookie provider), Identity tokens from the default token providers, and anything using `IDataProtector`. Default storage depends on the host: Azure App Service `%HOME%\ASP.NET\DataProtection-Keys` (not encrypted at rest), the user profile directory (DPAPI-encrypted only on Windows), the IIS registry hive, or **in memory only** when none apply. Keys have a 90-day lifetime; algorithms default to AES-256-CBC + HMACSHA256.

Docs guidance for containers: persist keys to a volume that outlives the container or to an external store, and protect them at rest. Calling `PersistKeysTo*` turns off automatic at-rest encryption, so pair it with `ProtectKeysWith*` (`ProtectKeysWithCertificate`, `ProtectKeysWithAzureKeyVault`, `ProtectKeysWithDpapi`).

Apps are isolated by content root path unless `SetApplicationName("...")` is set; several apps that need to share cookies must set the same name and share the key ring, and unrelated apps sharing a repository must not.

## What to investigate

1. **Cookie flags:** `HttpOnly = false`, `SecurePolicy = None` or `SameAsRequest` behind a proxy, `SameSite = None` without a cross-site requirement, `Cookie.Domain = ".example.com"` shared with untrusted subdomains, very long `ExpireTimeSpan` (90+ days) or `IsPersistent = true` forced for every login.
2. **Key ring exposure:** keys persisted to a world-readable path, inside `wwwroot`, committed to the repository, baked into a container image, or stored in a shared database/Redis without access control. A leaked key ring means forged authentication cookies for any user. Keys shared across environments (staging can mint production cookies).
3. **Key ring availability:** multiple instances or containers with no `PersistKeysTo*` call: users are logged out on restart and antiforgery fails on other nodes. Teams sometimes "fix" this by disabling antiforgery or encrypting cookies themselves; look for that.
4. **Custom crypto around Data Protection:** `CreateProtector` purposes reused across features (a token for one purpose decrypts in another), `ToTimeLimitedDataProtector()` missing for links that should expire, `Unprotect` results trusted without binding to the current user.
5. **DataProtection 10.0.0 to 10.0.6 NuGet package (CVE-2026-40372):** forged payloads accepted when the NuGet copy of `Microsoft.AspNetCore.DataProtection` 10.0.x up to 10.0.6 was actually loaded (non-Windows, not framework-dependent on a newer shared framework, or a `net462`/`netstandard2.0` consumer). Fixed in 10.0.7; the advisory says to rotate the key ring and audit tokens issued in the window. 8.0.x and 9.0.x were not affected.
6. **Logout:** `SignOutAsync` with the wrong scheme (external cookie cleared, application cookie kept), GET logout links (CSRF-able, Low), no `UpdateSecurityStampAsync` when "log out everywhere" is offered.

```csharp
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
});

builder.Services.AddDataProtection()
    .SetApplicationName("acme-portal")
    .PersistKeysToAzureBlobStorage(blobUri, credential)
    .ProtectKeysWithAzureKeyVault(keyId, credential);
```

## Severity, false positives, verification

Severity: leaked or committed key ring **Critical** (cookie forgery); `HttpOnly = false` **Medium** (High combined with a real XSS); `SameSite = None` on the auth cookie with CSRF-able actions: rate the CSRF finding (`csrf.md`); privilege flags in `ISession` trusted for authorization **High**; non-persisted keys on multi-instance deployments: availability, not a vulnerability (Informational) unless it led to disabled protections.

False positives: default cookie options; `SecurePolicy = SameAsRequest` when forwarded headers are correctly configured and HSTS is on (Hardening at most); in-memory keys on a single-instance internal tool; `SetApplicationName` absent in a single-app deployment.

Verify: integration test asserting the `Set-Cookie` header contains `httponly`, `secure`, `samesite=lax`; restart the test host with the same key directory and confirm old cookies still work (persistence) and that a cookie protected by a different key ring is rejected.

References: https://learn.microsoft.com/aspnet/core/security/authentication/cookie, https://learn.microsoft.com/aspnet/core/fundamentals/app-state, https://learn.microsoft.com/aspnet/core/security/data-protection/configuration/default-settings, https://learn.microsoft.com/aspnet/core/security/data-protection/configuration/overview, https://github.com/dotnet/aspnetcore/security/advisories/GHSA-9mv3-2cwr-p262; OWASP Session Management cheat sheet; CWE-1004, CWE-614, CWE-384, CWE-321.
