---
name: spring-boot-security
description: Security review and secure-coding guidance for Spring Boot 3.x and 4.x applications (Spring Security 6.5 and 7.x, Spring Data, Thymeleaf). Use when auditing, reviewing, pentest-prepping or hardening a Spring Boot or Spring MVC codebase, or when writing or changing SecurityFilterChain configuration, method security, controllers, JPA repositories, Spring Data REST, JWT resource servers, templates, uploads, Actuator or application.properties. Triggers on projects with spring-boot-starter dependencies in pom.xml or build.gradle, @SpringBootApplication classes, or application.properties or application.yml. Covers filter-chain ordering and request matchers, IDOR and method-security pitfalls, authentication and password encoders, JWT and OAuth2, sessions, CSRF and CORS, mass assignment and data binding, JPQL, SQL and SpEL injection, Thymeleaf XSS and SSTI, deserialization and XXE, SSRF, open redirects, uploads and path traversal, Actuator and secrets exposure, dependency advisories, and MockMvc verification.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "Spring Boot 3.5 (OSS support ended 2026-06-30), 4.0, 4.1; Spring Security 6.5, 7.0, 7.1; Spring Framework 6.2, 7.0"
  last-verified: "2026-10-02"
---

# Spring Boot Security

Find, explain, fix and verify security issues in Spring Boot applications (Spring MVC, Spring Security, Spring Data, Thymeleaf), and write new Spring code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: the user asks for an audit, security review, pentest prep, or "is this secure?". Follow the workflow below and produce findings.
- **Build mode**: you are writing or modifying Spring code. Apply the [build-mode guardrails](#build-mode-guardrails) to every change. Load only the reference for the area you are touching.

If the `appsec-review` skill is installed, it owns the overall methodology and report format. This skill supplies the Spring-specific knowledge. If it is not installed, use the [evidence and reporting rules](#evidence-and-reporting-rules) below.

## Review workflow

### 1. Confirm the stack and version

1. Confirm Spring Boot: `spring-boot-starter-parent`/`spring-boot-dependencies` in `pom.xml` or the `org.springframework.boot` plugin in `build.gradle(.kts)`, and an `@SpringBootApplication` class.
2. Read the **resolved** versions (`./mvnw dependency:tree`, `./gradlew dependencyInsight`), including property overrides such as `<spring-security.version>` or `<thymeleaf.version>`. If you cannot run the build, infer from the Boot BOM and say so.
3. Map Boot to its stack: Boot 3.5 → Framework 6.2, Security 6.5, Jackson 2; Boot 4.0 → Framework 7.0, Security 7.0, Jackson 3; Boot 4.1 → Framework 7.0, Security 7.1.
4. Check support status (`references/dependencies.md`): Boot 3.5 OSS support ended 2026-06-30 (commercial until 2032); 4.0 OSS until 2026-12-31; 4.1 until 2027-07-31. Only the latest patch gets fixes.
5. Note version-dependent behavior before judging code: `authorizeRequests`, `and()`, `AntPathRequestMatcher` and `MvcRequestMatcher` removed in Security 7; `requestMatchers(String)` uses `MvcRequestMatcher` on 6.x and `PathPatternRequestMatcher` on 7.x; `csrf.spa()` 7.0+; `heapdump` access `none` by default since Boot 3.5.0; `server.error.*` renamed `spring.web.error.*` in Boot 4; trailing-slash matching off since Framework 6.0 and removed in 7.0.
6. Find the production configuration: active profile (`spring.profiles.active` in Dockerfile, Helm, CI), `application-{profile}.*`, `spring.config.import` sources. A setting only in a dev or test profile is not a production finding.

### 2. Map the attack surface

- Every `SecurityFilterChain` bean (order, `securityMatcher`, auth mechanism, rules), `WebSecurityCustomizer`, custom filters (`addFilterBefore`, `@Component` filters).
- Controllers (`@Controller`, `@RestController`, `RouterFunction` beans), Spring Data REST repositories (public interfaces are exported when `spring-boot-starter-data-rest` is present), Actuator, springdoc, H2 console, static resource locations, GraphQL, WebSocket/STOMP, `@KafkaListener`/`@RabbitListener`/`@JmsListener`, `@Scheduled` and `@Async` jobs.
- Anything taking an ID, URL, file name, sort field, template/view name, expression, XML, serialized object or HTML.

### 3. Review each area

Load the reference for each area as you reach it. Do not load all of them up front.

| Area | Reference | Start by looking for |
|---|---|---|
| Filter chains & matchers | `references/security-filter-chain.md` | Chain order, broad rules before narrow ones, no `authorizeHttpRequests` or `anyRequest().permitAll()`, `/admin` vs `/admin/**`, `web.ignoring()` on dynamic paths |
| Authorization / IDOR / method security / Data REST | `references/authorization.md` | `findById(id)` without owner, `@Secured` without `securedEnabled`, self-invocation, exported repositories |
| Authentication & passwords | `references/authentication.md` | Custom login code and filters, `NoOpPasswordEncoder`/`MessageDigestPasswordEncoder`, no throttling, remember-me keys |
| Sessions | `references/sessions.md` | Custom login without `changeSessionId()`, `sessionFixation().none()`, cookie flags, logout |
| CSRF & CORS | `references/csrf-cors.md` | `csrf.disable()` on cookie chains, `ignoringRequestMatchers`, `allowedOriginPatterns("*")` + credentials |
| API security (JWT, OAuth2, exposure, limits) | `references/api-security.md` | Custom `JwtDecoder` without issuer/audience, HMAC secrets in config, jjwt `parse()`, entities returned as JSON |
| Data binding & mass assignment | `references/validation-mass-assignment.md` | `@ModelAttribute`/`@RequestBody` entities, `@InitBinder`, `BeanUtils.copyProperties`, missing `@Valid` |
| Injection (SQL, JPQL, Sort, LDAP, NoSQL, command, SpEL, EL) | `references/injection.md` | `createQuery("..." +`, `jdbcTemplate` concat, `JpaSort.unsafe`, `parseExpression(user)`, `StandardEvaluationContext` |
| Templates, XSS & SSTI | `references/templates-xss.md` | `th:utext`, `[(...)]`, view names built from input or stored data, `@ResponseBody` HTML strings, CSP |
| Deserialization & XXE | `references/deserialization-xxe.md` | `ObjectInputStream`, `SerializationUtils.deserialize`, `Id.CLASS`, default typing, raw `DocumentBuilderFactory` |
| SSRF & redirects | `references/ssrf-redirects.md` | `RestClient`/`RestTemplate`/`WebClient` with user URLs, `getResource(user)`, `"redirect:" + param` |
| Uploads & files | `references/file-uploads.md` | `getOriginalFilename()` in paths, `cleanPath` as a defense, `file:` static locations, `ClassPathResource(user)` |
| Actuator, secrets & config | `references/actuator-config.md` | `exposure.include=*`, `show-values=always`, committed secrets, `include-stacktrace`, H2 console, DevTools |
| Dependencies | `references/dependencies.md` | Support status, resolved versions, 2025–2026 advisories, audit commands |
| Verification | `references/verification.md` | MockMvc + `spring-security-test` recipes, static greps, safe environment checks |

### 4. Classify and report

Every finding needs evidence: file, line, the code or config, and the path from attacker-controlled input to the sensitive operation, including which `SecurityFilterChain` and rule handle the request. Classify with the rules below.

### 5. Remediate and verify (when asked to fix)

Explain the issue before changing code. Make the smallest change that uses Spring's own mechanism. Verify with `references/verification.md`: the attack no longer works, legitimate use still works, and the same pattern is not repeated on sibling routes, HTTP methods, Data REST, GraphQL or message listeners.

## High-signal patterns

These are **investigation signals, not findings**. Trace each one before reporting.

```text
# Request security
permitAll()  web.ignoring()  securityMatcher(  anyRequest()  requestMatchers("/admin")  @Order(  addFilterBefore(
authorizeRequests(  .and()  hasAuthority("ADMIN") vs hasRole("ADMIN")  csrf(c -> c.disable())  ignoringRequestMatchers(
# Authorization
findById(  getReferenceById(  deleteById(  @PathVariable Long id  @Secured(  @RolesAllowed(  @PreAuthorize on a method called via this.
spring-boot-starter-data-rest  @RepositoryRestResource  exported =
# Authentication / tokens
NoOpPasswordEncoder  MessageDigestPasswordEncoder  StandardPasswordEncoder  withDefaultPasswordEncoder  {noop}
NimbusJwtDecoder.with  withSecretKey(  jwt.secret  Jwts.parser  .parse(token)  JWT.decode(  rememberMe(  key(
# Injection / templates / deserialization
createQuery("  createNativeQuery("  jdbcTemplate.query("...+  JpaSort.unsafe(  parseExpression(  StandardEvaluationContext
return "...". + userValue (view name)  th:utext  [(${  readObject(  SerializationUtils.deserialize(  Id.CLASS  activateDefaultTyping
DocumentBuilderFactory.newInstance()  XMLInputFactory  new Yaml(  XStream
# Files / SSRF / redirects
getOriginalFilename()  Paths.get(base, user)  cleanPath(  ClassPathResource(  getResource(  addResourceLocations("file:
restClient.get().uri(user  restTemplate.getForObject(user  new URL(user)  "redirect:" +  setTargetUrlParameter(
# Config
exposure.include=*  show-values=always  heapdump.access  include-stacktrace=always  h2.console.enabled=true
spring.datasource.password=  client-secret=  allowedOriginPatterns("*")  allowCredentials(true)  forward-headers-strategy
```

## Common false positives

Do not report these without further evidence:

- **`csrf.disable()` on a `securityMatcher` chain that only accepts bearer tokens** (`oauth2ResourceServer`, header API keys) with `SessionCreationPolicy.STATELESS`.
- **No explicit session-fixation config** with Spring Security's built-in login mechanisms: `changeSessionId` is the default.
- **Criteria API, `Specification`s, derived query methods, `@Query` with `:param`/`?1`, `NamedParameterJdbcTemplate`, `JdbcClient` with `.param(...)`**: values are bound.
- **`th:text`, `[[...]]` and `th:inline="javascript"` with `[[...]]`**: escaped.
- **`SimpleEvaluationContext` evaluating developer-defined expressions against user data**, `@Value("#{...}")`, SpEL in `@PreAuthorize`.
- **`allowedOrigins("*")` with `allowCredentials(true)`**: Spring throws, the config fails closed. `allowedOrigins("*")` without credentials on public data is fine.
- **DevTools as `<optional>true</optional>`/`developmentOnly`**: excluded from repackaged jars and disabled under `java -jar`.
- **Dev-only properties** (H2 console, `show-sql`, debug logging) in `application-dev.*` when production runs another profile.
- **`heapdump` in `exposure.include` on Boot 3.5+** without `management.endpoint.heapdump.access` set: access defaults to `none`.
- **Trailing-slash bypass claims** on Framework 6/7 with default path matching and `MvcRequestMatcher`/`PathPatternRequestMatcher` rules.
- **`RestClient`/`RestTemplate` URI templates with a fixed host** (`uri("https://api.example/{id}", id)`): not SSRF.
- **Jackson with concrete DTO types**, SnakeYAML 2.x with default `LoaderOptions`, XML through Spring's message converters.
- **`findById` followed by an explicit ownership check** that throws or returns 404.

## Severity calibration

Common under-ratings to avoid:

- **Request-rule mistakes are access-control failures.** A broad `authenticated()` rule placed before `/api/admin/**`, an exact-path `/admin` matcher, or `@Secured` ignored because `securedEnabled` is false gives every user admin functions: **High/Critical**, not "misconfiguration".
- **`web.ignoring()` on a controller path** is unauthenticated access to that controller: rate by the data it returns.
- **Spring Data REST exporting a user/role entity** under `anyRequest().authenticated()` is privilege escalation for any account (`PATCH role`): **Critical**.
- **Actuator `env`/`configprops` with `show-values=always` reachable without auth** discloses every secret in the environment: **Critical/High**, chain it with what the secrets unlock.
- **A JWT HMAC secret or remember-me key committed to the repo** is token forgery, rated by the highest role a forged token can claim.
- **User-controlled Thymeleaf view names** are SSTI: **Critical** on Thymeleaf below 3.1.5 (known sandbox bypasses), **High** otherwise; second-order (stored) values bypass Thymeleaf's request check.
- **SpEL from users with `StandardEvaluationContext`** is remote code execution: **Critical**, even if "only for admins" (then High).
- **Sorting by user-chosen properties** on entities with secret columns is a data oracle (**High** with plaintext tokens).
- **Outdated Boot patch:** map the Boot version to the Spring Security, Framework, Thymeleaf and Data REST versions its BOM manages, and check them against the advisory table in `references/dependencies.md`. Known advisories in features the app uses are **Medium/High** (raise to match a chained finding, such as Thymeleaf sandbox bypasses with view-name SSTI), not Low "may be stale". End of OSS support alone is Low.

## Build-mode guardrails

When writing Spring code, default to:

1. **Filter chains**: lambda DSL, `authorizeHttpRequests`, one `SecurityFilterChain` per audience with `securityMatcher` and `@Order`, specific rules before general ones, end with `anyRequest().authenticated()` (or `denyAll()`), `permitAll()` instead of `web.ignoring()`.
2. **Method security on services**: `@EnableMethodSecurity`, `@PreAuthorize` on public service methods that are entry points, no reliance on self-invocation, ownership in the query (`findByIdAndOwner...`).
3. **Never bind entities**: request records/DTOs, server-owned fields set from the principal; `@InitBinder` allow-lists or `setDeclarativeBinding(true)` where entities cannot be avoided; `@Valid` on inputs.
4. **Parameterize everything**: `:param` in JPQL and SQL, Criteria API, allow-listed `Sort` properties, no `JpaSort.unsafe` with input, no user-supplied SpEL.
5. **Templates**: `th:text` by default, sanitize rich text with an allow-list sanitizer, fixed view names, DTOs/JSON for data, a CSP header.
6. **Passwords and tokens**: `PasswordEncoderFactories.createDelegatingPasswordEncoder()`, Boot `issuer-uri` + `audiences` for JWT (or explicit validators on custom decoders), secrets from the environment or a vault with no defaults, login throttling.
7. **CSRF and CORS**: keep CSRF on for browser chains (`csrf.spa()` on 7.x for SPAs), exact origins with credentials.
8. **Outbound and files**: fixed hosts with URI templates, validated public HTTPS URLs for user webhooks with redirects off, server-generated file names, `normalize()` + `startsWith(root)`, private storage with authorized downloads.
9. **Serialization and XML**: JSON into concrete types, `Id.NAME` subtypes only, hardened XML factories, no Java serialization of client data.
10. **Production config**: expose only `health,info`, `show-values` never, no H2 console or DevTools, error details `never`, `server.forward-headers-strategy` matching the proxy, secure session cookies.
11. Keep Boot on a supported line and the latest patch; run OWASP Dependency-Check or OSV-Scanner in CI.
12. Add a **MockMvc test for the boundary** you wrote (low-privilege user gets 403/404, CSRF required, anonymous denied, foreign token rejected).

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

**Classification**

- **Confirmed**: the code/config path from attacker input to impact is fully traced, or it was safely demonstrated.
- **Likely**: strong evidence, but one runtime condition (active profile, proxy/gateway, environment variable, gadget availability) could not be verified. State which condition.
- **Hardening**: not demonstrably exploitable, but a stronger control is recommended.
- **Informational**: context with no direct security impact.

**Severity** follows impact x exploitability x required privileges x exposure. Unauthenticated RCE or injection, auth bypass and cross-tenant data access are Critical/High. Issues needing an admin account or an unusual configuration go down.

**Finding format**

```markdown
### [SEVERITY] Title — Confirmed|Likely|Hardening
- **Location:** `src/main/java/com/acme/web/InvoiceController.java:42` (`show`)
- **Evidence:** the exact code/config, the chain and rule that handle the request, and how input reaches the sink
- **Impact:** what an attacker gains, and who the attacker must be
- **Preconditions:** auth level, profile, deployment assumptions
- **Fix:** smallest Spring-native change (code snippet)
- **Verify:** MockMvc test or safe request that proves the fix
- **Refs:** CWE / OWASP / Spring docs link
```

**Rules:** never invent files, endpoints, properties or CVEs. Redact secrets (`spring.datasource.password=****`). Say explicitly when runtime verification was not performed. Only test applications the user is authorized to assess, and use non-destructive checks.

## References

- Spring Security reference: https://docs.spring.io/spring-security/reference/ (migration to 7: https://docs.spring.io/spring-security/reference/6.5/migration-7/index.html)
- Spring Boot reference and properties: https://docs.spring.io/spring-boot/reference/, https://docs.spring.io/spring-boot/appendix/application-properties/index.html
- Spring Framework reference: https://docs.spring.io/spring-framework/reference/
- Spring security advisories: https://spring.io/security; support dates: https://spring.io/projects/spring-boot#support
- Thymeleaf 3.1 tutorial (restricted mode): https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- OWASP Cheat Sheet Series and ASVS 5.0: https://cheatsheetseries.owasp.org/, https://owasp.org/www-project-application-security-verification-standard/
