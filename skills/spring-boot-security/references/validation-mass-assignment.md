# Spring Boot — Data Binding, Mass Assignment and Validation

## How binding works

- **`@ModelAttribute`** (and any non-simple controller parameter without an annotation) uses `WebDataBinder`: request parameters, multipart parts, path variables and, since Framework 6.2, request headers are bound by name onto the object, through the constructor and then setters, **including nested paths** (`owner.role=ADMIN`, `account.balance=0`).
- **`@RequestBody`** uses an `HttpMessageConverter` (Jackson for JSON): every property with a setter or a visible field in the JSON is set, again including nested objects.
- Spring Framework's own guidance (Model Design, MVC data binding docs): prefer immutable objects (records, constructor binding) or dedicated input objects; **JPA/Hibernate entities are generally not safe for web binding**; if you must bind them, declare `allowedFields`. `setDisallowedFields` is called fragile and is due to be deprecated in 7.1. `setDeclarativeBinding(true)` (6.1+) applies constructor binding always and setter binding only when `allowedFields` is set.

## What to investigate

1. **Entities bound directly**: `@ModelAttribute User user`, `@RequestBody Customer customer`, `public String save(Invoice invoice)` followed by `repository.save(...)`. Look at the entity for `role`, `roles`, `enabled`, `admin`, `verified`, `owner`, `tenantId`, `balance`, `price`, `status`, `id`, `version`, `passwordHash`, `createdBy`. Any of these bindable = mass assignment.
2. **ID smuggling**: an entity with a client-supplied `id` passed to `save()` updates **another** row (`save` merges by ID). Combined with no ownership check, this is IDOR on write (`authorization.md`).
3. **`@InitBinder` coverage**: `@InitBinder` without a value applies to all model attributes in that controller (or globally in a `@ControllerAdvice`); `@InitBinder("ticket")` only to the attribute named `ticket`. Check that the allow-list matches the form and contains no privileged fields. Disallow-lists miss new fields and nested paths.
4. **Jackson specifics**: entity without `@JsonIgnoreProperties`/`@JsonProperty(access = READ_ONLY)` for privileged fields; `@JsonAnySetter` storing arbitrary keys; `@JsonIdentityReference`/nested objects that let clients point at other aggregates; `FAIL_ON_UNKNOWN_PROPERTIES` disabled (Spring's `Jackson2ObjectMapperBuilder`, used by Boot 3, disables it; not a vulnerability on its own).
5. **Copying helpers**: `BeanUtils.copyProperties(request, entity)`, MapStruct/ModelMapper mappings with implicit matching from a DTO that mirrors the entity. Same problem, different API.
6. **Spring Data REST** `PUT`/`PATCH` on exported entities (`authorization.md`), including JSON Patch advisories CVE-2026-41728/41729/47849.
7. **Validation**: `@Valid`/`@Validated` missing on `@RequestBody` (Bean Validation annotations on the DTO are then ignored), validation groups that skip on update, `@Validated` on the class missing for `@RequestParam`/`@PathVariable` constraints in older Boot versions, length limits absent on fields stored or rendered. Validation is input hygiene; it does not stop mass assignment.
8. **Class-loader binding (Spring4Shell, CVE-2022-22965)**: data binding reached `class.module.classLoader` on JDK 9+ with Tomcat WAR deployment, Spring Framework 5.3.0–5.3.17 and 5.2.0–5.2.19 (fixed 5.3.18 / 5.2.20; Boot 2.6.6 / 2.5.12). Only relevant for Boot 2.x / Framework 5.x apps, which are out of OSS support anyway. CVE-2024-38820 (fixed 6.1.14) and its follow-up CVE-2025-22233 (fixed 6.2.7 / 6.1.20): `DataBinder` disallowed-field matching could be bypassed through locale-dependent case conversion. Another reason to prefer allow-lists.

## Fix patterns

```java
// dedicated input type (record = constructor binding, nothing else bindable)
public record ProfileForm(@NotBlank @Size(max = 80) String displayName, @Email String email) {}

@PostMapping("/account/profile")
String update(@Valid ProfileForm form, BindingResult errors, Authentication auth) {
    User u = users.findByUsername(auth.getName()).orElseThrow();
    u.setDisplayName(form.displayName());
    u.setEmail(form.email());
    users.save(u);
    return "redirect:/account";
}
```

```java
// if an entity must be bound: allow-list in this controller (or app-wide declarative binding)
@InitBinder("ticket")
void ticketBinder(WebDataBinder binder) { binder.setAllowedFields("subject", "body"); }

@ControllerAdvice
class BindingConfig {
    @InitBinder void declarative(WebDataBinder binder) { binder.setDeclarativeBinding(true); }
}
```

For JSON: separate request and response DTOs; set server-owned fields (owner, role, status, prices) in the service from the authenticated principal and server data, never from the request.

## Severity, false positives, verification

- Binding that lets a user set their own role/admin flag or verified status: **High/Critical** (privilege escalation). Changing price/balance/status: **High**. Overwriting `id` to edit another user's record: **High**. Low-impact fields (display preferences): **Low**.
- Missing `@Valid` with no security consequence: **Informational/Low**.

False positives: binding records or DTOs with only expected fields; entities bound under an `@InitBinder` allow-list that matches; entities with privileged fields that have no setter and are not constructor parameters; `FAIL_ON_UNKNOWN_PROPERTIES=false` alone.

Verify:

```java
@Test @WithMockUser(username = "alice")
void cannotEscalateRoleThroughProfileForm() throws Exception {
    mvc.perform(post("/account/profile").with(csrf())
            .param("displayName", "Alice").param("role", "ADMIN").param("enabled", "true"))
       .andExpect(status().is3xxRedirection());
    assertThat(users.findByUsername("alice").orElseThrow().getRole()).isEqualTo(Role.USER);
}
```

References: OWASP Mass Assignment cheat sheet; OWASP API3:2023; CWE-915, CWE-20; https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-data-binding.html, https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-initbinder.html, https://spring.io/security/cve-2022-22965.
