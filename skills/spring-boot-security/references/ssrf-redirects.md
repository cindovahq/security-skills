# Spring Boot — SSRF and Open Redirects

## SSRF: sinks

Any server-side fetch whose URL, host, port or path prefix comes from a user or from user-stored data:

```text
restTemplate.getForObject(userUrl, ...)   restClient.get().uri(userUrl)   webClient.get().uri(userUrl)
@HttpExchange clients with a user-supplied base URL   RestClient.builder().baseUrl(user)
new URL(userUrl).openStream()   HttpClient.send(HttpRequest.newBuilder(URI.create(userUrl)))
resourceLoader.getResource(userValue)   new UrlResource(userValue)   ImageIO.read(new URL(...))
PDF/HTML renderers fetching images (OpenHTMLtoPDF, Flying Saucer), XML parsers resolving entities (deserialization-xxe.md)
webhook "test" buttons, avatar-from-URL, link previews, OIDC discovery or JWKS URLs taken from tenants
```

`ResourceLoader.getResource(...)` accepts `classpath:`, `file:` and URL prefixes, so a user-controlled location is both SSRF and **local file read**.

What makes it worse: responses returned to the caller (full-read SSRF), cloud metadata reachable (`169.254.169.254`, `metadata.google.internal`), internal admin services without auth (Actuator on a management port, Elasticsearch, Redis HTTP proxies), credentials automatically attached by the client (`RestClient` beans with an `Authorization` interceptor reused for user URLs).

Template variables are **not** SSRF: `restClient.get().uri("https://api.rates.example/v1/{ccy}", ccy)` encodes `ccy` as a path segment and keeps the host fixed.

## SSRF: validation that holds

1. Prefer an allow-list of hosts (or a fixed base URL plus template variables).
2. If arbitrary URLs are a feature (webhooks), parse with `java.net.URI`, require `https`, resolve the host and reject loopback, link-local, private, multicast and unique-local addresses for **every** resolved IP, then connect to the validated IP (or use an egress proxy that enforces the policy). Re-validate on each redirect or disable redirects.
3. Do not validate with `UriComponentsBuilder.fromUriString(...).build().getHost()` on outdated Framework versions: host-parsing differences caused CVE-2024-22243, CVE-2024-22259, CVE-2024-22262 and CVE-2026-41854 (fixed 6.2.19 / 7.0.8).
4. Redirects: `SimpleClientHttpRequestFactory` (`HttpURLConnection`) follows redirects for `GET`; the JDK `HttpClient` defaults to `Redirect.NEVER`; Apache HttpClient 5 and Reactor Netty depend on configuration. Boot-built clients (the auto-configured `RestClient.Builder`) **follow redirects by default** (`FOLLOW_WHEN_POSSIBLE`); set `spring.http.client.redirects=dont-follow` (Boot 3.5) / `spring.http.clients.redirects=dont-follow` (Boot 4).
5. Set connect/read timeouts and a response size limit.

```java
static URI requirePublicHttps(String raw) throws Exception {
    URI uri = new URI(raw);                                     // rejects spaces/control characters
    if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null)
        throw new IllegalArgumentException("https URL with a host required");
    for (InetAddress a : InetAddress.getAllByName(uri.getHost())) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
                || a.isSiteLocalAddress() || a.isMulticastAddress()
                || (a instanceof Inet6Address && (a.getAddress()[0] & 0xfe) == 0xfc))   // fc00::/7
            throw new IllegalArgumentException("non-public address");
    }
    return uri;   // still pin the resolved address or route through an egress proxy (DNS rebinding)
}
```

Severity: full-read SSRF to cloud metadata or internal services from any user: **High/Critical**; blind SSRF with fixed path: **Medium**; admin-only configured URLs: **Low/Medium**.

## Open redirects: sinks

```java
return "redirect:" + request.getParameter("returnUrl");          // Spring MVC view-name prefix
response.sendRedirect(next);
new RedirectView(next)   ResponseEntity.status(302).location(URI.create(next))
handler.setTargetUrlParameter("continue")                         // SimpleUrlAuthenticationSuccessHandler: value used as-is
handler.setUseReferer(true)                                        // Referer used as target
```

Spring Security's default `SavedRequestAwareAuthenticationSuccessHandler` redirects to the saved request (same app) or the default target URL, which is safe. `AbstractAuthenticationTargetUrlRequestHandler.setTargetUrlParameter(...)` returns the parameter value without host validation. CVE-2026-41706: `CookieRequestCache` reused an absolute URL from a cookie (fixed 6.5.11 / 7.0.6). CVE-2026-41844: `/**` mappings without a view name let `redirect:` come from the URL (fixed 6.2.19 / 7.0.8).

Fix: redirect only to local paths from an allow-list, or validate the shape strictly:

```java
private static final Pattern LOCAL_PATH = Pattern.compile("^/(?![/\\\\])[A-Za-z0-9/_\\-]*$");

String target = (next != null && LOCAL_PATH.matcher(next).matches()) ? next : "/";
return "redirect:" + target;
```

This rejects `//host`, `/\host`, schemes, dots, encoded characters, whitespace and control characters (browsers strip tabs and newlines, so `/\t/host` becomes `//host`). Widen the character class deliberately if query strings are needed, and test the result.

Severity: **Medium** on login/logout/OAuth flows (phishing, token leakage via `Referer` or fragments), **Low** elsewhere.

## False positives and verification

False positives: `redirect:` with constants or with `UriComponentsBuilder.fromPath("/invoices/{id}").buildAndExpand(id)`; URI template variables with a fixed host; `getResource("classpath:templates/" + FIXED)`; allow-listed hosts compared with `equals` on the parsed host.

```java
@Test void returnUrlMustBeLocal() throws Exception {
    mvc.perform(get("/locale").param("lang", "fr").param("returnUrl", "https://attacker.invalid/").with(user("alice")))
       .andExpect(redirectedUrl("/"));
}
@Test void webhookTestRejectsInternalAddress() {
    assertThrows(IllegalArgumentException.class, () -> requirePublicHttps("https://127.0.0.1/"));
}
```

References: OWASP SSRF Prevention and Unvalidated Redirects cheat sheets; OWASP Top 10:2025 A01 (SSRF merged); CWE-918, CWE-601; https://docs.spring.io/spring-framework/reference/integration/rest-clients.html, https://spring.io/security/cve-2026-41854.
