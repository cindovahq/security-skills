# ASP.NET Core — SSRF and Open Redirects

## Outbound requests (SSRF)

`HttpClient` (direct, typed clients from `IHttpClientFactory`, named clients, Refit/RestSharp/Flurl wrappers) has no notion of "internal" addresses. Defaults that matter: `AllowAutoRedirect = true` with `MaxAutomaticRedirections` 50 (`HttpClientHandler`/`SocketsHttpHandler`); on .NET Core and .NET 5+ HTTPS-to-HTTP redirects are not followed; the `Authorization` header is dropped on redirect, other headers are not.

**Investigate** every outbound call whose URL, host, port or path is influenced by request data, stored user data (webhook URLs, avatar URLs, "import from URL", OpenID/OAuth discovery URLs set by tenants), or file content (SVG/HTML-to-PDF renderers, XML with external references):
```text
GetAsync(url  GetStringAsync(  GetStreamAsync(  SendAsync(new HttpRequestMessage(..., url  PostAsJsonAsync(userUrl
new Uri(request...)  BaseAddress = new Uri(tenant.  WebClient.Download  HttpWebRequest.Create(   (legacy, obsolete)
PuppeteerSharp / Playwright GoToAsync(userUrl)   wkhtmltopdf / DinkToPdf / IronPdf rendering user HTML
```
Typical impact: cloud metadata (`169.254.169.254`, Azure IMDS requires a `Metadata: true` header that attackers can't add unless headers are also controlled), internal admin endpoints, Kubernetes API, Redis/HTTP services on localhost, and data exfiltration when the response body is returned to the caller.

**Weak defenses to flag:** string checks on the URL (`url.StartsWith("https://partner.com")` passes `https://partner.com.evil.example`), host allow-lists checked before redirects are followed, DNS resolved once for validation and again for the request (rebinding), deny-lists that miss IPv6, decimal/octal IPv4 forms or `0.0.0.0`.

**Fix pattern:** allow-list hosts per feature; when arbitrary hosts are a requirement, validate the connected IP in `SocketsHttpHandler.ConnectCallback` (runs for the actual connection, including after redirects) and disable redirects.
```csharp
builder.Services.AddHttpClient("previews")
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        ConnectCallback = async (ctx, ct) =>
        {
            var addrs = await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct);
            var ip = addrs.FirstOrDefault(a => !IpPolicy.IsPrivateOrReserved(a)) ?? throw new HttpRequestException("Blocked address");
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            await socket.ConnectAsync(ip, ctx.DnsEndPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
    });
```
`IpPolicy.IsPrivateOrReserved` must cover loopback, RFC 1918, link-local (`169.254.0.0/16`, `fe80::/10`), unique local `fc00::/7`, `0.0.0.0/8`, and IPv4-mapped IPv6. Return only the fields you need, not the raw response body. Set `Timeout` and a response size limit (`MaxResponseContentBufferSize`).

**Severity:** response returned to an unauthenticated caller with metadata reachable **Critical/High**; blind SSRF to internal network **Medium/High**; fixed host with user-controlled path only **Low/Medium** (path traversal on the partner API can still matter).

**False positives:** URLs from configuration (`IOptions<T>`, `appsettings.json`) or constants; typed clients with a fixed `BaseAddress` where only a validated ID is appended (`$"/v1/rates/{currencyCode}"` after allow-listing the code); outbound calls made only by admins to URLs they configure, in single-tenant deployments (Informational).

## Open redirects

ASP.NET Core sinks: `Redirect(url)`, `RedirectPermanent(url)`, `Results.Redirect(url)`, `Response.Redirect(url)`, `new RedirectResult(url)`, `Challenge(new AuthenticationProperties { RedirectUri = url })`, `SignOut(new AuthenticationProperties { RedirectUri = url }, ...)`. Common sources: `returnUrl`/`ReturnUrl` (cookie auth appends it to `LoginPath` by default), `redirect_uri`, `next`, `Referer`.

Safe constructs (verified in the `SharedUrlHelper.IsLocalUrl` source): `LocalRedirect(url)` / `Results.LocalRedirect(url)` throw `InvalidOperationException` for non-local URLs; `Url.IsLocalUrl(url)` accepts `/path` and `~/path` but rejects `//host`, `/\host`, absolute URLs and URLs with control characters. Identity UI pages use `LocalRedirect(returnUrl)`.

**Investigate:** custom checks such as `returnUrl.StartsWith("/")` (passes `//evil.example`), `Uri.IsWellFormedUriString(url, UriKind.Relative)`, host comparisons with `Contains`, redirects after login and logout, and OAuth/OIDC `RedirectUri` built from request values.

**Fix:**
```csharp
return LocalRedirect(Url.IsLocalUrl(returnUrl) ? returnUrl : "/");
```

**Severity:** **Medium** on login/logout flows (phishing with a trusted domain, token leakage when combined with OAuth flows: then **High**); **Low** elsewhere.

**False positives:** `LocalRedirect`, `RedirectToAction`, `RedirectToPage`, `Url.IsLocalUrl` checks; redirects to URLs chosen from a server-side allow-list or a stored, admin-configured value.

## Verification

```csharp
[Fact]
public async Task Login_does_not_redirect_offsite()
{
    var client = _factory.CreateClient(new() { AllowAutoRedirect = false });
    var res = await PostLoginAsync(client, "alice", "correct-password", returnUrl: "//other.example.net/");
    Assert.False(res.Headers.Location?.IsAbsoluteUri == true && res.Headers.Location.Host == "other.example.net");
}
```
For SSRF, unit-test the IP policy with `127.0.0.1`, `169.254.169.254`, `[::1]`, `10.0.0.1`, `::ffff:127.0.0.1`, and an integration test against a local test listener rather than real internal services.

References: https://learn.microsoft.com/aspnet/core/security/preventing-open-redirects, https://learn.microsoft.com/dotnet/api/system.net.http.httpclienthandler.allowautoredirect, https://learn.microsoft.com/dotnet/api/system.net.http.socketshttphandler.connectcallback; OWASP SSRF Prevention and Unvalidated Redirects cheat sheets; CWE-918, CWE-601.
