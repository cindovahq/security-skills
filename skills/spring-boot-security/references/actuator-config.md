# Spring Boot — Actuator, Secrets and Production Configuration

## Contents
- Finding the configuration that runs in production
- Actuator
- Secrets in configuration
- Error handling and debug features
- H2 console, DevTools, API docs
- Proxies, TLS and cookies
- Logging and crypto helpers
- Severity, false positives, verification

## Finding the configuration that runs in production

Boot merges `application.properties`/`application.yml`, `application-{profile}.*`, `config/` directories, environment variables (`SPRING_DATASOURCE_PASSWORD`), system properties, `spring.config.import` sources (Spring Cloud Config, Vault, Kubernetes ConfigMaps) and command-line args. Find the active profile (`spring.profiles.active` in Dockerfiles, Helm charts, `JAVA_TOOL_OPTIONS`, CI deploy scripts) before rating a property. A dangerous value only in `application-dev.properties` or `src/test/resources` is not a production finding unless that profile ships. If you cannot see the deployment, say so (**Likely**).

## Actuator

Defaults (Boot 3.5 and 4.x):
- Only `health` is exposed over HTTP (`management.endpoints.web.exposure.include` default `[health]`).
- Access model (3.4+): `management.endpoints.access.default`, `management.endpoint.<id>.access` = `none` / `read-only` / `unrestricted`. `shutdown` and, **since Boot 3.5.0**, `heapdump` default to `none`: `exposure.include=*` alone no longer exposes a heap dump on 3.5+ (it does on 3.4 and older).
- `env`, `configprops` and `quartz` values are masked by default (`management.endpoint.env.show-values=never`; options `always`, `when-authorized`).
- With Spring Security and **no** custom `SecurityFilterChain`, Boot secures all actuators except `/health`. With a custom chain, the app's rules decide; use `EndpointRequest.toAnyEndpoint()` / `EndpointRequest.to(...)` to target them.
- `management.server.port` moves endpoints to another port; that is network exposure control, not authentication.

What to look for:

```properties
management.endpoints.web.exposure.include=*            # or a list with env, configprops, heapdump, loggers, mappings, threaddump, sessions, shutdown
management.endpoint.env.show-values=always             # unmasked secrets in /actuator/env
management.endpoint.configprops.show-values=always
management.endpoint.heapdump.access=unrestricted       # memory dump: credentials, session IDs, tokens
management.endpoint.health.show-details=always         # topology and versions (low)
```

plus a security rule like `.requestMatchers("/actuator/**").permitAll()`. Endpoint impact: `env`/`configprops` with values → secrets; `heapdump` → everything in memory; `loggers` (writable) → turn on DEBUG/TRACE logging of request details and credentials; `threaddump`, `mappings`, `beans`, `conditions` → reconnaissance; `sessions` (Spring Session) → list and delete user sessions; `shutdown` → DoS; Spring Cloud `env` POST (`management.endpoint.env.post.enabled=true`) and `refresh` → configuration changes; Spring Cloud Gateway `gateway` endpoint → route changes (CVE-2022-22947 history); Jolokia (when its Spring Boot integration is present) → JMX operations.

Boot advisories in this area: CVE-2026-22731 (health-group additional path auth bypass, fixed 3.5.12 / 4.0.4), CVE-2026-22733 (Cloud Foundry actuator endpoints, fixed 3.5.12 / 4.0.4), CVE-2025-22235 (`EndpointRequest.to()` for unexposed endpoints, fixed 3.4.5 / 3.3.11), CVE-2026-40976 (Boot 4.0.0–4.0.5 default chain with Actuator but without `spring-boot-health`).

Fix: expose only `health,info` (and `prometheus` to the scraper), keep `show-values` at `never` or `when-authorized` with a role, protect the rest with `EndpointRequest.toAnyEndpoint()` → `hasRole("OPS")`, and bind `management.server.port` to an internal interface.

## Secrets in configuration

- Committed secrets: `spring.datasource.password`, `spring.mail.password`, `spring.security.oauth2.client.registration.*.client-secret`, JWT HMAC secrets, API keys, `spring.security.user.password`, keystore passwords, `encrypt.key` (Spring Cloud Config symmetric key) next to `{cipher}` values, Jasypt `ENC(...)` with the password in the same repo.
- `@Value("${jwt.secret:some-default}")` and `@ConfigurationProperties` field initializers: the default is used in production if the variable is missing. Treat a usable default for a signing or encryption key as a committed secret (**Likely**, name the condition) and prefer failing startup.
- Secrets in `Dockerfile` `ENV`, `docker-compose.yml`, Helm `values.yaml`, `.mvn/jvm.config`, test resources reused by prod profiles.
- Spring Cloud Config Server has no authentication by default; check Spring Security on it and its advisories (CVE-2026-22739, CVE-2026-40981, CVE-2026-40982 path traversal and authorization issues, 2026).

Report the location and rotate; redact values in the report (`spring.datasource.password=****`).

## Error handling and debug features

Error attributes (Boot 3.x `server.error.*`, **renamed to `spring.web.error.*` in Boot 4**): `include-stacktrace` (`never` | `always` | `on_param`), `include-message`, `include-binding-errors` (default `never`), `include-exception` (default `false`). `always`/`on_param` leak stack traces, SQL fragments and internal paths: **Low/Medium**. Also `@ExceptionHandler`s returning `e.getMessage()` or `e.toString()`, and `spring.mvc.problemdetails.enabled` handlers that copy exception details.

## H2 console, DevTools, API docs

- **H2 console** (`spring.h2.console.enabled=true`, path `/h2-console`): a database UI that can run SQL. Remote access is off unless `spring.h2.console.settings.web-allow-others=true`; requests from a reverse proxy on the same host can still look local. Typical Spring Security changes for it (`csrf.ignoringRequestMatchers(PathRequest.toH2Console())`, `frameOptions().sameOrigin()`) are harmless in dev. Enabled in a production profile: **High/Critical**. H2 itself had console RCE advisories (CVE-2021-42392, CVE-2022-23221).
- **DevTools**: automatically disabled when run with `java -jar` or a special classloader, and excluded from repackaged jars by default (`<optional>true</optional>` in Maven, `developmentOnly` in Gradle). When active it applies development defaults, including `server.error.include-stacktrace=always`, `include-message=always` and `spring.h2.console.enabled=true`. Findings: `excludeDevtools=false`, `-Dspring.devtools.restart.enabled=true` in production, remote DevTools (`spring.devtools.remote.secret`) enabled.
- **springdoc**: `/v3/api-docs`, `/swagger-ui.html` on by default (`springdoc.api-docs.enabled`, `springdoc.swagger-ui.enabled`). Public docs for a public API are fine; docs for internal/admin APIs are reconnaissance (**Low**).

## Proxies, TLS and cookies

- `server.forward-headers-strategy` (`native`, `framework`, `none`): with `framework`, `ForwardedHeaderFilter` trusts `Forwarded`/`X-Forwarded-*` from any client unless a proxy strips them; affects `request.isSecure()`, generated redirect and reset URLs, and IP-based rate limits. Tomcat's `native` mode trusts only `server.tomcat.remoteip.internal-proxies`.
- HTTPS: HSTS is written only on secure requests; behind a TLS-terminating proxy without forwarded-header support, the app thinks it is on HTTP (no HSTS, cookies without `Secure`).
- `server.servlet.session.cookie.*` (`sessions.md`).

## Logging and crypto helpers

- `logging.level.org.springframework.security=TRACE`/`DEBUG`, `logging.level.org.springframework.web=DEBUG` with `spring.mvc.log-request-details=true`, `logging.level.org.hibernate.orm.jdbc.bind=TRACE` in production log credentials and personal data: **Medium**.
- Log injection (CRLF in logged user input) is mostly handled by structured logging; flag only when logs feed parsers that trust line boundaries.
- `Encryptors.text/standard/stronger/delux` and `AesBytesEncryptor` with the two-argument constructor or a null IV generator: deterministic AES-CBC (CVE-2026-47842; deprecated in 7.0.7 / 7.1.1 in favor of `AesGcmBytesEncryptor`/`AesCbcBytesEncryptor`). `Encryptors.queryableText` is deterministic by design. Keys and salts hard-coded in source.
- `new Random()` for tokens; `SecureRandom` or `KeyGenerators.secureRandom()`/`KeyGenerators.string()` instead.

## Severity, false positives, verification

- Unauthenticated `env`/`configprops` with `show-values=always`, or `heapdump`: **Critical/High** (credential disclosure). `loggers` writable: **Medium/High**. `mappings`/`beans` only: **Low**.
- Committed production secrets: **High** (Critical for signing keys that mint admin tokens); rotate.
- H2 console reachable in production: **High/Critical**.

False positives: `exposure.include=*` on a separate management port bound to localhost or a private network (state the evidence); `heapdump` in the include list on Boot 3.5+ without an `access` override (not reachable); `show-values` masked; secrets in `src/test/resources` or `.env.example` placeholders; DevTools as an optional/`developmentOnly` dependency.

Verify:

```java
@Test void actuatorEnvRequiresOpsRole() throws Exception {
    mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    mvc.perform(get("/actuator/env").with(user("u").roles("USER"))).andExpect(status().isForbidden());
}
```

```bash
curl -s https://staging.example.com/actuator | jq '._links | keys'   # list exposed endpoints on an authorized test instance
```

References: OWASP Top 10:2025 A02 Security Misconfiguration; CWE-200, CWE-215, CWE-489, CWE-798; https://docs.spring.io/spring-boot/reference/actuator/endpoints.html, https://docs.spring.io/spring-boot/appendix/application-properties/index.html, https://docs.spring.io/spring-boot/reference/using/devtools.html, https://spring.io/security/cve-2026-47842.
