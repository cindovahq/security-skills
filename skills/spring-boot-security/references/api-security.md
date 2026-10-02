# Spring Boot — API Security: JWT, OAuth2, Data Exposure, Limits, Webhooks

## Contents
- JWT resource server (Spring Security)
- Hand-rolled JWT handling (jjwt, Nimbus, java-jwt)
- OAuth2 client and login
- Data exposure in responses
- Resource limits and rate limiting
- Webhooks, API docs and GraphQL
- Severity, false positives, verification

## JWT resource server (Spring Security)

`oauth2ResourceServer(o -> o.jwt(...))` validates bearer tokens with a `JwtDecoder`. Boot auto-configures `NimbusJwtDecoder` from properties:

| Property | Effect |
|---|---|
| `spring.security.oauth2.resourceserver.jwt.issuer-uri` | Discovers JWKS and **adds issuer validation** (`JwtValidators.createDefaultWithIssuer`) |
| `...jwt.jwk-set-uri` | Keys from JWKS; issuer validated only if `issuer-uri` is also set |
| `...jwt.public-key-location` | Static RSA key; no issuer validation |
| `...jwt.audiences` | Adds an `aud` validator. **Without it, audience is not checked** |
| `...jwt.jws-algorithms` | Allowed algorithms (default `RS256`) |
| `...jwt.authorities-claim-name`, `...authority-prefix` | Authority mapping (default `scope`/`scp` → `SCOPE_`) |

`JwtValidators.createDefault()` checks `exp`/`nbf` with clock skew, an optional X.509 thumbprint and, since Security 7.0, that `typ` is `JWT` or absent; **no issuer and no audience**.

Investigate:
1. **A custom `@Bean JwtDecoder`** replaces Boot's validators. `NimbusJwtDecoder.withJwkSetUri(...)`, `withPublicKey(...)`, `withSecretKey(...)` builders validate signature and timestamps only unless the code calls `setJwtValidator(...)` with issuer/audience validators. `NimbusJwtDecoder.withIssuerLocation(...)` did not add issuer validation before Security 6.5.10 / 7.0.5 (CVE-2026-22748).
2. **Missing audience** when the issuer is shared (one Keycloak realm, Auth0 tenant or Entra tenant for many apps): tokens minted for another app are accepted. **Medium/High** depending on what other clients can obtain tokens.
3. **HMAC (`withSecretKey`) secrets** hard-coded in `application.properties`/YAML, in `@Value("${jwt.secret:default}")` defaults, short or guessable, or shared with other services. Anyone with the secret mints tokens for any user and role: **Critical** if the secret is in VCS or a default is used in production.
4. **Authorities from untrusted claims**: mapping a client-controllable claim (`roles` in a self-issued token, `groups` from a social IdP) to `ROLE_ADMIN`.
5. **Opaque tokens**: `opaquetoken.introspection-uri` over plain HTTP or with client credentials in VCS.
6. Bearer tokens accepted from query parameters (`BearerTokenResolver` with `setAllowUriQueryParameter(true)`) leak in logs: **Low/Medium**.

Fix:

```java
@Bean
JwtDecoder jwtDecoder(@Value("${app.jwt.issuer}") String issuer) {
    NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(issuer).build();
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
        JwtValidators.createDefaultWithIssuer(issuer),
        new JwtClaimValidator<List<String>>(JwtClaimNames.AUD, aud -> aud != null && aud.contains("portal-api"))));
    return decoder;
}
```

## Hand-rolled JWT handling (jjwt, Nimbus, java-jwt)

Custom filters that parse tokens are the most common Spring authentication bypass. Check:
- **jjwt 0.11.x and older**: `Jwts.parserBuilder().setSigningKey(k).build().parse(token)` (and `parsePlaintextJwt`/`parseClaimsJwt`) accept **unsigned** tokens: `parse()` only verifies a signature when one is present. Use `parseClaimsJws(token)`. jjwt 0.12.0+ rejects unsecured JWTs by default (`Jwts.parser().verifyWith(key).build().parseSignedClaims(token)`); `enableUnsecured()` turns that off and is a finding.
- Decoding without verifying: `JWT.decode(token)` (java-jwt), `SignedJWT.parse(token).getJWTClaimsSet()` without `verify(...)`, Base64-decoding the payload.
- Algorithm taken from the token header, RSA public key used as an HMAC secret, `none` accepted, keys fetched from a `jku`/`x5u` header URL.
- Missing `exp` check, no issuer/audience, `sub` used to look up the user without checking the account is enabled.

## OAuth2 client and login

`oauth2Login()` handles `state` and PKCE for public clients; Spring Authorization Server 7.0 enables PKCE by default. Investigate: `client-secret` values in committed config; `redirect-uri` templates built from the `Host` header behind a proxy without `server.forward-headers-strategy`; custom `OAuth2UserService` that links accounts by unverified email (account takeover, **High**); authorities granted from IdP claims without checking the issuer; `oauth2Login` and `oauth2ResourceServer` sharing one chain with CSRF disabled.

## Data exposure in responses

- **Returning JPA entities** from `@RestController`s: Jackson serializes every getter (password hashes, reset tokens, internal flags, lazy relations). Use response DTOs/records or `@JsonIgnore`/`@JsonView`. With `spring.jpa.open-in-view=true` (Boot default, logs a warning) lazy relations are loaded during serialization, widening exposure.
- **Spring Data REST** exports (`authorization.md`), projections and `/search` methods.
- Error bodies with stack traces or exception messages (`actuator-config.md`).
- `@JsonTypeInfo`/default typing on request DTOs (`deserialization-xxe.md`).

## Resource limits and rate limiting

- `Pageable` binding caps page size at `spring.data.web.pageable.max-page-size` (default 2000); custom `@RequestParam int size` passed to `PageRequest.of(page, size)` has no cap.
- Multipart limits: `spring.servlet.multipart.max-file-size` (1MB) and `max-request-size` (10MB) by default; check overrides to `-1`.
- No built-in rate limiting in Spring Boot or Spring Security; look for Bucket4j, Resilience4j `RateLimiter`, Spring Cloud Gateway `RequestRateLimiter`, or a gateway. Missing limits on login, token, OTP, password reset and expensive search/export endpoints: **Medium** (Low for cheap endpoints).
- Unbounded `@RequestBody List<...>` batch endpoints, regex or SpEL evaluated per request (SpEL has a default 10,000-operation limit since Framework 6.2.19 / 7.0.8).

## Webhooks, API docs and GraphQL

- Webhook controllers excluded from CSRF and auth must verify an HMAC over the **raw** body (`@RequestBody byte[]` or `String`) with `MessageDigest.isEqual`, plus timestamp tolerance. Re-serialized JSON breaks signature checks and leads teams to disable them.
- springdoc (`springdoc-openapi-starter-webmvc-ui`): `/v3/api-docs` and `/swagger-ui.html` are enabled by default (`springdoc.api-docs.enabled`, `springdoc.swagger-ui.enabled`). Public API docs are **Informational/Low** unless they document internal or admin endpoints that are themselves weakly protected.
- Spring for GraphQL: introspection on by default (`spring.graphql.schema.introspection.enabled=true`); authorization must be on data fetchers/services (`@PreAuthorize` on `@QueryMapping` methods or services), query depth/complexity limits via instrumentation.

## Severity, false positives, verification

False positives: Boot-configured `issuer-uri` decoders (issuer is validated); missing `aud` when the IdP issues tokens only for this API (state the condition); `csrf.disable()` on the resource-server chain; DTO responses; Pageable without explicit caps (default max 2000).

Verify with `spring-security-test`:

```java
@Autowired OAuth2TokenValidator<Jwt> portalJwtValidator;        // expose the validator you set on the decoder as a bean

@Test void tokenForOtherAudienceRejected() {
    Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").issuer(ISSUER).audience(List.of("other-app"))
        .subject("alice").issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    assertThat(portalJwtValidator.validate(jwt).hasErrors()).isTrue();
}
@Test void unsignedPartnerTokenRejected() throws Exception {
    String unsigned = Jwts.builder().setSubject("partner-1").compact();   // jjwt 0.11: no signWith() = unsigned JWT
    mvc.perform(get("/api/partner/invoices").header("X-Partner-Token", unsigned))
       .andExpect(status().isUnauthorized());
}
```

References: OWASP API Security Top 10:2023 (API2, API3, API4); OWASP JWT cheat sheet; CWE-287, CWE-345, CWE-347, CWE-770; https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html, https://spring.io/security/cve-2026-22748, https://github.com/jwtk/jjwt.
