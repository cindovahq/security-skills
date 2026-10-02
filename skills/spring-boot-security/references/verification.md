# Spring Boot — Verifying Findings and Fixes

## Contents
- Ground rules
- Static inspection commands
- MockMvc + spring-security-test setup (Boot 3 and Boot 4)
- Recipes by finding class
- Running-environment checks
- Regression tests worth keeping

## Ground rules

- Read-only first: inspect code, configuration and the resolved dependency tree. Run the test suite (it uses test databases), not migrations or the app against shared environments.
- Dynamic checks only against environments the user owns or is authorized to test, with test accounts and benign probes (a quote character, `<i>x</i>`, a request to `127.0.0.1` in a unit test). No gadget payloads, no brute force, no real user data.
- MockMvc with `@SpringBootTest` + `@AutoConfigureMockMvc` (or `@WebMvcTest` with the security config imported) runs the real `FilterChainProxy`, so it exercises request rules, CSRF, CORS and method security. `MockMvcBuilders.standaloneSetup(...)` does **not** apply Spring Security; do not use it to prove access control.
- State what was not run: "traced in code, not executed" is **Confirmed (code)**, not "exploited".

## Static inspection commands

```bash
./mvnw -q dependency:tree -Dincludes=org.springframework.boot,org.springframework.security,org.springframework,org.thymeleaf
grep -rnE "permitAll|web\.ignoring|securityMatcher|requestMatchers|anyRequest|csrf\(|cors\(|@Order" src/main/java
grep -rnE "@(Pre|Post)Authorize|@Secured|@RolesAllowed|@EnableMethodSecurity|@EnableGlobalMethodSecurity" src/main/java
grep -rnE "createQuery\(|createNativeQuery\(|jdbcTemplate\.[a-zA-Z]+\(\"[^\"]*\" *\+|JpaSort\.unsafe|parseExpression\(|StandardEvaluationContext|readObject\(|SerializationUtils\.deserialize|activateDefaultTyping|Id\.CLASS|DocumentBuilderFactory|getOriginalFilename|\"redirect:\" *\+|th:utext|\[\(\\\$\{" src
grep -rnE "exposure\.include|show-values|include-stacktrace|h2\.console|password=|secret=|jwt\." src/main/resources
semgrep --config p/java .                     # optional; SpotBugs + Find Security Bugs is an alternative
```

## MockMvc + spring-security-test setup (Boot 3 and Boot 4)

```xml
<dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-test</artifactId><scope>test</scope></dependency>
```

```java
@SpringBootTest
@AutoConfigureMockMvc       // Boot 3: org.springframework.boot.test.autoconfigure.web.servlet
                            // Boot 4: org.springframework.boot.webmvc.test.autoconfigure (spring-boot-webmvc-test)
class SecurityBoundaryTests {
    @Autowired MockMvc mvc;
}
```

Useful pieces (`SecurityMockMvcRequestPostProcessors`, `SecurityMockMvcRequestBuilders`, `SecurityMockMvcResultMatchers`):
- `@WithMockUser(username = "bob", roles = "USER")` (defaults: user `user`, role `USER`), `@WithUserDetails("alice")` (loads from your `UserDetailsService`), `@WithAnonymousUser`.
- `.with(user("alice").roles("ADMIN"))`, `.with(csrf())`, `.with(csrf().useInvalidToken())`, `.with(jwt().jwt(j -> j.subject("alice").claim("roles", List.of("USER"))))`, `.with(jwt().authorities(...))`, `.with(opaqueToken())`, `.with(oauth2Login())`.
- `formLogin().user("alice").password("...")`, `logout()`; matchers `authenticated()`, `unauthenticated()`.
- `jwt()` bypasses the `JwtDecoder` (it injects an already-authenticated token). To test decoder/validator configuration (issuer, audience, signature), call the decoder or validator bean directly or send a real signed token without `jwt()`.

## Recipes by finding class

| Finding | Proof (test) | Reference |
|---|---|---|
| Rule order / matcher gap | Same request as low-privilege user → 403; anonymous → 401/302 | `security-filter-chain.md` |
| `web.ignoring()` on dynamic path | Anonymous `GET` → expect 401/302 after fix (200 before) | `security-filter-chain.md` |
| IDOR | Two users; B requests A's object → 404 | `authorization.md` |
| Method security not active / self-invocation | Call the service as `@WithMockUser(roles = "USER")` → `AccessDeniedException` | `authorization.md` |
| Spring Data REST exposure | `GET /data/users` as a normal user → 403/404 after fix | `authorization.md` |
| Mass assignment | POST extra `role=ADMIN` → field unchanged in DB | `validation-mass-assignment.md` |
| CSRF | POST without `csrf()` → 403 | `csrf-cors.md` |
| CORS | `Origin: https://attacker.invalid` → no `Access-Control-Allow-Origin` | `csrf-cors.md` |
| SQL/JPQL injection | Quote in input → no widened result, no 500 | `injection.md` |
| SpEL injection | Expression input rejected or treated as data | `injection.md` |
| XSS / SSTI | `<i>x</i>` rendered escaped; unknown layout value → default view | `templates-xss.md` |
| JWT validation | Wrong `aud`/`iss` → validator error; unsigned token → 401 | `api-security.md` |
| Deserialization / XXE | Non-JSON cookie rejected; DOCTYPE → exception | `deserialization-xxe.md` |
| SSRF / redirect | Internal address rejected; external `returnUrl` → redirect to `/` | `ssrf-redirects.md` |
| Uploads / traversal | `../` names rejected; files stored under generated names | `file-uploads.md` |
| Actuator / config | `/actuator/env` anonymous → 401; property files reviewed | `actuator-config.md` |
| Dependencies | Audit tool clean, versions in supported lines | `dependencies.md` |

Example covering several at once:

```java
@Test @WithMockUser(username = "bob")
void bobCannotSeeAlicesInvoice() throws Exception {
    mvc.perform(get("/invoices/{id}", aliceInvoiceId)).andExpect(status().isNotFound());
}
@Test void exportsRequireLogin() throws Exception {
    mvc.perform(get("/exports/customers/{id}.csv", 1)).andExpect(status().is3xxRedirection());
}
@Test @WithMockUser(roles = "USER")
void adminPagesRequireAdmin() throws Exception {
    mvc.perform(get("/admin/users")).andExpect(status().isForbidden());
}
```

## Running-environment checks

On an authorized staging instance only:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/actuator/env          # expect 401/403/404
curl -sI https://staging.example.com/ | grep -iE "strict-transport|x-content-type|x-frame|content-security"
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/h2-console             # expect 404
curl -s -H "Origin: https://attacker.invalid" -I https://staging.example.com/account/profile.json | grep -i access-control
```

Never call `/actuator/heapdump` or `shutdown` to "prove" exposure; the endpoint listing at `/actuator` (`_links`) is enough.

## Regression tests worth keeping

One test per boundary you fixed: low-privilege user denied on each admin route and API, other user's object returns 404, CSRF required on state-changing browser routes, anonymous denied on formerly ignored paths, actuator locked down, unsigned/foreign-audience tokens rejected, upload names ignored, template choice limited to the allow-list. Run them in CI with the same security configuration as production (no test-only `permitAll` profiles).

References: https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/index.html, https://docs.spring.io/spring-security/reference/servlet/test/method.html, https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html.
