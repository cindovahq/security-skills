# API Security (REST, GraphQL, WebSockets, Webhooks)

## Contents
- OWASP API Top 10 checklist
- REST specifics
- GraphQL
- WebSockets and real-time
- Webhooks (inbound and outbound)
- gRPC and internal APIs
- Verification

## OWASP API Top 10 (2023) checklist

| ID | Risk | What to check |
|---|---|---|
| API1 | Broken Object Level Authorization | Every ID-taking endpoint scoped to the caller (see `authorization.md`) |
| API2 | Broken Authentication | Token validation, expiry, revocation, brute-force protection (see `authentication-sessions.md`) |
| API3 | Broken Object Property Level Authorization | Responses expose only allowed fields; writes accept only allowed fields (mass assignment) |
| API4 | Unrestricted Resource Consumption | Page-size caps, rate limits, payload size limits, timeouts, array limits, expensive-operation quotas (SMS, email, AI calls) |
| API5 | Broken Function Level Authorization | Admin/internal operations require roles; no "hidden" admin endpoints protected by obscurity |
| API6 | Unrestricted Access to Sensitive Business Flows | Automation abuse of checkout, signup, referral, voting, booking (see `business-logic.md`) |
| API7 | Server-Side Request Forgery | User-supplied URLs (see `ssrf-files.md`) |
| API8 | Security Misconfiguration | CORS, verbose errors, debug endpoints, missing TLS, permissive HTTP methods |
| API9 | Improper Inventory Management | Old API versions (`/v1/`) still live without the fixes in `/v2/`; undocumented endpoints; staging APIs on public hosts |
| API10 | Unsafe Consumption of APIs | Trusting third-party API responses without validation; following their redirects; TLS verification disabled |

## REST specifics

- **Serialization:** return DTOs or serializers with explicit fields. Returning ORM entities directly leaks columns added later.
- **Input binding:** frameworks that bind request bodies onto entities (Spring `@ModelAttribute` on entities, ASP.NET model binding to EF entities, Rails without strong params, Mongoose `new Model(req.body)`) → mass assignment.
- **HTTP methods:** `PUT`/`PATCH`/`DELETE` authorized like `GET`. `OPTIONS`/`HEAD` don't bypass auth middleware. Method-override headers disabled unless needed.
- **Versioning:** security fixes back-ported to, or old versions retired.
- **Error handling:** consistent error shapes without stack traces. Don't distinguish "not found" vs "forbidden" when that leaks existence of sensitive objects (prefer 404 for unauthorized object access).
- **Content types:** reject unexpected `Content-Type`. JSON responses with `application/json` and `nosniff`.
- **Idempotency** for payment/order creation (`Idempotency-Key`) to prevent duplicate charges on retries.

## GraphQL

- Authorization at the resolver and field level, including nested types reachable via relations (`viewer { team { members { email } } }`).
- Query **depth** and **complexity/cost** limits, timeouts, and pagination limits on list fields.
- **Batching/aliasing abuse:** many login attempts or OTP guesses in one request via aliases (`a1: login(...) a2: login(...)`) bypass per-request rate limits. Limit operations per request or rate-limit per resolver.
- **Introspection** disabled in production for private APIs (Hardening; not a vulnerability by itself). Field suggestions ("Did you mean...") can leak schema even when introspection is off.
- **CSRF:** GraphQL over `GET`, or `POST` with `application/x-www-form-urlencoded`/`text/plain`, with cookie auth → CSRF-able mutations. Require `application/json` and/or CSRF tokens (Apollo Server's CSRF prevention).
- Persisted queries / allow-listed operations for first-party-only APIs (strong hardening).
- File uploads via `graphql-upload`: same rules as uploads. Enable CSRF prevention.

## WebSockets and real-time

- Authenticate the connection (token or cookie) **and** authorize each subscription/channel and each message action. Not just the initial handshake.
- **Cross-Site WebSocket Hijacking:** cookie-authenticated WebSockets must validate the `Origin` header at handshake (browsers don't apply CORS to WebSockets).
- Validate message schemas. Apply rate limits per connection. Cap message size and connection count.
- Broadcast payloads: don't push full objects to channels that more users can join than should see them.

## Webhooks (inbound and outbound)

**Inbound** (Stripe, GitHub, Shopify, Twilio, Slack, payment providers, auth providers):
- Signature verified over the **raw** request body with the provider's secret, using a constant-time comparison, **before** any processing. Missing verification on payment/subscription webhooks → **Critical/High**.
- Raw body preserved: JSON parsing before verification breaks signatures, and developers then "fix" it by skipping verification.
- Timestamp tolerance and event-ID deduplication (replay).
- Don't trust IDs in the payload blindly: fetch the object from the provider's API when the action is high-value.
- Excluded from CSRF (expected), but not from authentication (the signature *is* the authentication).

**Outbound** (your app calls user-configured URLs): SSRF controls (see `ssrf-files.md`), sign your payloads (HMAC with per-endpoint secrets), timeouts, and no internal data in error messages.

## gRPC and internal APIs

- "Internal" APIs reachable from the internet, or from compromised pods, without auth. Prefer mTLS / service identity.
- gRPC reflection enabled in production (Hardening).
- Services trusting user identity from headers set by a gateway (`X-User-Id`). The gateway must strip client-supplied versions of those headers, and the service must not be reachable around the gateway.

## Verification

- Contract tests per endpoint: unauthenticated → 401; wrong user → 403/404; wrong role → 403; extra fields ignored; page size capped.
- GraphQL: depth/complexity-limit tests; alias-batching test against login/OTP; introspection off in production config.
- WebSocket: handshake from a foreign `Origin` with cookies → rejected; subscribe to another user's channel → rejected.
- Webhooks: unsigned / wrongly signed / stale timestamp → 400/401/403 with no side effects.

References: OWASP API Security Top 10 2023; OWASP GraphQL, REST Security, WebSocket Security Cheat Sheets; CWE-285, CWE-639, CWE-770, CWE-915, CWE-1385, CWE-345.
