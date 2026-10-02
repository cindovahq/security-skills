# Spring Boot — Templates, XSS and Server-Side Template Injection

## Contents
- Thymeleaf escaping model
- XSS sinks
- Server-side template injection (SSTI) through view names and fragments
- Other template engines
- Security headers and CSP
- Severity, false positives, verification

## Thymeleaf escaping model

| Construct | Escaped? |
|---|---|
| `th:text="${x}"`, `[[${x}]]` | Yes (HTML) |
| `th:utext="${x}"`, `[(${x})]` | **No** |
| `th:inline="javascript"` with `[[${x}]]` | Yes, JavaScript-escaped (JSON-like serialization) |
| `th:attr`, `th:value`, `th:title` | Yes (attribute) |
| `th:href="${url}"`, `th:src="${url}"` (plain variable) | Escaped, but **scheme is not checked**: `javascript:` and `data:` URLs survive |
| `th:href="@{${url}}"` (link expression) | Rejects a base starting with `javascript:` (throws), but passes `data:`, `vbscript:` and any external URL: validate the scheme and host |
| `th:on*` event handlers | Restricted mode: only numeric/boolean variable values allowed |

`spring-boot-starter-thymeleaf` 3.x/4.x ships Thymeleaf 3.1 (`thymeleaf-spring6`). Templates live in `src/main/resources/templates/`.

## XSS sinks

1. `th:utext` / `[(...)]` with user-controlled or user-stored data (comments, ticket bodies, profile bios, rich text). Stored XSS rendered to staff or admins is higher impact.
2. User URLs in `th:href`/`th:src` without scheme validation (allow `https:`/`http:`/relative only).
3. **`@ResponseBody`/`@RestController` returning a `String` that contains user input.** `StringHttpMessageConverter` supports all media types, so with a browser's `Accept: text/html,...` the response is served as `text/html`. `return "<p>Hello " + name + "</p>"` is reflected XSS. Fix: return JSON/DTOs, or `produces = MediaType.TEXT_PLAIN_VALUE` and HTML-escape (`HtmlUtils.htmlEscape`).
4. `response.getWriter().write(...)`/`ResponseEntity.ok().contentType(TEXT_HTML).body(userHtml)`.
5. **JSP**: `${param.q}` or `${user.bio}` in template text is not escaped; use `<c:out value="${...}"/>` or `${fn:escapeXml(...)}`. Spring form tags escape according to `htmlEscape`/`defaultHtmlEscape`. Advisories: CVE-2026-41846 (XSS via JSP form tags) and CVE-2026-41845 (`JavaScriptUtils`), both fixed in Framework 6.2.19 / 7.0.8. JSPs do not work from an executable Boot jar, so JSP apps are WAR-deployed.
6. JavaScript contexts built by string concatenation in templates (`<script>var cfg = '[(${json})]';</script>`); use `th:inline="javascript"` with `[[${obj}]]`.
7. Sanitizing rich text: OWASP Java HTML Sanitizer or jsoup `Safelist`. Blacklist regexes are findings.

## Server-side template injection (SSTI) through view names and fragments

A controller's `String` return value is a **view name**, not text. With Thymeleaf, view names may contain fragment selectors and expressions (`template :: fragment`, `~{...}`, `__${...}__` preprocessing), and Spring MVC handles `redirect:` and `forward:` prefixes.

Sinks:

```java
@GetMapping("/dashboard")
String dashboard(@AuthenticationPrincipal User u) { return "dashboard/" + u.getLayout(); }      // stored, second-order
@GetMapping("/doc")
String doc(@RequestParam String section) { return "docs/" + section; }                         // reflected
@GetMapping("/page/{name}") void page(@PathVariable String name) { }                            // void: view name derived from the URL
```

Also: `templateEngine.process(userSuppliedTemplateText, ctx)` with a `StringTemplateResolver`, user data inside `__${...}__` preprocessing in templates, and `th:insert`/`th:replace="~{${userValue}}"`.

Thymeleaf mitigations to account for (and their limits):
- View names are parsed as expressions only when they contain `::` (fragment syntax). Since 3.0.12, `checkViewNameNotInRequest` rejects such names when an expression in them also appears in the request **path or a parameter value** (3.1.3 and earlier); 3.1.4+ also check **cookie and header** values. Request bodies, the database (second-order) and other services are never covered.
- **Restricted expression evaluation mode** (since 3.0.x) applies to preprocessing, `th:utext`, fragment and template names, URL bases and more. Through 3.1.3 it only forbids `new`, `T(...)` and `param` access (bean references such as `@environment` still work); 3.1.4+ add a restricted evaluation context with no bean, constructor, method or type resolution. Thymeleaf's own documentation calls it defense-in-depth, "not a substitute for proper input validation".
- The sandbox was bypassed repeatedly: CVE-2026-40477 and CVE-2026-40478 (fixed 3.1.4.RELEASE), CVE-2026-41901 (fixed 3.1.5.RELEASE), earlier CVE-2021-43466 (`thymeleaf-spring5` 3.0.12). Boot 3.5.14+, 4.0.6+ and 4.1.x manage 3.1.5; Boot 3.5.0–3.5.13 and 4.0.0–4.0.5 manage 3.1.3 (check `mvn dependency:tree` for overrides).

Fix: map user choices to a fixed set of view names (`Map.of("compact", "dashboard/compact", "wide", "dashboard/wide").getOrDefault(key, "dashboard/default")`), validate stored preferences with an allow-list at write time **and** read time, use `@ResponseBody`/`ResponseEntity` for data, never return `void` from handlers whose path contains user-controlled segments, and upgrade Thymeleaf.

Open redirects through view names (`"redirect:" + param`) are covered in `ssrf-redirects.md`. CVE-2026-41844: a `/**` mapping without an explicit view name allowed `redirect:`/`forward:` view names from the URL (fixed 6.2.19 / 7.0.8).

## Other template engines

- **FreeMarker**: user-supplied templates allow `?new()` and `?api` unless `new_builtin_class_resolver` is restricted (`TemplateClassResolver.ALLOWS_NOTHING_RESOLVER`) and `api_builtin_enabled` stays false. Auto-escaping depends on output format (`.ftlh` files escape HTML).
- **Mustache/Groovy templates/Velocity**: check raw-output syntax (`{{{x}}}` in Mustache) and any engine that compiles user-provided templates.
- Script templates (`ScriptTemplateView`): CVE-2026-22737 path issue (fixed 6.2.17 / 7.0.6).

## Security headers and CSP

Spring Security writes by default: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` (plus `Pragma`/`Expires`), `Strict-Transport-Security` on HTTPS requests, `X-XSS-Protection: 0`. It does **not** set a Content-Security-Policy; add one with `headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives("default-src 'self'")))`. Watch `headers(h -> h.disable())`, `frameOptions(f -> f.disable())` site-wide (often added for the H2 console), and paths under `web.ignoring()` (no headers). CVE-2026-22732: configured headers may not be written in some conditions (Security fixed 6.5.9 / 7.0.4).

## Severity, false positives, verification

- SSTI reachable by any user: **Critical** when the Thymeleaf version has a known sandbox bypass, **High** on 3.1.5+ (restricted evaluation still reads model data and picks arbitrary templates; future bypasses likely). Admin-only template editing: **High**.
- Stored XSS: **High** (any user to staff/admin), **Medium** (self or low-privilege viewers); reflected XSS: **Medium**; DOM/self XSS: **Low**.
- Missing CSP: **Hardening**.

False positives: `th:text`, `[[...]]`, `th:inline="javascript"` with `[[...]]`; `th:utext` on constants, message bundles or server-generated HTML from sanitized input; view names chosen from a fixed map; `@RestController` returning DTOs (JSON); `redirect:` with constant paths.

Verify:

```java
@Test @WithMockUser
void ticketBodyIsEscaped() throws Exception {
    Long id = tickets.save(new SupportTicket("subj", "<b id=x>hi</b>", "alice")).getId();
    mvc.perform(get("/support/tickets/{id}", id))
       .andExpect(content().string(not(containsString("<b id=x>"))))
       .andExpect(content().string(containsString("&lt;b id=x&gt;")));
}
@Test void stringEndpointIsNotHtml() throws Exception {
    mvc.perform(get("/greet").param("name", "<i>x</i>").accept(MediaType.TEXT_HTML))
       .andExpect(header().string("Content-Type", not(containsString("text/html"))));
}
```

References: OWASP XSS Prevention cheat sheet; OWASP Top 10:2025 A05; CWE-79, CWE-1336; https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html (restricted expression evaluation mode), https://github.com/thymeleaf/thymeleaf/security/advisories, https://docs.spring.io/spring-security/reference/servlet/exploits/headers.html.
