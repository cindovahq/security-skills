# Spring Boot — CSRF and CORS

## Contents
- How Spring Security CSRF protection works
- What to investigate (CSRF)
- How CORS works in Spring
- What to investigate (CORS)
- Severity, false positives, verification

## How Spring Security CSRF protection works

CSRF protection is **on by default** in every `SecurityFilterChain`. `CsrfFilter` requires a valid token for all methods except `GET`, `HEAD`, `TRACE` and `OPTIONS`. Defaults since Security 6.0: token stored in the session (`HttpSessionCsrfTokenRepository`), BREACH-masked by `XorCsrfTokenRequestAttributeHandler`, loaded lazily (deferred tokens), exposed as the `_csrf` request attribute. Thymeleaf forms using `th:action` with `method="post"` get the hidden `_csrf` field automatically through Spring Security's `RequestDataValueProcessor`; JSP `<form:form>` does the same.

Moving parts: `csrf(c -> c.disable())`, `ignoringRequestMatchers(...)`, `csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())` (cookie `XSRF-TOKEN`, header `X-XSRF-TOKEN`), `csrfTokenRequestHandler(...)`, and `csrf(c -> c.spa())` (Security 7.0+: cookie repository, unmasked token readable by JavaScript, masked token accepted from forms; the cookie is cleared on login and logout, so the SPA must request a fresh token afterwards). Security 6.x SPAs need the custom `SpaCsrfTokenRequestHandler` shown in the 6.5 reference docs.

## What to investigate (CSRF)

1. **`csrf.disable()` on a chain that authenticates with cookies.** Read the whole chain: `formLogin`, `oauth2Login`, `rememberMe`, `httpBasic` (browsers resend cached Basic credentials), session-based custom login, or any chain whose `SessionCreationPolicy` is not `STATELESS` and whose clients are browsers. Disabled CSRF there makes every state-changing endpoint forgeable. Spring's guidance: disable only for services not used by browsers.
2. **No `securityMatcher` on the chain that disables CSRF.** A "stateless API" chain without `securityMatcher("/api/**")` also covers the web UI.
3. **`ignoringRequestMatchers`** lists: webhooks are fine with signature checks (`api-security.md`); `/account/**`, `/api/**` on a cookie-authenticated SPA, or `/**` are findings.
4. **State-changing `GET`** (`@GetMapping` or `@RequestMapping` without `method` that deletes, approves, changes email). `@RequestMapping` with no method accepts every verb, including `GET`, so the CSRF filter never checks it.
5. **Token handling mistakes**: token returned to cross-origin callers with a permissive CORS config; `CookieCsrfTokenRepository` with a parent `cookieDomain` shared with untrusted subdomains; CSRF token in URLs for multipart (leaks in logs and `Referer`; send it as a header instead).
6. **Login CSRF and logout**: custom login endpoints excluded from CSRF (Low unless the app links data to the identity); logout reachable by `GET` (Low).

## How CORS works in Spring

CORS is applied by Spring MVC (`@CrossOrigin`, `WebMvcConfigurer.addCorsMappings`) and, when `http.cors(...)` is enabled, by Spring Security's `CorsFilter` using a `CorsConfigurationSource` bean, so preflights are answered before authentication. Actuator has its own `management.endpoints.web.cors.*` properties (off unless `allowed-origins` is set).

Framework behavior to rely on:
- `allowedOrigins("*")` with `allowCredentials(true)` is rejected: `CorsConfiguration.validateAllowCredentials()` throws `IllegalArgumentException` (since 5.3). This is a broken config, not a vulnerability.
- `allowedOriginPatterns("*")` **with** `allowCredentials(true)` is accepted and echoes **any** requesting origin in `Access-Control-Allow-Origin` with `Access-Control-Allow-Credentials: true`. Any website can then read authenticated responses **if the browser sends the session cookie cross-site**: `SameSite=None`, or an attacker on a same-site origin (sibling subdomain). Boot sets no `SameSite` by default; Chromium treats that as Lax, and Safari/Firefox block or partition third-party cookies.
- `@CrossOrigin` with no attributes allows all origins without credentials.

## What to investigate (CORS)

```text
allowedOriginPatterns("*")  setAllowedOriginPatterns(List.of("*"))  allowCredentials(true)  setAllowCredentials(true)
@CrossOrigin(origins = "*", allowCredentials = "true")  addAllowedOriginPattern("*")  allowed-origin-patterns=*
origin.endsWith("example.com")  request.getHeader("Origin") echoed into Access-Control-Allow-Origin
```

- Credentials plus a wildcard pattern, a reflected `Origin` header, or suffix checks (`endsWith("example.com")` accepts `evil-example.com`). Patterns like `https://*.example.com` are only as safe as every subdomain.
- `null` origin allowed (sandboxed iframes and `file:` send `Origin: null`).
- Which endpoints are reachable with credentials: JSON with personal data, API keys, CSRF tokens.
- CORS used as if it were CSRF protection: CORS controls who can **read** responses; simple form posts are still sent cross-site. A cookie-authenticated API with CSRF disabled is forgeable regardless of CORS.

Fix: list exact origins, and enable credentials only for them:

```java
@Bean
CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration c = new CorsConfiguration();
    c.setAllowedOrigins(List.of("https://app.example.com"));
    c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    c.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN"));
    c.setAllowCredentials(true);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", c);
    return source;
}
```

## Severity, false positives, verification

- CSRF disabled on a cookie-authenticated chain with sensitive actions (email/password change, payments, role changes): **High**; low-impact actions: **Medium/Low**.
- `allowedOriginPatterns("*")` or reflected origin **with credentials** on endpoints returning personal data or tokens: **High** when the auth cookie is `SameSite=None` (or a same-site attacker origin is realistic), otherwise **Medium**; non-sensitive data: **Medium/Low**.

False positives: CSRF disabled on a `securityMatcher` chain that only uses bearer tokens (`oauth2ResourceServer`, API keys in headers) and is `STATELESS`; ignored webhook paths that verify a signature; `allowedOrigins("*")` **without** credentials on public, unauthenticated data; `allowedOrigins("*")` with credentials (throws, fails closed); missing CSRF on `GET`-only endpoints.

Verify:

```java
@Test void profileUpdateRequiresCsrf() throws Exception {
    mvc.perform(post("/account/profile").with(user("alice")).param("displayName", "x"))
       .andExpect(status().isForbidden());
    mvc.perform(post("/account/profile").with(user("alice")).with(csrf()).param("displayName", "x"))
       .andExpect(status().is3xxRedirection());
}
@Test void corsDoesNotReflectArbitraryOrigin() throws Exception {
    mvc.perform(get("/account/profile.json").with(user("alice")).header("Origin", "https://attacker.invalid"))
       .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
}
```

References: OWASP CSRF Prevention cheat sheet; CWE-352, CWE-942; https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html, https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html, https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html.
