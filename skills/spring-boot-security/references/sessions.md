# Spring Boot — Sessions, Session Fixation and Logout

## How sessions work

The servlet container (Tomcat, Jetty) owns the `HttpSession` and its cookie (`JSESSIONID` by default). Spring Security stores the `SecurityContext` in it through `HttpSessionSecurityContextRepository`. Spring Session (`spring-session-data-redis`, `-jdbc`) can replace the container session with a shared store and a `SESSION` cookie.

Defaults worth knowing:
- **Session fixation protection** is on: `changeSessionId` (Servlet 3.1+) is the default strategy, applied by Spring Security's own authentication filters (form login, Basic, OAuth2 login, remember-me, one-time token). Options: `changeSessionId`, `newSession`, `migrateSession`, `none`.
- **`SessionCreationPolicy.IF_REQUIRED`** is the default. `STATELESS` keeps the security context only for the current request (`RequestAttributeSecurityContextRepository`; session management uses a `NullSecurityContextRepository`) and does not save the request in the session.
- Since Security 6, `SessionManagementFilter` is not added by default (`requireExplicitAuthenticationStrategy` defaults to true unless properties like `invalidSessionUrl` or `maximumSessions` require it). A **custom login endpoint** therefore gets no automatic session ID change.
- Boot session cookie properties: `server.servlet.session.cookie.secure`, `.http-only`, `.same-site`, `.name`, `.domain`; `server.servlet.session.timeout` (default `30m`). Tomcat sets `HttpOnly` on the session cookie by default.
- `LogoutFilter` processes only `POST /logout` when CSRF is enabled, invalidates the session and clears the context.

## What to investigate

1. **Custom login controllers** (`@PostMapping("/login")`, `/api/auth/session`) that call `authenticationManager.authenticate()` and save the context. They must rotate the session ID: `request.changeSessionId()` (or call the configured `SessionAuthenticationStrategy`) after successful authentication. Missing rotation: session fixation, **Medium** (needs a way to plant a session ID, for example a subdomain that sets cookies or URL rewriting).
2. **`sessionFixation().none()`** or `sessionFixation(f -> f.none())`: **Medium**.
3. **URL session IDs**: `;jsessionid=` in URLs leaks via logs and `Referer`. Spring Security's `StrictHttpFirewall` rejects semicolons by default; check that `server.servlet.session.tracking-modes` is `cookie` and that the firewall was not relaxed (`setAllowSemicolon(true)`).
4. **Cookie flags**: `secure` not forced on HTTPS-only deployments behind a TLS-terminating proxy (Tomcat only marks the cookie secure when the request is seen as HTTPS; see `server.forward-headers-strategy` in `actuator-config.md`). `same-site=none` without need. `domain` set to a parent domain shared with untrusted subdomains. Mostly **Low/Hardening**.
5. **Logout**: custom logout endpoints on `GET` (CSRF logout, **Low**), logout that clears the client token but not the server session, remember-me cookie not deleted (`deleteCookies`), JWT "logout" that cannot revoke tokens (document it; short expiry or a deny-list).
6. **Stateless APIs that are not stateless**: an API chain declared `STATELESS` but another chain or `formLogin` on the same paths still creates sessions; or an API that authenticates by session cookie but has CSRF disabled (`csrf-cors.md`).
7. **Session lifetime**: very long `server.servlet.session.timeout` for privileged apps, no absolute lifetime, no re-authentication for sensitive actions (password/email change). **Hardening/Low**.
8. **Concurrent sessions**: `maximumSessions(...)` only works with a `SessionRegistry` that sees all nodes (Spring Session's `SpringSessionBackedSessionRegistry` in clusters). Hardening.
9. **Distributed session stores**: Redis/JDBC session stores use Java serialization by default in Spring Session; the store must be private and authenticated (`deserialization-xxe.md`). CVE-2026-47841 (WebAuthn `REQUIRED` user verification lost after session deserialization) shows serialized-session edge cases.
10. **Privilege changes**: after role change or password reset, other sessions keep old authorities until they expire. Consider `SessionRegistry`-based expiry. Hardening.

## Fix patterns

```java
@PostMapping("/api/auth/session")
ResponseEntity<Void> login(@RequestBody LoginRequest body, HttpServletRequest req, HttpServletResponse res) {
    Authentication auth = authenticationManager.authenticate(
        UsernamePasswordAuthenticationToken.unauthenticated(body.username(), body.password()));
    req.changeSessionId();                                   // session fixation protection
    SecurityContext ctx = SecurityContextHolder.createEmptyContext();
    ctx.setAuthentication(auth);
    SecurityContextHolder.setContext(ctx);
    securityContextRepository.saveContext(ctx, req, res);
    return ResponseEntity.noContent().build();
}
```

```properties
server.servlet.session.cookie.secure=true
server.servlet.session.cookie.same-site=lax
server.servlet.session.tracking-modes=cookie
server.servlet.session.timeout=30m
```

## Severity, false positives, verification

False positives: no explicit `sessionFixation()` call with built-in login mechanisms (default `changeSessionId`); `HttpOnly` not set explicitly (Tomcat default true); `STATELESS` APIs without logout; missing `secure` flag on local profiles.

Verify session rotation and logout with MockMvc:

```java
@Test void loginRotatesSessionId() throws Exception {
    MockHttpSession session = new MockHttpSession();
    String before = session.getId();
    mvc.perform(post("/login").session(session).with(csrf())
            .param("username", "alice").param("password", "pw-alice-123456"))
       .andExpect(authenticated());
    assertThat(session.getId()).isNotEqualTo(before);   // MockHttpSession is rotated in place
}
@Test void logoutNeedsCsrfToken() throws Exception {
    mvc.perform(post("/logout").with(user("alice"))).andExpect(status().isForbidden());
}
```

For custom JSON login endpoints, assert the session ID differs before and after the call in the same way. On a running test instance, compare the `Set-Cookie` session ID before and after login.

References: OWASP Session Management cheat sheet; CWE-384, CWE-613, CWE-614; https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html, https://docs.spring.io/spring-boot/appendix/application-properties/index.html (`server.servlet.session.*`).
