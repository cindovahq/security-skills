# Spring Boot — Injection (SQL/JPQL, Sort, LDAP, NoSQL, OS command, SpEL, EL)

## Contents
- Tracing rules
- SQL and JPQL/HQL
- Sorting and identifiers
- LDAP and NoSQL
- OS command injection
- SpEL injection
- Bean Validation message (EL) injection
- Severity, false positives, verification

## Tracing rules

Source (request parameter, path variable, header, cookie, JSON body, uploaded file, message payload, data a user stored earlier) → transformations → sink. Template injection is in `templates-xss.md`; deserialization and XML in `deserialization-xxe.md`.

## SQL and JPQL/HQL

Values bound as parameters are safe in every Spring data API. Injection happens when strings are concatenated into the query text.

Sinks:

```java
em.createQuery("select u from User u where u.name = '" + name + "'")                  // JPQL/HQL injection
em.createNativeQuery("select * from users where email = '" + email + "'")
session.createQuery("from Order o where o.status = " + status)                          // Hibernate
jdbcTemplate.queryForList("select * from invoice where region = '" + region + "'")
jdbcTemplate.update("update account set note = '" + note + "' where id = " + id)
jdbcClient.sql("select ... where name = '" + name + "'")                                // JdbcClient (6.1+)
String.format("... where id = %s", id)   "..." .formatted(x)   StringBuilder.append(userValue) into SQL
@Query(value = "select ... " + CONSTANT) is fine; concatenation only matters with runtime values
```

Safe equivalents:

```java
em.createQuery("select u from User u where u.name = :name", User.class).setParameter("name", name)
jdbcTemplate.queryForList("select * from invoice where region = ?", region)
namedJdbc.queryForList("select * from invoice where region = :region", Map.of("region", region))
jdbcClient.sql("select * from invoice where region = :region").param("region", region).query(Invoice.class).list()
@Query("select i from Invoice i where i.status = :status") List<Invoice> byStatus(@Param("status") Status s);
cb.like(root.get("name"), "%" + q + "%")      // Criteria API: q is bound as a parameter
```

Spring Data derived query methods (`findByEmailAndStatus`), `Specification`s using the Criteria API, Querydsl predicates and `@Query` with `:param`, `?1` or `:#{...}`/`?#{...}` SpEL parameter expressions all bind values. `LIKE` wildcards (`%`, `_`) inside a bound value are not injection; escape them if exact matching matters (Spring Data JPA `escape()` SpEL function).

## Sorting and identifiers

Bindings cannot parameterize identifiers, so sort fields and column names are a separate risk:

- `Pageable`/`Sort` bound from `?sort=` on derived queries: Spring Data JPA resolves each property against the entity and throws for unknown paths, so it is not SQL injection, but clients can sort by **any** property, including `password`, `resetToken`, `apiKey` or `owner.password`. Ordering leaks those values a character at a time: **High** when plaintext tokens are reachable, **Medium** for salted hashes. Allow-list sortable properties (or use `@SortDefault` plus a mapping from public names).
- `@Query` (JPQL) + `Sort`: Spring Data JPA rejects `Order` values containing function calls unless `JpaSort.unsafe(...)` is used. `JpaSort.unsafe(request.getParameter("sort"))` is injection.
- Native queries with `Sort`/`Pageable` from untrusted input: CVE-2026-47834 (Sort validation bypass on databases that accept non-ASCII SQL syntax; Spring Data JPA fixed 4.0.7 / 4.1.1, 3.5.14 enterprise).
- `"order by " + sort`, `"select " + columns`, table names from requests in `JdbcTemplate`/`createQuery`: **SQL injection**. Map public names to fixed column names.

## LDAP and NoSQL

- Spring LDAP: `ldapTemplate.search("", "(uid=" + uid + ")", ...)` is filter injection. Use `LdapQueryBuilder.query().where("uid").is(uid)` (encodes the value) or `LdapEncoder.filterEncode(uid)`; for DNs, `LdapNameBuilder`.
- Spring Data MongoDB: `@Query("{ 'name': ?0 }")` binds; `new BasicQuery("{ name: '" + name + "' }")`, `Document.parse(userJson)`, `$where` with user input, and `Criteria.where(userField)` are injection. JSON bodies bound to `Map<String, Object>` and passed into queries allow operator injection (`{"$ne": null}`).
- Spring Data Redis: key names built from user input across tenants (authorization, not injection).

## OS command injection

`Runtime.getRuntime().exec(String)` splits on whitespace and does **not** invoke a shell, so shell metacharacters are inert, but attacker-controlled arguments (option injection: `--output=/etc/...`, `-o ProxyCommand=...`) still matter. `new ProcessBuilder("sh", "-c", "convert " + file)` or `"cmd.exe", "/c"` is full shell injection: **Critical** when reachable. Fix: fixed executable, argument list, `--` before user arguments, allow-listed values, no shell.

## SpEL injection

Spring Expression Language can invoke constructors, static methods and beans. The Spring docs: evaluating an expression from an untrusted source "is inherently dangerous and should generally be avoided", `StandardEvaluationContext` "must never be used" for untrusted expressions, and `SimpleEvaluationContext` restrictions are "best-effort".

Sinks: `new SpelExpressionParser().parseExpression(userInput).getValue(...)` with no context (defaults to a `StandardEvaluationContext`) or with `new StandardEvaluationContext(...)`; expression strings built by concatenating user input (`"price * " + factor`); `@Value("#{...}")` is fine (developer-defined). Also indirect: user-defined "rules", "formulas", "filters" or "templates" stored in the database and evaluated later (second-order), Spring Integration/Cloud Function routing expressions from headers (CVE-2022-22963 class), Spring Cloud Gateway route definitions created through an exposed `gateway` actuator endpoint (CVE-2022-22947 class, `actuator-config.md`).

Safer patterns:
- Do not evaluate user-supplied expressions. Offer a fixed set of operations or a small domain-specific parser.
- If expressions are developer- or admin-defined and only the **data** is user-controlled, use `SimpleEvaluationContext.forReadOnlyDataBinding().build()` with a plain DTO root object whose accessor-shaped methods have no side effects. That is the trap case: user data as the root object is not injection.
- Framework 6.2.19 / 7.0.8 cap evaluation at 10,000 operations by default (`spring.expression.maxOperations`); 7.0.9 disables compilation for `SimpleEvaluationContext` by default. These limit DoS, not code execution. Below 6.2.19 / 7.0.8, `SimpleEvaluationContext` is not a boundary for **untrusted expressions** either: CVE-2026-41852 allowed zero-argument method invocation even in restricted/read-only contexts.

## Bean Validation message (EL) injection

Hibernate Validator interpolates `${...}` Expression Language in constraint messages. Since Hibernate Validator 6.2 (Boot 3 and 4 ship 8.x or later), EL is **disabled by default for custom violations** built with `ConstraintValidatorContext.buildConstraintViolationWithTemplate(...)`, and constraint messages default to the `BEAN_PROPERTIES` feature level. A finding needs user input in a message template **and** EL re-enabled. `HibernateConstraintValidatorContext.enableExpressionLanguage()` alone enables only the `VARIABLES` level (no code execution: Low/Medium). Code execution needs the `BEAN_METHODS` level (`customViolationExpressionLanguageFeatureLevel(BEAN_METHODS)` at bootstrap or the per-violation overload) or Hibernate Validator older than 6.2: then **Critical**. Fix: constant templates and `addMessageParameter`/`addExpressionVariable` for values.

## Severity, false positives, verification

- Unauthenticated SQL/JPQL injection: **Critical**; authenticated: **High** (Critical if it crosses tenants or reaches credentials); admin-only: **Medium/High**.
- SpEL injection (or EL injection with EL enabled) reachable by any user: **Critical** (code execution). Admin-only editable rules: **High** (admin to RCE is still privilege escalation to the host).
- Sort-by-secret-field oracle: **High**/**Medium** as above, not "Low input validation".

False positives: Criteria API and `Specification`s with values in `cb.equal`/`cb.like`; `@Query` with named or positional parameters; `NamedParameterJdbcTemplate`/`JdbcClient` with `:param`; `@Value("#{...}")`; SpEL in `@PreAuthorize` (developer-defined; arguments are referenced as variables, not concatenated); `SimpleEvaluationContext` evaluating developer-defined expressions against user data; `Runtime.exec(String[])` with a fixed command and validated arguments.

Verify with a test that sends a harmless metacharacter and asserts the result set does not widen and no error leaks:

```java
@Test @WithMockUser
void regionFilterIsParameterized() throws Exception {
    mvc.perform(get("/reports/revenue").param("region", "EU' OR '1'='1"))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.rows").isEmpty());
}
@Test void sortIsAllowListed() throws Exception {
    mvc.perform(get("/api/customers").param("sort", "passwordHash").with(jwt()))
       .andExpect(status().isBadRequest());
}
```

Static: `semgrep --config p/java`, SpotBugs with Find Security Bugs (`SQL_INJECTION_JPA`, `SQL_INJECTION_SPRING_JDBC`, `SPEL_INJECTION`, `COMMAND_INJECTION`).

References: OWASP Injection Prevention and Query Parameterization cheat sheets; OWASP Top 10:2025 A05 Injection; CWE-89, CWE-90, CWE-917, CWE-943, CWE-78; https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html, https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html, https://spring.io/security/cve-2026-47834.
