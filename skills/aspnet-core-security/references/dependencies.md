# ASP.NET Core — Versions, Support Status and Advisories

## Contents
- Read the installed versions
- Support status on 2026-10-02
- ASP.NET Core and .NET advisories (2025 to 2026)
- Notable package advisories
- Commands
- Reporting guidance

## Read the installed versions

Two separate things ship security fixes:

1. **The shared framework** (`Microsoft.AspNetCore.App`, `Microsoft.NETCore.App`): Kestrel, MVC, Identity, Data Protection, SignalR. The version is decided at deployment: the container base image tag (`mcr.microsoft.com/dotnet/aspnet:8.0.20`, `:9.0`, `:10.0-noble`), the runtime installed on the host (`dotnet --list-runtimes`), or the SDK used for self-contained publishes (`<SelfContained>true</SelfContained>`, `-r linux-x64 --self-contained`: those must be **rebuilt** to pick up fixes). Floating tags (`8.0`, `10.0`) get patches on rebuild; pinned patch tags don't.
2. **NuGet packages**: EF Core and providers, `Microsoft.AspNetCore.Authentication.JwtBearer`/`OpenIdConnect`/`Negotiate`, `Microsoft.AspNetCore.DataProtection.*` extensions, `Microsoft.IdentityModel.*`, `Microsoft.Data.SqlClient`, third-party libraries. Read versions from `.csproj`, `Directory.Packages.props` (central package management) and `packages.lock.json`.

`<TargetFramework>` tells you the major line, not the patch.

## Support status on 2026-10-02

From the .NET support policy page:

| Version | Type | Latest patch (2026-09-08) | End of support |
|---|---|---|---|
| .NET 10 | LTS | 10.0.12 | 2028-11-14 |
| .NET 9 | STS (24 months since the 2025 policy change) | 9.0.20 | **2026-11-10** |
| .NET 8 | LTS | 8.0.31 | **2026-11-10** |
| .NET 11 | RC1 (go-live) | 11.0.0-rc.1 | GA expected November 2026 |
| .NET 7, 6, 5, Core 3.1 and earlier | Out of support | none | 2024-05-14 (7), 2024-11-12 (6) |

.NET 8 and 9 apps should plan migration to .NET 10 now: after 2026-11-10 they receive no security fixes. Report an out-of-support major line as a finding (Medium; High when internet-facing and handling sensitive data), and a supported line below the latest patch as a finding only when a published advisory affects a feature the app uses (or as Hardening).

## ASP.NET Core and .NET advisories (2025 to 2026)

From `github.com/dotnet/aspnetcore/security/advisories` and `github.com/dotnet/runtime/security/advisories` (first fixed version per line):

| CVE | Component and condition | Fixed in |
|---|---|---|
| CVE-2025-24070 | Identity: `RefreshSignInAsync` with an improperly authenticated user parameter lets an attacker sign in as another user | 8.0.14, 9.0.3; `Microsoft.AspNetCore.Identity` 2.3.1 |
| CVE-2025-55315 | Kestrel HTTP request smuggling (security feature bypass, CVSS 9.9); authenticated attacker can smuggle requests past front-end controls or hijack other users' requests | 8.0.21, 9.0.10, 10.0.0-rc.2; `Microsoft.AspNetCore.Server.Kestrel.Core` 2.3.6 |
| CVE-2026-26130 | SignalR buffer exhaustion DoS | 8.0.25, 9.0.14, 10.0.4 |
| CVE-2026-40372 | `Microsoft.AspNetCore.DataProtection` NuGet 10.0.0 to 10.0.6: forged auth cookies and decryption (CVSS 9.1). Affects the NuGet copy when actually loaded (mainly non-Windows apps that don't use a newer shared framework, or `net462`/`netstandard2.0` consumers); 8.x/9.x not affected. Rotate the key ring after upgrading | 10.0.7 |
| CVE-2026-42899 | ASP.NET Core infinite loop DoS | 8.0.27, 9.0.16, 10.0.8 |
| CVE-2026-45591 | SignalR/Blazor Server MessagePack hub protocol stack overflow DoS | 8.0.28, 9.0.17, 10.0.9 |
| CVE-2026-47300, CVE-2026-47303 | Negotiate authentication elevation of privilege (apps using Negotiate with LDAP role lookup) | 8.0.29, 9.0.18, 10.0.10 |
| CVE-2026-56170 | SignalR stateful reconnect DoS (only when stateful reconnect is enabled) | 8.0.26, 9.0.15, 10.0.6 |
| CVE-2026-69304 | IIS out-of-process request decompression DoS (Windows/IIS) | 8.0.31, 9.0.20, 10.0.12, 11.0.0-rc.1 |

The .NET runtime repository published further 2026 advisories (for example the August 2026 batch fixed in 8.0.30 / 9.0.19 / 10.0.11 and the July batch in 8.0.29 / 9.0.18 / 10.0.10). In practice: anything below **8.0.31 / 9.0.20 / 10.0.12** misses at least one published fix; below **8.0.21 / 9.0.10** includes the Kestrel smuggling flaw.

## Notable package advisories

| Package | Advisory | Fixed in |
|---|---|---|
| `System.Linq.Dynamic.Core` | CVE-2023-32571 remote code execution via untrusted expressions (`>= 1.0.7.10, < 1.3.0`); CVE-2024-51417 property reflection (`< 1.6.0`) | 1.3.0; 1.6.0 |
| `Newtonsoft.Json` | CVE-2024-21907 deeply nested input DoS (`< 13.0.1`). `TypeNameHandling` misuse is an app bug, not a package CVE (`injection.md`) | 13.0.1 |
| `Microsoft.Data.SqlClient` / `System.Data.SqlClient` | CVE-2024-0056 TLS security feature bypass | 2.1.7, 3.1.5, 4.0.5, 5.1.3 / 4.8.6 |
| `System.IdentityModel.Tokens.Jwt`, `Microsoft.IdentityModel.JsonWebTokens` | CVE-2024-21319 DoS via large JWE | 5.7.0, 6.34.0, 7.1.2 |

Image, PDF and Office libraries (ImageSharp, Magick.NET, SkiaSharp, PdfSharp, NPOI) have frequent advisories; check the audit output rather than memory.

## Commands

```bash
dotnet --list-runtimes                                    # on the host or inside the container image
dotnet list package --vulnerable --include-transitive     # .NET 9 and earlier syntax; works on 10 too
dotnet package list --vulnerable --include-transitive     # noun-first form in newer SDKs (.NET 10)
dotnet list package --outdated
dotnet nuget why <project> <package>                      # why a transitive package is present
dotnet package update --vulnerable                        # .NET 10 SDK: update vulnerable packages
```
NuGetAudit runs during `restore` (NuGet 6.8 / .NET 8 SDK and later) using the GitHub Advisory Database: `NU1901`-`NU1904` warnings by severity, `NU1905` when an audit source has no vulnerability data. `NuGetAuditMode` defaults to `all` (transitive) for projects targeting `net10.0`+, otherwise `direct`; `NuGetAuditLevel` defaults to `low`. In CI, fail on high/critical with `<WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904</WarningsAsErrors>`, and check `NuGetAudit` isn't set to `false` and `NuGetAuditSuppress` items carry a justification. NuGetAudit does not cover the shared framework patch level or container base images; use an image scanner (Trivy, Grype, Defender for Containers) for those.

## Reporting guidance

- Name the installed version and its source (image tag, lock file), the advisory, the fixed version, and whether the vulnerable feature is used (SignalR, Negotiate, IIS out-of-process, Data Protection NuGet package on Linux).
- Kestrel request smuggling matters most when a proxy or gateway in front enforces security controls; still report any runtime below the fix as High.
- Do not call a package vulnerable because it is old; cite a matching advisory.
- Recommend floating minor tags plus rebuilds, Dependabot/Renovate for NuGet and Docker, and NuGetAudit as an error for high/critical in CI.

References: https://dotnet.microsoft.com/platform/support/policy/dotnet-core, https://devblogs.microsoft.com/dotnet/dotnet-sts-releases-supported-for-24-months/, https://github.com/dotnet/aspnetcore/security/advisories, https://github.com/dotnet/runtime/security/advisories, https://learn.microsoft.com/nuget/concepts/auditing-packages, https://github.com/advisories?query=ecosystem%3Anuget.
