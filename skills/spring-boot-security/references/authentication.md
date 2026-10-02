# Spring Boot — Authentication and Password Storage

## Contents
- How authentication is wired
- Password storage (PasswordEncoder)
- Login flows and brute force
- Remember-me, one-time tokens, passkeys, MFA
- Password reset and account recovery
- Severity, false positives, verification

## How authentication is wired

Built-in mechanisms are configured on `HttpSecurity`: `formLogin`, `httpBasic`, `oauth2Login`, `oauth2ResourceServer` (`api-security.md`), `saml2Login`, `rememberMe`, `oneTimeTokenLogin` (6.4+), `webAuthn` (passkeys, 6.4+), `x509`. They delegate to an `AuthenticationManager` (`ProviderManager`) and providers such as `DaoAuthenticationProvider` (a `UserDetailsService` + `PasswordEncoder`). Boot auto-creates an `InMemoryUserDetailsManager` with a generated password only when the app defines no `UserDetailsService`, `AuthenticationProvider`, `AuthenticationManager` or related beans.

Investigate custom authentication code first; it bypasses most defaults:
- Controllers that call `authenticationManager.authenticate(...)` and then `SecurityContextHolder.getContext().setAuthentication(...)`. Since Security 6 the context is not saved automatically: without `securityContextRepository.saveContext(...)` login silently fails (functional), and the session ID is **not** rotated unless the code calls a `SessionAuthenticationStrategy` or `request.changeSessionId()` (`sessions.md`).
- `OncePerRequestFilter` subclasses that build an `Authentication` from a header, cookie or parameter. Check what proves identity: a verified signature, a server-side lookup, or nothing.
- Custom `AuthenticationProvider.authenticate()` that returns an authenticated token without checking the password, compares passwords with `equals` on plaintext, or returns `null` vs throwing incorrectly (returning `null` lets the next provider try).
- `UserDetails.isEnabled()`, `isAccountNonLocked()` hard-coded to `true` while the entity has a `locked`/`enabled` column.

## Password storage (PasswordEncoder)

Expected: `PasswordEncoderFactories.createDelegatingPasswordEncoder()` (encodes with bcrypt, `{bcrypt}` prefix) or an explicit `BCryptPasswordEncoder`, `Argon2PasswordEncoder`, `SCryptPasswordEncoder` or `Pbkdf2PasswordEncoder` with current defaults. Security 7.0 adds Password4j-based encoders (`Argon2Password4jPasswordEncoder`, `BcryptPassword4jPasswordEncoder` and others).

Findings:
- `NoOpPasswordEncoder`: plaintext storage. Deprecated, test only.
- `MessageDigestPasswordEncoder("MD5" | "SHA-1" | "SHA-256")`, `StandardPasswordEncoder`, `LdapShaPasswordEncoder`, `Md4PasswordEncoder`: all deprecated legacy encoders; single fast digest, cheap to brute force offline.
- `DelegatingPasswordEncoder` constructed with a legacy ID as the **encoding** ID (first constructor argument). Legacy IDs in the map are fine for verifying old hashes if a `UserDetailsPasswordService` upgrades them on login.
- `User.withDefaultPasswordEncoder()` (deprecated, demos only) or `{noop}` passwords in an `InMemoryUserDetailsManager` or `spring.security.user.password` in production config.
- Hand-rolled hashing (`DigestUtils.md5Hex(password)`, `MessageDigest` with a static salt).
- BCrypt and passwords over 72 bytes: CVE-2025-22228 (`matches` returned `true` when the first 72 characters matched) affects `spring-security-crypto` before 6.3.8 / 6.4.4 (and older lines; see `dependencies.md`).

Fix: one `@Bean PasswordEncoder passwordEncoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }`, rehash on login via `UserDetailsPasswordService`, enforce length/breached-password policy at signup and change.

## Login flows and brute force

- Spring Security has **no built-in login throttling or lockout**. Look for a limiter (`AuthenticationFailureBadCredentialsEvent` listener with a counter, Bucket4j or Resilience4j filter, gateway/WAF rules) on form login, `/api/auth/token`-style endpoints, password reset, OTP and MFA verification.
- Username enumeration: `DaoAuthenticationProvider` hides `UsernameNotFoundException` by default (`hideUserNotFoundExceptions`) and runs a dummy password check for unknown users. Custom endpoints that return "user not found" vs "bad password", or skip the encoder for unknown users, reintroduce enumeration. Related advisories: CVE-2025-22234 (timing mitigation broken in 6.3.8 / 6.4.4), CVE-2026-22746 (user attribute enumeration, fixed 6.5.10 / 7.0.5).
- HTTP Basic on browser-facing chains: credentials are cached by the browser and sent automatically (CSRF-relevant, `csrf-cors.md`) and are only acceptable over TLS.
- Default success URL handling and `SavedRequest` redirects are same-site by design; custom `successHandler`s that redirect to a `continue`/`next` parameter are open redirects (`ssrf-redirects.md`). CVE-2026-41706: `CookieRequestCache` stored and reused the absolute URL (fixed 6.5.11 / 7.0.6).
- Logging: `log.info("login {} {}", username, password)`, or logging full request bodies on auth endpoints.

## Remember-me, one-time tokens, passkeys, MFA

- `rememberMe()` uses `TokenBasedRememberMeServices` by default: the cookie carries username, expiry and a signature over username, expiry, the stored password value and the `key` (SHA-256 by default in 6.x). If no `key` is set, a random UUID is used per startup (cookies die on restart; acceptable). A **hard-coded key committed to source** plus read access to password hashes allows forging cookies: **Medium**. Long `tokenValiditySeconds` on sensitive apps: Hardening. Prefer `PersistentTokenBasedRememberMeServices` (server-side series/token, detects theft).
- One-time token login (6.4+): default `InMemoryOneTimeTokenService`; tokens must be delivered out of band (never returned in the HTTP response). CVE-2026-22751: race in `JdbcOneTimeTokenService` (fixed 6.5.10 / 7.0.5).
- WebAuthn: `userVerification = REQUIRED` silently downgraded with distributed session stores before 6.5.12 (enterprise) / 7.0.7 / 7.1.1 (CVE-2026-47841).
- MFA: Security 7.0 adds `@EnableMultiFactorAuthentication` with `FactorGrantedAuthority` factors. On 6.x, MFA is custom; check that the second factor is enforced server-side for every protected route, not only on the page after login, and that partially authenticated sessions cannot call APIs.
- X.509 client certificate auth: impersonation advisories CVE-2026-22747 (7.0.0–7.0.4) and CVE-2026-47838 (6.5.0–6.5.10).

## Password reset and account recovery

Spring has no built-in reset flow. Check custom code for: tokens from `SecureRandom` (not `Random`, `UUID` from user data, or timestamps), stored hashed, single-use, short expiry, invalidated on password change; reset links built from a configured base URL, not `request.getServerName()`/`Host` (host-header poisoning, `actuator-config.md` on `server.forward-headers-strategy`); generic responses that do not reveal whether an account exists; existing sessions and remember-me tokens invalidated after reset.

## Severity, false positives, verification

- Plaintext (`NoOpPasswordEncoder`) or unsalted fast hashes in production: **High** (Medium if the store is small and well isolated, state it). Salted single-iteration digest (`MessageDigestPasswordEncoder`): **Medium/High**.
- Custom filter or provider accepting unverified identity: **Critical**.
- No throttling on login/token endpoints: **Medium** (High when there is no MFA and accounts are valuable); **Low** if a gateway limit is documented.

False positives: legacy IDs in a `DelegatingPasswordEncoder` map with bcrypt as the encoding ID; `NoOpPasswordEncoder` or `{noop}` in `src/test`; Boot's generated password in local runs; `hideUserNotFoundExceptions` left at default.

Verify:

```java
@Test void passwordsAreAdaptiveHashes(@Autowired PasswordEncoder enc) {
    String hash = enc.encode("correct horse battery staple");
    assertThat(hash).startsWith("{bcrypt}");          // or {argon2}, {pbkdf2}
}
@Test void badPasswordRejected() throws Exception {
    mvc.perform(formLogin().user("alice").password("wrong")).andExpect(unauthenticated());
}
```

References: OWASP Authentication and Password Storage cheat sheets; OWASP Top 10:2025 A07; CWE-256, CWE-307, CWE-916; https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html, https://docs.spring.io/spring-security/reference/servlet/authentication/rememberme.html, https://docs.spring.io/spring-security/reference/servlet/authentication/mfa.html.
