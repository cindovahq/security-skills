# Spring Boot — Deserialization and XML (XXE)

## Contents
- Java native serialization
- Jackson polymorphic typing
- YAML, XStream and other object mappers
- XML external entities (XXE)
- Severity, false positives, verification

## Java native serialization

Deserializing attacker-controlled bytes with Java serialization can execute code through gadget classes on the classpath. Sinks:

```text
new ObjectInputStream(...).readObject()   SerializationUtils.deserialize(   (Spring: deprecated, javadoc warns of RCE)
org.apache.commons.lang3.SerializationUtils.deserialize(   ObjectInputStream subclasses without resolveClass checks
JdkSerializationRedisSerializer / RedisTemplate without explicit serializers (Spring Data Redis default)
JMS ObjectMessage.getObject()   AMQP/Kafka converters configured for Java serialization
Spring Session (Redis/JDBC) default Java serialization of session attributes
```

Sources to trace: cookies (`"cart"`, `"prefs"`, `"remember"`), hidden form fields, request bodies (`application/x-java-serialized-object`), uploaded files, message queues and caches an attacker can write to.

Spring-specific history: HTTP Invoker, Hessian, JMS Invoker and JAX-WS remoting support were **removed in Spring Framework 6.0** (CVE-2016-1000027 concerned `HttpInvokerServiceExporter`). Any of these classes in a Boot 3/4 project means a third-party copy or a very old dependency.

Fix: replace with JSON into a fixed DTO type; sign data stored client-side (or keep it server-side); if Java serialization is unavoidable for trusted internal stores, use a JEP 290 `ObjectInputFilter` allow-list (`jdk.serialFilter` or `ObjectInputStream.setObjectInputFilter`) and keep the store private.

## Jackson polymorphic typing

Jackson is safe by default. It becomes dangerous when type information from the JSON chooses the Java class:
- `@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)` or `Id.MINIMAL_CLASS` on a property of a broad type (`Object`, `Serializable`, `Comparable`, `Map<String, Object>` values, an interface with many implementations).
- Default typing: `objectMapper.activateDefaultTyping(LaissezFaireSubTypeValidator.instance, ...)`, the deprecated `enableDefaultTyping()`, `JsonMapper.builder().activateDefaultTyping(...)`.
- Since Jackson 2.10, default typing requires a `PolymorphicTypeValidator`; `BasicPolymorphicTypeValidator.builder().allowIfSubType("com.acme.portal.events.")` limits it to your own types. Jackson maintains a deny-list of known gadgets, but it is not a security boundary.
- `Id.NAME` with `@JsonSubTypes` (logical names mapped to known classes) is the safe pattern.

Boot 4 / Framework 7 default to **Jackson 3** (`tools.jackson.*` packages; `com.fasterxml.jackson.annotation` annotations such as `@JsonTypeInfo` keep their package). Check which `ObjectMapper`/`JsonMapper` is in play: Boot's auto-configured mapper, a custom `@Bean`, or a `new ObjectMapper()` in the code.

## YAML, XStream and other object mappers

- **SnakeYAML** before 2.0: `new Yaml().load(input)` and `new Yaml(new Constructor(Foo.class))` instantiate arbitrary classes from global tags (CVE-2022-1471). SnakeYAML 2.x (Boot 3 and 4 manage 2.x) rejects global tags by default through `LoaderOptions`' `UnTrustedTagInspector`. Findings on 2.x need a custom `TagInspector` that allows tags. For untrusted YAML, use `new Yaml(new SafeConstructor(new LoaderOptions()))`. Boot's own `application.yml` loading is trusted input.
- **XStream**: unmarshalling untrusted XML without an explicit allow-list (`xstream.addPermission(NoTypePermission.NONE)` then `allowTypes(...)`). Versions before 1.4.18 had many RCE advisories; later releases fixed DoS issues through 1.4.21.
- Kryo, Hessian, Fury, XMLDecoder (`java.beans.XMLDecoder` on untrusted input is always RCE), Castor, `ObjectMessage` converters: same rule, the input must not choose the class.

## XML external entities (XXE)

JDK XML parsers process DTDs by default. Spring's own converters are hardened: `Jaxb2RootElementHttpMessageConverter` defaults to `supportDtd = false` and `processExternalEntities = false`, and `Jackson2ObjectMapperBuilder` creates XML mappers with `StaxUtils.createDefensiveInputFactory()`. Findings are in **custom** parsing code:

```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();     // vulnerable unless hardened
Document doc = dbf.newDocumentBuilder().parse(file.getInputStream());
```

Also `SAXParserFactory`, `XMLInputFactory` (StAX), `TransformerFactory` (XSLT from users is code execution territory), `SchemaFactory`, `XMLReader`, `SAXReader` (dom4j), `SAXBuilder` (JDOM2), JAXB `Unmarshaller` given a raw `InputStream`, Apache POI/Tika/docx processing of uploaded files on outdated versions, SOAP clients/servers.

Fix:

```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
// StAX: factory.setProperty(XMLInputFactory.SUPPORT_DTD, false); factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
```

Or use Spring's converters / `StaxUtils.createDefensiveInputFactory()` instead of raw factories.

## Severity, false positives, verification

- Java deserialization of attacker-controlled bytes: **Critical** if a usable gadget chain is on the classpath, otherwise **High (Likely)**; name the condition. Do not prove it with a gadget payload.
- Jackson `Id.CLASS` on broad types from untrusted JSON: **High (Likely)**, Critical with a known gadget present.
- XXE with external entities resolved: **High** (file read, SSRF); DTD-only (billion laughs) without entity resolution: **Medium** (DoS).

False positives: Jackson with concrete DTO types and no type info; `@JsonTypeInfo(use = Id.NAME)` with `@JsonSubTypes`; SnakeYAML 2.x with defaults; XML via Spring's HTTP message converters; Java serialization of data the app wrote to a private store (Hardening: add filters).

Verify safely: unit-test that the hardened parser rejects a document with a DOCTYPE (expect an exception), that the cookie parser rejects non-JSON input, and that `ObjectMapper` refuses a class-name type id:

```java
@Test void xmlImportRejectsDoctype() {
    byte[] xml = "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e \"v\">]><invoices>&e;</invoices>".getBytes(UTF_8);
    assertThrows(Exception.class, () -> importer.parse(new ByteArrayInputStream(xml)));
}
```

References: OWASP Deserialization and XXE Prevention cheat sheets; OWASP Top 10:2025 A08; CWE-502, CWE-611, CWE-776; https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/util/SerializationUtils.html, https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization, https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html.
