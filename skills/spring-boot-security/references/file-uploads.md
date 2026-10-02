# Spring Boot — File Uploads, Downloads, Path Traversal and Static Resources

## Contents
- Upload handling in Spring
- What to investigate (uploads)
- Downloads and path traversal
- Static resource handlers
- Fix patterns
- Severity, false positives, verification

## Upload handling in Spring

Multipart requests bind to `MultipartFile` (`@RequestParam MultipartFile file`, `@RequestPart`, or a `@ModelAttribute` field). Boot limits: `spring.servlet.multipart.max-file-size` (default `1MB`) and `max-request-size` (default `10MB`); Tomcat's `server.tomcat.max-swallow-size` (default `2MB`). Everything else is the app's job.

`MultipartFile.getOriginalFilename()` javadoc: the name is supplied by the client, "should not be used blindly", may contain `..` and directory parts, and "it is recommended to not use this filename directly. Preferably generate a unique one". `getContentType()` is also client-supplied.

## What to investigate (uploads)

1. **Path built from the original name**: `Paths.get(uploadDir, file.getOriginalFilename())`, `new File(dir, name)`, `uploadDir.resolve(name)`, `file.transferTo(new File(base + "/" + name))`. Without normalization and a containment check this writes outside the directory (overwrite templates, config, scripts in a writable app directory): **High/Critical**.
2. **`StringUtils.cleanPath(name)` as the defense.** Its javadoc says it "should not be depended upon in a security context"; it keeps leading `..` segments. A `contains("..")` check after it is better than nothing but misses absolute paths on some platforms.
3. **Type checks** based on extension or `getContentType()` only; SVG and HTML accepted as "images"; no magic-byte check (Apache Tika) or re-encoding for images.
4. **Where files are served from**: upload directory mapped as a static location (`spring.web.resources.static-locations=file:/var/app/uploads/` or `registry.addResourceHandler("/uploads/**").addResourceLocations("file:...")`) serves user HTML/SVG inline from the app's origin: stored XSS (**High**), plus no authorization on private files.
5. **Archive extraction**: `ZipInputStream`/`ZipFile` entries written with `entry.getName()` (Zip Slip), no total-size or entry-count limit (zip bombs).
6. **Processing libraries** on uploaded content: ImageIO, Apache POI, PDFBox, Tika (XXE and parser CVEs, `deserialization-xxe.md`), ImageMagick via `ProcessBuilder` (`injection.md`).
7. **Authorization** on upload targets (attach a file to someone else's ticket by ID: `authorization.md`) and quotas (unbounded storage).

## Downloads and path traversal

Sinks: `new FileSystemResource(base + name)`, `Paths.get(base, name)` / `Files.readAllBytes(...)`, `new UrlResource("file:" + base + name)`, `resourceLoader.getResource(userValue)` (also `classpath:`, `file:`, `http:`), `new ClassPathResource("reports/" + name)` (`reports/../application.properties` normalizes to `application.properties`: secrets disclosure). Also `Content-Disposition` built by concatenation (`"attachment; filename=" + name`): use `ContentDisposition.attachment().filename(name, StandardCharsets.UTF_8).build()`.

Spring's own static resource handling has had traversal and related advisories: CVE-2024-38816 and CVE-2024-38819 (`RouterFunctions` serving `FileSystemResource` locations), CVE-2025-41242 (Spring MVC resource handling on servlet containers that do not reject suspicious sequences; Tomcat and Jetty with defaults are not affected; fixed 6.2.10), CVE-2026-41843 (versioned resources, fixed 6.2.19 / 7.0.8), CVE-2026-22741 / CVE-2026-22745 (cache poisoning, DoS; fixed 6.2.18 / 7.0.7). Check the installed Framework patch (`dependencies.md`).

## Static resource handlers

- Boot serves `classpath:/META-INF/resources/`, `/resources/`, `/static/`, `/public/` at `/**` (`spring.mvc.static-path-pattern`). Anything placed there is public unless a security rule says otherwise: backups, `.map` files with secrets, exported reports written into `static/` at runtime.
- `file:` locations in `addResourceLocations` or `static-locations` pointing at writable or broad directories (`file:/`, the working directory).
- `web.ignoring()` on upload/download paths removes authentication entirely (`security-filter-chain.md`).

## Fix patterns

```java
private final Path root = Path.of("/var/app/uploads").toAbsolutePath().normalize();

String store(MultipartFile file) throws IOException {
    String ext = switch (detectedType(file)) {          // e.g. Tika on the bytes, not getContentType()
        case "image/png" -> ".png"; case "image/jpeg" -> ".jpg"; case "application/pdf" -> ".pdf";
        default -> throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    };
    String name = UUID.randomUUID() + ext;               // server-generated name
    Path target = root.resolve(name).normalize();
    if (!target.startsWith(root)) throw new IllegalArgumentException();
    file.transferTo(target);
    return name;                                          // store original name separately for display only
}

Resource load(String storedName) throws IOException {
    Path p = root.resolve(storedName).normalize();
    if (!p.startsWith(root) || !Files.isRegularFile(p)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return new UrlResource(p.toUri());
}
```

`Path.startsWith(Path)` compares whole path elements, so `/var/app/uploads-old` does not pass for `/var/app/uploads`. Look files up by an ID the user is authorized for, then serve with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` (Spring Security default), ideally from a separate domain or object storage with signed URLs.

## Severity, false positives, verification

- Write traversal: **High** (Critical if it reaches templates, config or code). Read traversal: **High** when config/secrets are readable, **Medium** for limited directories. Uploaded HTML/SVG served inline from the app origin: **High** (stored XSS). Missing type validation with safe serving: **Low/Hardening**.

False positives: server-generated names (UUID) with the original name only stored as metadata; `Path.normalize()` plus `startsWith(root)` checks; files served with `attachment` from a separate domain; `MultipartFile` limits left at Boot defaults (1MB/10MB).

Verify:

```java
@Test @WithMockUser
void uploadIgnoresClientPath() throws Exception {
    MockMultipartFile f = new MockMultipartFile("file", "../../evil.txt", "text/plain", "x".getBytes());
    mvc.perform(multipart("/attachments").file(f).with(csrf())).andExpect(status().is4xxClientError());
    assertThat(Files.exists(Path.of("/var/app/evil.txt"))).isFalse();
}
@Test @WithMockUser
void downloadRejectsTraversal() throws Exception {
    mvc.perform(get("/attachments/download").param("name", "../application.properties"))
       .andExpect(status().isNotFound());
}
```

References: OWASP File Upload cheat sheet; CWE-22, CWE-434, CWE-73; https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/multipart/MultipartFile.html, https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/util/StringUtils.html#cleanPath(java.lang.String), https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.static-content.
