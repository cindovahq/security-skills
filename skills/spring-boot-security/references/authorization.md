# Spring Boot — Authorization, IDOR, Method Security and Spring Data REST

## Contents
- How authorization is layered in Spring
- Object-level access (IDOR/BOLA)
- Method security and its pitfalls
- Spring Data REST auto-exposed repositories
- Function-level access and multi-tenancy
- Severity, false positives, verification

## How authorization is layered in Spring

1. **Request rules** in `SecurityFilterChain` (`security-filter-chain.md`): coarse URL and role checks.
2. **Method security**: `@PreAuthorize`, `@PostAuthorize`, `@PreFilter`, `@PostFilter`, plus `@Secured` and JSR-250 (`@RolesAllowed`) when enabled, and `@AuthorizeReturnObject` (6.3+). Requires `@EnableMethodSecurity`. The Spring Security docs state that Spring Boot Starter Security does **not** activate method-level authorization by default.
3. **Data scoping** in code: repository queries that include the owner or tenant. Spring has **no** automatic object ownership; every `findById` is global unless the developer scopes it.

## Object-level access (IDOR/BOLA)

```java
// vulnerable: any authenticated user loads any invoice
@GetMapping("/invoices/{id}")
String show(@PathVariable Long id, Model model) {
    model.addAttribute("invoice", invoices.findById(id).orElseThrow());
    return "invoices/show";
}
// scoped: ownership is part of the query; a foreign ID is a 404
Invoice inv = invoices.findByIdAndOwnerUsername(id, auth.getName())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
```

Signals: `findById(`, `getReferenceById(`, `existsById(`, `deleteById(`, `findAllById(`, `save(entity)` where the entity came from the request with an ID, `@PathVariable Long id` passed straight to a repository, JPQL/Criteria without an owner predicate, `@ModelAttribute` or `@RequestBody` entities whose `id`/`owner` came from the client (`validation-mass-assignment.md`). Check every method on the controller, not just `GET`: update, delete, export, PDF, "duplicate" and bulk endpoints are usually the ones missing the check. Also domain class converters: `@PathVariable("id") Invoice invoice` (Spring Data `DomainClassConverter`) loads by ID with no ownership check.

Acceptable patterns: owner/tenant in the query (`findByIdAndOwner...`), `@PostAuthorize("returnObject.owner.username == authentication.name")` on a read-only method (it runs **after** the method, so never on methods with side effects), `@PreAuthorize("@invoiceAccess.canRead(#id, authentication)")` with a bean that queries ownership, Hibernate filters or row-level security applied on every path.

## Method security and its pitfalls

| Pitfall | Why it fails |
|---|---|
| No `@EnableMethodSecurity` (or the legacy `@EnableGlobalMethodSecurity(prePostEnabled = true)`) | Annotations are ignored silently |
| `@Secured` or `@RolesAllowed` with plain `@EnableMethodSecurity` | Defaults: `prePostEnabled = true`, `securedEnabled = false`, `jsr250Enabled = false`. Needs `@EnableMethodSecurity(securedEnabled = true)` / `(jsr250Enabled = true)` |
| Self-invocation | Proxy mode (the default `AdviceMode.PROXY`) only intercepts calls coming through the Spring proxy. `this.refund(id)` from another method of the same bean skips `@PreAuthorize` on `refund` |
| Private, `final` or `static` methods | Not advised by Spring AOP proxies. AspectJ mode (`mode = AdviceMode.ASPECTJ` + `spring-security-aspects`) had CVE-2025-41232 for private methods (6.4.0–6.4.5) |
| Annotations on generic superclasses/interfaces | CVE-2025-41248 (Security 6.4.0–6.4.10, 6.5.0–6.5.4; fixed 6.4.11, 6.5.5) and CVE-2025-41249 (Framework annotation detection, fixed 6.2.11): declare secured methods on the target class or upgrade |
| `@PostAuthorize` on a mutating method | The mutation happens before the check |
| Objects created with `new` | Not Spring beans, no proxy |
| Checking the wrong argument | `@PreAuthorize("#username == authentication.name")` while the method actually loads by a different parameter (`id`) the caller controls |
| `hasPermission(...)` with a custom `PermissionEvaluator` | Spring's default `DenyAllPermissionEvaluator` denies; custom evaluators often return `true` for unknown types or missing objects |

Self-invocation example:

```java
@Service
public class InvoiceService {
    public void refundAll(List<Long> ids) { ids.forEach(this::refund); }   // no check; calls bypass the proxy
    @PreAuthorize("hasRole('FINANCE')")
    public void refund(Long id) { ... }
}
```

Fix: put the annotation on the entry point too, move the guarded method to another bean, or check in the method body (`AuthorizationManager`/explicit role check).

## Spring Data REST auto-exposed repositories

With `spring-boot-starter-data-rest` on the classpath, every **public** repository interface is exported as HTTP resources (`RepositoryDetectionStrategy.DEFAULT`: public interfaces or ones annotated with `@RepositoryRestResource`), with `GET` collection and item, `POST`, `PUT`, `PATCH`, `DELETE`, plus `/search/*` for query methods, under `spring.data.rest.base-path` (default root). Nothing in Spring Data REST checks ownership or roles.

Investigate:
- Is `spring-boot-starter-data-rest` (or `spring-data-rest-webmvc`) a dependency? List repositories, their visibility and `@RepositoryRestResource(exported = false)` / `@RestResource(exported = false)` on repositories and methods. `spring.data.rest.detection-strategy=annotated` limits export to annotated repositories.
- Which security rule covers the base path? `anyRequest().authenticated()` means **any** user can list, edit and delete every row of every exported entity.
- Entities with roles, flags, owner fields or secrets exported writable (`PATCH /users/5 {"role":"ADMIN"}`), and fields serialized unless `@JsonIgnore` (password hashes, tokens).
- Advisories for the installed Spring Data REST version: JSON Patch write filter and SpEL-in-map-key issues (CVE-2026-41728, CVE-2026-41729, fixed 4.5.12 / 5.0.6), identifier/version mutation via JSON Patch (CVE-2026-47849, fixed 5.0.7 / 5.1.1).

Fix: `detection-strategy=annotated` or `exported = false`, method-security annotations on repository methods (`@PreAuthorize` on `findById`, `save`, `delete`), a dedicated controller with DTOs for anything user-facing, and request rules that restrict the base path.

## Function-level access and multi-tenancy

- Admin controllers protected only by `anyRequest().authenticated()`, or by an annotation that is not enabled (see table). Look for `/admin`, `/internal`, `/manage`, `/ops`, impersonation (`SwitchUserFilter` exposed to non-admins), role changes, exports of all records.
- Role checks in templates (`sec:authorize`) or front-end only.
- Multi-tenant apps: tenant ID taken from a header or request parameter instead of the authenticated principal; queries, caches (`@Cacheable` keys), async jobs (`@Async`, `@Scheduled`) and message listeners missing the tenant predicate. The `SecurityContext` is thread-bound; `@Async` executors without `DelegatingSecurityContextExecutor` lose it, so checks there see no user.

## Severity, false positives, verification

- IDOR on personal, financial or confidential records: **High**; cross-tenant in SaaS or credentials: **Critical**; low-sensitivity data or IDs not guessable and not leaked: **Medium** (state the condition).
- Disabled/ignored method security on admin operations reachable by any user: **High/Critical**. Self-invocation bypass of a privileged operation: **High**.
- Spring Data REST exporting user/role entities writable by any authenticated user: **Critical** (privilege escalation); read-only exposure of other users' data: **High**.

False positives: `findById` followed by an explicit ownership check that throws; `@PostAuthorize` on a pure read; repositories that are package-private or `exported = false`; Data REST not on the classpath (a `JpaRepository` alone exposes nothing); `@Secured` with `securedEnabled = true`.

Verify with two users (`verification.md`):

```java
@Test @WithMockUser(username = "bob")
void cannotReadAlicesInvoice() throws Exception {
    mvc.perform(get("/invoices/{id}", aliceInvoiceId)).andExpect(status().isNotFound());
}
@Test @WithMockUser(roles = "USER")
void userCannotRefund() {
    assertThrows(AccessDeniedException.class, () -> invoiceService.refundAll(List.of(1L)));
}
```

References: OWASP Top 10:2025 A01, API1/API5:2023; CWE-639, CWE-862, CWE-863; https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html, https://docs.spring.io/spring-data/rest/reference/, https://docs.spring.io/spring-framework/reference/core/aop/proxying.html.
