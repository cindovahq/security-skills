# Spring Boot — Dependencies, Support Status and Advisories

## Contents
- Support status (as of 2026-10-02)
- Reading the installed versions
- Notable advisories (2025–2026)
- Older advisories that still show up
- Auditing commands
- Severity and verification

## Support status (as of 2026-10-02)

From the spring.io support data (`https://api.spring.io/projects/<project>/generations`, shown on each project's "Support" tab) and GitHub releases. Commercial support (Tanzu Spring / Broadcom) continues after OSS support ends and ships patches that are not published to Maven Central for free.

| Line | Latest OSS patch | OSS support ends | Commercial support ends |
|---|---|---|---|
| Spring Boot 4.1.x | 4.1.1 (2026-08-20) | 2027-07-31 | 2028-07-31 |
| Spring Boot 4.0.x | 4.0.8 (2026-08-20) | 2026-12-31 | 2027-12-31 |
| Spring Boot 3.5.x | 3.5.16 (2026-06-25) | **ended 2026-06-30** | 2032-06-30 |
| Spring Boot 3.4.x | 3.4.13 | ended 2025-12-31 | 2026-12-31 |
| Spring Boot 3.3 and older 3.x | | ended | ended (3.3: 2026-06-30) |
| Spring Boot 2.7.x | 2.7.18 | ended 2023-06-30 | 2029-06-30 |
| Spring Security 7.1 / 7.0 | 7.1.1 / 7.0.7 | 2027-07-31 / 2026-12-31 | 2028-07-31 / 2027-12-31 |
| Spring Security 6.5 | 6.5.11 | ended 2026-06-30 | 2032-06-30 |
| Spring Framework 7.0 | 7.0.9 | 2027-07-31 | 2028-07-31 |
| Spring Framework 6.2 | 6.2.19 | ended 2026-06-30 | 2032-06-30 |

Spring Boot 4.2 and Framework 7.1 are scheduled for November 2026 (milestones are out). Versions managed by the latest patches:

| Boot | Framework | Security | Spring Data | Thymeleaf | Tomcat | Jackson |
|---|---|---|---|---|---|---|
| 4.1.1 | 7.0.9 | 7.1.1 | 2026.0.1 | 3.1.5 | 11.0.24 | 3.1.5 (2.21.5 for the `jackson2` module) |
| 4.0.8 | 7.0.9 | 7.0.7 | 2025.1.7 | 3.1.5 | 11.0.24 | 3.1.5 |
| 3.5.16 | 6.2.19 | 6.5.11 | 2025.0.13 | 3.1.5 | 10.1.55 | 2.21.4 |

Support findings:
- Boot 3.5.x or 3.4.x without a commercial subscription: **Medium** (no further OSS security patches; several 2026 advisories have enterprise-only fixes for 6.5/6.2). Raise to High when a listed advisory is reachable. Recommend Boot 4.0.x (short runway) or 4.1.x.
- Boot 3.3 and older, any 2.x: **Medium/High**, High with reachable advisories (Spring4Shell-era apps).
- Supported line but old patch: severity of the reachable advisories; otherwise **Low**.

## Reading the installed versions

Read `spring-boot-starter-parent` or `spring-boot-dependencies` in `pom.xml` (or the `org.springframework.boot` Gradle plugin), then look for property overrides (`<spring-security.version>`, `<spring-framework.version>`, `<thymeleaf.version>`, `<jackson-bom.version>`, `<tomcat.version>`) and explicit `<version>` pins that bypass the BOM. Maven has no lock file; the resolved tree is the truth:

```bash
./mvnw -q dependency:tree -Dincludes=org.springframework.security,org.springframework,org.thymeleaf
./gradlew dependencyInsight --dependency spring-security-web --configuration runtimeClasspath
```

No build tool available? Say the resolved versions are inferred from the BOM (**Likely**). Also check the JDK (`<java.version>`, Dockerfile base image): Boot 3 and 4 require Java 17+.

## Notable advisories (2025–2026)

Spring publishes advisories at https://spring.io/security (monthly batches; Aug 20 2026 was the latest at the time of writing). Verify reachability: most require a specific feature.

| CVE | Component and condition | Fixed (OSS) |
|---|---|---|
| CVE-2026-47841, CVE-2026-41707 | Security: WebAuthn `REQUIRED` user verification lost with distributed sessions; DPoP proof replay | 7.0.7, 7.1.1 (6.5.12 enterprise) |
| CVE-2026-47842 | Security: `AesBytesEncryptor`/`Encryptors.*` deterministic AES-CBC | 7.0.7, 7.1.1 (deprecations) |
| CVE-2026-47849, CVE-2026-47850 | Data REST: id/version mutation via JSON Patch / PUT | Data REST 5.0.7, 5.1.1 (4.5.x: spring.io lists 4.5.13 as an Enterprise fix; Boot 3.5 line status unclear, upgrade off 3.5) |
| CVE-2026-47834 | Data JPA: `Sort` validation bypass with native queries | Data JPA 4.0.7, 4.1.1 |
| CVE-2026-41728, CVE-2026-41729 | Data REST JSON Patch: write filter bypass; SpEL injection via map keys | Data REST 4.5.12, 5.0.6 |
| CVE-2026-41706 | Security: `CookieRequestCache` open redirect | 6.5.11, 7.0.6 |
| CVE-2026-41838 to CVE-2026-41856 | Framework (June 2026, 6.2/7.0 issues): static-resource disclosure, DoS and traversal with versioned resources, `/**` `redirect:` open redirect, XSS in `JavaScriptUtils` and JSP form tags, multipart smuggling, `UriComponentsBuilder` SSRF, `AntPathMatcher` DoS, SpEL operation-count DoS and cache growth (41850, 41851), SpEL zero-argument method invocation even in restricted/read-only contexts (41852), WebSocket/WebFlux session and multipart issues (41838–41840), JMS Jackson converter class instantiation (41855; new `setTrustedPackages`). 41847/41849 affect 5.3 only. Spring for GraphQL method-security annotation detection (41856) is fixed in 2.0.4/1.4.6 | 6.2.19, 7.0.8 |
| CVE-2026-40976 | Boot 4.0.0–4.0.5: default chain without authorization when Actuator is present without `spring-boot-health` (Critical) | 4.0.6 |
| CVE-2026-40973 | Boot: predictable temp directory without ownership check | 3.5.14, 4.0.6 |
| CVE-2026-40477, CVE-2026-40478, CVE-2026-41901 | Thymeleaf sandbox bypasses (SSTI where user input reaches restricted expressions) | Thymeleaf 3.1.4, 3.1.5 |
| CVE-2026-22753, CVE-2026-22754 | Security 7.0.0–7.0.4: servlet path ignored in `securityMatchers` / XML rules | 7.0.5 |
| CVE-2026-22748, CVE-2026-22746, CVE-2026-22751 | Security: `withIssuerLocation` without issuer validation; user enumeration; one-time-token race | 6.5.10, 7.0.5 |
| CVE-2026-22731, CVE-2026-22733 | Boot Actuator: auth bypass under health-group additional paths; Cloud Foundry endpoints | 3.5.12, 4.0.4 |
| CVE-2026-22732 | Security: configured HTTP headers not written in some conditions | 6.5.9, 7.0.4 |
| CVE-2026-22741, CVE-2026-22745 | Framework static resources: cache poisoning, DoS | 6.2.18, 7.0.7 |
| CVE-2025-41248, CVE-2025-41249 | Method-security annotations on generic supertypes not detected (authorization bypass) | Security 6.4.11, 6.5.5; Framework 6.2.11 |
| CVE-2025-41232 | `@EnableMethodSecurity(mode = ASPECTJ)` misses annotations on private methods | Security 6.4.6 |
| CVE-2025-41242 | MVC static resources path traversal on non-hardened containers | 6.2.10 |
| CVE-2025-22228 | `BCryptPasswordEncoder.matches` and passwords over 72 bytes | Security 6.3.8, 6.4.4 |
| CVE-2025-22235 | Boot `EndpointRequest.to()` matcher for unexposed endpoints | 3.3.11, 3.4.5 |

Spring Cloud: Config Server advisories in 2026 (CVE-2026-22739, CVE-2026-40981, CVE-2026-40982 for path traversal and authorization; CVE-2026-47836, an SVN `basedir` race, fixed in 5.0.5); Gateway actuator issues (CVE-2025-41243 Environment property modification, CVE-2025-41253 environment/system-property exposure). Match the Spring Cloud release train to the Boot line.

## Older advisories that still show up

CVE-2022-22965 Spring4Shell (Framework < 5.3.18 / 5.2.20, JDK 9+, WAR on Tomcat); CVE-2022-22963 Spring Cloud Function routing-expression SpEL; CVE-2022-22947 Spring Cloud Gateway actuator code injection; CVE-2022-22978 `RegexRequestMatcher` bypass; CVE-2023-20873 Actuator on Cloud Foundry; CVE-2023-34034 / CVE-2023-34035 matcher issues; CVE-2024-38821 WebFlux static resource authorization bypass; CVE-2016-1000027 HTTP Invoker deserialization (Framework < 6.0). Third-party: SnakeYAML < 2.0 (CVE-2022-1471), H2 console (CVE-2021-42392, CVE-2022-23221), XStream before 1.4.18 (many RCEs), jjwt 0.11.x semantics (`api-security.md`).

## Auditing commands

```bash
./mvnw org.owasp:dependency-check-maven:check          # OWASP Dependency-Check; configure an NVD API key (nvdApiKey) for usable speed
./gradlew dependencyCheckAnalyze                        # org.owasp.dependencycheck Gradle plugin
snyk test --all-projects                                # if the team uses Snyk
osv-scanner -r .                                        # OSV database; supports pom.xml and Gradle lockfiles
./mvnw versions:display-dependency-updates              # what is behind (not the same as vulnerable)
```

Dependabot/Renovate: `.github/dependabot.yml` with `package-ecosystem: "maven"` or `"gradle"`. No tool or network? Compare the resolved versions with the tables above and https://spring.io/security, and state that no automated audit ran.

## Severity and verification

"Old" is not "vulnerable": report an advisory only when the installed version is in range and the feature is used (WebAuthn, Data REST, versioned static resources, native queries with `Sort`, Thymeleaf with user-influenced expressions). Unsupported line with no reachable advisory: **Medium** (business risk of no patches). After upgrading: rerun the audit, run the security tests (`verification.md`), and check for property renames (Boot 4: `server.error.*` → `spring.web.error.*`, starter `spring-boot-starter-web` → `spring-boot-starter-webmvc`, Jackson 3 packages).

References: OWASP Top 10:2025 A03 Software Supply Chain Failures; CWE-1104, CWE-1395; https://spring.io/security, https://spring.io/projects/spring-boot#support, https://github.com/spring-projects/spring-boot/wiki, https://owasp.org/www-project-dependency-check/.
