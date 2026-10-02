# Spring Boot — SecurityFilterChain, Request Matching and Boot Defaults

## Contents
- How request security works
- Version differences (Boot 3 / Security 6 vs Boot 4 / Security 7)
- What Boot does when you configure nothing
- What to investigate
- Path matching pitfalls
- Fix pattern
- Severity, false positives, verification

## How request security works

Spring Security installs one `FilterChainProxy` that holds an ordered list of `SecurityFilterChain` beans. For each request, the **first chain whose `securityMatcher` matches** handles it; later chains never see it. Inside a chain, `authorizeHttpRequests` rules are evaluated **in declaration order and the first matching rule wins** (Spring Security reference: "applying only the first match"). Requests that match no rule are **denied** (`RequestMatcherDelegatingAuthorizationManager` returns `DENY`). A chain that never calls `authorizeHttpRequests`, or uses the legacy `authorizeRequests`, enforces nothing.

Key building blocks:
- `@Bean SecurityFilterChain filterChain(HttpSecurity http)` (the only style since Security 6.0; `WebSecurityConfigurerAdapter` was removed in 6.0).
- `http.securityMatcher(...)` scopes a chain. A chain without one matches every request. Give multi-chain configs `@Order`, most specific first.
- `authorizeHttpRequests(a -> a.requestMatchers(...).hasRole(...) ... .anyRequest()...)`.
- `WebSecurityCustomizer` with `web.ignoring()` removes paths from Spring Security **entirely**: no authentication, no authorization, no security headers, no CSRF.
- `AuthorizationFilter` runs on every dispatch (`REQUEST`, `FORWARD`, `ERROR`, `INCLUDE`), so error pages and forwarded views need rules too (`dispatcherTypeMatchers(DispatcherType.FORWARD, DispatcherType.ERROR).permitAll()` is the documented pattern).
- `StrictHttpFirewall` (default) rejects URLs with semicolons, encoded slashes, encoded double slashes, backslashes, null, CR/LF and `%25`, which removes many classic matcher bypasses.

## Version differences (Boot 3 / Security 6 vs Boot 4 / Security 7)

| Topic | Boot 3.5 / Security 6.5 | Boot 4.0–4.1 / Security 7.0–7.1 |
|---|---|---|
| Request authorization DSL | `authorizeHttpRequests`; `authorizeRequests` deprecated (since 6.1) | `authorizeRequests` removed |
| `and()` / non-lambda DSL | Deprecated (since 6.1) | `and()` removed; lambda DSL only |
| `requestMatchers(String)` | Deferred: MVC matching when the `DispatcherServlet` is the default servlet, Ant otherwise; throws when it can't tell (several mappable servlets or `DispatcherServlet`s); path-pattern matching when a `PathPatternRequestMatcher.Builder` bean exists | `PathPatternRequestMatcher` (`AntPathRequestMatcher`, `MvcRequestMatcher` removed) |
| Opt-in to new matcher early | `@Bean PathPatternRequestMatcherBuilderFactoryBean` (6.5) | default |
| Non-root servlet path (`spring.mvc.servlet.path`) | MVC matcher handles it | Boot 4 auto-configures a `PathPatternRequestMatcher.Builder` with the servlet path, so string patterns omit it (`securityMatchers(String)` ignored it in 7.0.0–7.0.4, CVE-2026-22753). Non-Boot apps use `PathPatternRequestMatcher.withDefaults().basePath("/mvc")` |
| CSRF for SPAs | Custom handler code | `csrf(c -> c.spa())` (since 7.0) |
| Login redirects | Absolute `Location` | Relative by default (`LoginUrlAuthenticationEntryPoint#setFavorRelativeUris`) |
| Access API (`AccessDecisionManager`, voters) | In core | Moved to `spring-security-access` |
| MFA | Not built in | `@EnableMultiFactorAuthentication` (7.0) |

Read the actual version from `pom.xml`/`build.gradle` (`spring-boot-starter-parent` or the BOM) and from `mvn dependency:tree`, not from the code style. Upgraded apps keep old idioms.

## What Boot does when you configure nothing

With `spring-boot-starter-security` and **no** `SecurityFilterChain` bean, Boot's default chain requires authentication for every request and enables form login and HTTP Basic, with an in-memory user whose password is generated and logged at startup unless `spring.security.user.password` is set. As soon as the app defines **any** `SecurityFilterChain`, Boot's default chain and its actuator rules back off; the app owns every rule.

Known Boot-level bypasses to check against the installed patch (`dependencies.md`): CVE-2026-40976 (Boot 4.0.0–4.0.5: default chain has no authorization rule when Actuator is present without `spring-boot-health`, Critical), CVE-2025-22235 (`EndpointRequest.to()` matcher wrong when the endpoint is not exposed).

## What to investigate

1. **Inventory every chain.** List `SecurityFilterChain` beans, their `@Order`, `securityMatcher`, auth mechanisms and rules. Two chains without `securityMatcher`, or a broad chain ordered before a specific one, leaves later chains dead.
2. **Rule order.** A broad rule before a narrow one swallows it:
   ```java
   .requestMatchers("/api/**").authenticated()
   .requestMatchers("/api/admin/**").hasRole("ADMIN")   // never reached
   ```
   Also `permitAll()` on a prefix that later gained sensitive routes (`/public/**`, `/api/v1/auth/**` that now includes `/api/v1/auth/users`).
3. **Missing or permissive default.** With `authorizeHttpRequests`, unmatched paths are denied, so a missing `anyRequest()` is a functional/Hardening note. The exposure cases are a chain with no `authorizeHttpRequests` at all, the legacy `authorizeRequests`, a trailing `anyRequest().permitAll()`, and `web.ignoring()`. Prefer an explicit `anyRequest().authenticated()` or `denyAll()`. Spring Security rejects `requestMatchers` declared after `anyRequest()` at startup.
4. **Matchers that do not cover the routes.** Compare every rule with real mappings (`@RequestMapping` at class + method level, Spring Data REST, Actuator, springdoc, static handlers, `RouterFunction` beans). `requestMatchers("/admin")` protects only `/admin`, not `/admin/users`; `/admin/*` covers one segment only; use `/admin/**`. HTTP-method-specific rules (`requestMatchers(HttpMethod.GET, ...)`) leave `POST`/`PUT`/`DELETE` to later rules.
5. **`web.ignoring()`** on anything other than static assets. Ignored controllers run with no `SecurityContext`: unauthenticated access. Spring's docs recommend `permitAll()` even for static resources because ignored requests get no security headers.
6. **Role vs authority.** `hasRole("ADMIN")` checks `ROLE_ADMIN`; `hasAuthority("ADMIN")` checks the literal string. JWTs map to `SCOPE_*` by default, so `hasRole` on a resource server needs a `JwtAuthenticationConverter` that adds `ROLE_`. A mismatch usually fails closed (403), but a "fix" of `permitAll()` does not.
7. **Custom filters.** `addFilterBefore(...)` filters that set `SecurityContextHolder` from a header, a query parameter or an unsigned cookie are authentication bypasses (`api-security.md`). Filters registered as `@Component` are also added to the servlet filter chain by Boot and run for every request, including ignored paths.
8. **Error and forward dispatches.** Custom `/error` controllers that render request data or internals, and `ERROR` dispatches denied by `anyRequest().denyAll()` (functional, not security).

## Path matching pitfalls

- Spring Framework 6.0 turned trailing-slash matching off by default (deprecated) and 7.0 removed `trailingSlashMatch`, `suffixPatternMatch` and `matchOptionalTrailingSeparator`. With the defaults, `/admin/` does not reach a handler mapped at `/admin`, so classic trailing-slash bypasses need a non-default setup: `setUseTrailingSlashMatch(true)` (6.x), Framework 6.2's `UrlHandlerFilter` rewriting URLs **after** the security chain ran, or explicit `AntPathRequestMatcher`/`RegexRequestMatcher` rules that do not mirror MVC mapping.
- `RegexRequestMatcher` and hand-written `request.getRequestURI().startsWith(...)` checks in filters or interceptors see the raw URI (case, encoded characters, matrix parameters on containers that allow them). Prefer the framework matchers.
- Security 6.x on multiple servlets (H2 console, CXF, a second `DispatcherServlet`): rules must say which servlet they target (CVE-2023-34035 background). Security 7.0.0–7.0.4 with `spring.mvc.servlet.path` and a `PathPatternRequestMatcher.Builder` bean did not include the servlet path in `securityMatchers` (CVE-2026-22753, High, fixed 7.0.5).
- Older advisories show the class of bug: `RegexRequestMatcher` bypass (CVE-2022-22978), `mvcRequestMatcher` pattern mismatch (CVE-2023-20860), WebFlux `**` patterns (CVE-2023-34034), forward/include dispatch bypass (CVE-2022-31692).

## Fix pattern

```java
@Bean @Order(1)
SecurityFilterChain api(HttpSecurity http) throws Exception {
    http.securityMatcher("/api/**")
        .authorizeHttpRequests(a -> a
            .requestMatchers("/api/public/**").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN")   // specific first
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .csrf(c -> c.disable());                                  // bearer-only chain, no cookies
    return http.build();
}

@Bean @Order(2)
SecurityFilterChain web(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(a -> a
            .dispatcherTypeMatchers(DispatcherType.FORWARD, DispatcherType.ERROR).permitAll()
            .requestMatchers("/", "/login", "/css/**", "/js/**").permitAll()
            .requestMatchers("/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated())
        .formLogin(Customizer.withDefaults());
    return http.build();
}
```

Back request rules with method security on sensitive services (`authorization.md`) so one matcher mistake is not a full bypass.

## Severity, false positives, verification

- Rule order or matcher gap exposing admin functions to any authenticated user: **High**; to anonymous users: **Critical**. Exposing read-only low-sensitivity pages: **Medium**.
- `web.ignoring()` on a dynamic endpoint with sensitive data: **High/Critical**. On static assets: **Hardening** (no headers).
- Missing `anyRequest()` under `authorizeHttpRequests`: **Hardening** (unmatched requests are denied). No `authorizeHttpRequests`, legacy `authorizeRequests` without a default, or `anyRequest().permitAll()`: severity of the most sensitive route left open.

False positives: `csrf.disable()` on a chain that only accepts bearer tokens and creates no session; `permitAll()` on login, signup, static assets, health; `/admin` without `/**` when the only admin route is exactly `/admin`; `web.ignoring()` for `/css/**`; `hasRole` vs `hasAuthority` that fails closed.

Verify with MockMvc against the full filter chain (`verification.md`):

```java
@Test void adminApiRequiresAdmin() throws Exception {
    mvc.perform(get("/api/admin/users").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_USER"))))
       .andExpect(status().isForbidden());
}
@Test void unmatchedPathIsNotPublic() throws Exception {
    mvc.perform(get("/internal/anything")).andExpect(status().is4xxClientError());   // 401/403, or 302 to login
}
```

Print the effective chains at startup with `logging.level.org.springframework.security=DEBUG` (lists the filters per chain and logs which chain and rule handled a request) in a local or test run only.

References: OWASP Top 10:2025 A01; CWE-284, CWE-863; https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html, https://docs.spring.io/spring-security/reference/6.5/migration-7/web.html, https://docs.spring.io/spring-security/reference/servlet/configuration/java.html.
