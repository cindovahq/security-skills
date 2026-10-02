# Secrets, Configuration, Logging, Rate Limiting and Cryptography

## Contents
- Secrets
- Production configuration
- Security headers and TLS
- Rate limiting and resource controls
- Logging, monitoring and error handling
- Cryptography
- Randomness
- Verification

## Secrets

**Where to look:** tracked env files (`.env*`, `*.tfvars`, `appsettings.*.json`, `application-*.yml`, `settings/prod.py`), source constants, test fixtures, CI configs, Dockerfiles (`ENV`/`ARG`, copied files), Helm values, Kubernetes manifests (`Secret` objects are only base64-encoded), notebooks, mobile apps (`google-services.json` is semi-public, but API keys with broad scopes are not), front-end bundles, git history.

**Client-exposed variables:** anything prefixed `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`, `PUBLIC_` (SvelteKit) is shipped to browsers. Secrets there are public.

**Classify:**
- Live production secret in a public repo → **Critical** (rotate immediately; deleting it from git is not enough).
- Live secret in a private repo → High/Medium (insider and supply-chain exposure; rotate and move to a secret manager).
- Publishable or designed-to-be-public keys (Stripe `pk_`, Supabase anon key, Firebase web config, Google Maps keys with referrer restrictions) → not findings by themselves. Check that their **permissions** are restricted (RLS, Firebase rules, API restrictions).
- Placeholders and test keys → Informational.

**Redact** every secret in output. Recommend a secret scanner (gitleaks, trufflehog, GitHub secret scanning with push protection).

## Production configuration

- Debug/development mode in production: Django `DEBUG=True`, Flask `debug=True` (Werkzeug debugger PIN console → RCE), Laravel `APP_DEBUG`, Express `NODE_ENV` ≠ production (verbose errors), Spring Boot Actuator endpoints exposed (`/actuator/env`, `/heapdump`, `/jolokia`), ASP.NET `UseDeveloperExceptionPage` outside Development, Rails `consider_all_requests_local`.
- Admin and debug tools reachable: `/admin` with default credentials, phpMyAdmin/Adminer, GraphiQL/Playground with introspection on private APIs, Swagger UI exposing internal endpoints (fine if intended), `/metrics`, `/debug/pprof` (Go), Telescope/Horizon, Flower, Kibana.
- Default credentials in config or seed data used in production.
- Host header handling: absolute URL generation from `Host`/`X-Forwarded-Host` (password reset poisoning, cache poisoning). Configure allowed hosts (Django `ALLOWED_HOSTS`, Rails `config.hosts`, ASP.NET `AllowedHosts`, Laravel `trustHosts`).
- Trusted proxies: trusting `X-Forwarded-For`/`-Proto`/`-Host` from any client lets attackers spoof client IP (rate-limit and allow-list bypass) and scheme.
- Cookie and session settings (see `authentication-sessions.md`).
- Directory listing, exposed `.git/`, backup files (`.bak`, `.old`, `~`), source maps of private code (Low; Medium if they reveal secrets or internal endpoints).

## Security headers and TLS

Generally **Hardening**, unless tied to a concrete exploit:
- `Strict-Transport-Security` (HSTS) on HTTPS sites; HTTP → HTTPS redirect.
- `Content-Security-Policy` (see `client-side.md`).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin` (or stricter if URLs carry tokens).
- `frame-ancestors` / `X-Frame-Options` on pages with sensitive actions.
- `Permissions-Policy` for powerful features.
- `Cache-Control: no-store` on responses with sensitive personal data.
- TLS: modern protocol versions only (TLS 1.2+); no certificate-validation bypass in clients (`verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify: true`, custom trust-all `TrustManager`) → High when used for real traffic.

## Rate limiting and resource controls

Needed on: authentication and recovery endpoints, OTP/verification, sign-up, messaging/email/SMS sending (cost/spam), search, exports, file processing, expensive queries, LLM-backed endpoints (cost exhaustion), GraphQL (depth/complexity), batch endpoints (array size limits), pagination (max page size).

Check the limiter key isn't spoofable (client IP from untrusted headers) and that limits apply across all instances (shared store, not in-memory per pod).

## Logging, monitoring and error handling

- **Don't log:** passwords, tokens, session IDs, API keys, full card numbers, secrets in URLs, health data, raw request bodies of auth endpoints.
- **Do log** security events: login success/failure, MFA changes, password changes, permission changes, admin actions, access-denied events, with user ID, IP, timestamp. Missing audit logs for sensitive admin actions → Hardening/Medium depending on compliance needs.
- Error responses: no stack traces, SQL or internal paths to clients in production.
- Log injection: newline characters in user input written to plain-text logs.
- Error trackers (Sentry etc.): PII/secret scrubbing configured.

## Cryptography

- Use vetted libraries and high-level APIs (libsodium/NaCl, Tink, framework encryption helpers, AES-GCM / ChaCha20-Poly1305).
- **Findings:** ECB mode; CBC without MAC (padding oracles); static/reused IVs or nonces (catastrophic for GCM); hardcoded keys; keys derived from passwords with fast hashes; MD5/SHA-1 for signatures or integrity against attackers; RSA < 2048 bits or PKCS#1 v1.5 encryption for new designs; custom crypto protocols; `alg` negotiation from untrusted input.
- MACs: HMAC-SHA256 with a secret key, compared in **constant time** (`crypto.timingSafeEqual`, `hmac.compare_digest`, `hash_equals`, `MessageDigest.isEqual`, `CryptographicOperations.FixedTimeEquals`, `subtle.ConstantTimeCompare`).
- Passwords: see `authentication-sessions.md` (hashing, not encryption).
- Data at rest: field-level encryption for highly sensitive fields. Key management (KMS) and rotation.

## Randomness

Security tokens (session IDs, reset tokens, API keys, OTPs, invite codes, CSRF tokens, filenames for private files) need a CSPRNG:

| Ecosystem | Insecure | Secure |
|---|---|---|
| JS | `Math.random()` | `crypto.randomBytes`, `crypto.randomUUID()`, `crypto.getRandomValues` |
| Python | `random.*` | `secrets.token_urlsafe()`, `secrets.choice` |
| Java | `java.util.Random`, `Math.random` | `SecureRandom` |
| .NET | `System.Random` | `RandomNumberGenerator` |
| Go | `math/rand` | `crypto/rand` |
| PHP | `rand`, `mt_rand`, `uniqid` | `random_bytes`, `random_int` |
| Ruby | `rand`, `Random` | `SecureRandom` |

UUIDv1 and v7 contain timestamps and are partially predictable. UUIDv4 from a CSPRNG is fine as an identifier, but prefer dedicated random tokens for secrets.

## Verification

- `curl -sI https://staging.example.com` for headers and cookies. Request `/.env`, `/.git/config` and debug endpoints → 404/403.
- Trigger an error on staging → generic error page without stack trace.
- Secret scan of the repo and history. Confirm rotated keys are revoked at the provider.
- Unit tests for constant-time compare usage and token entropy (length/charset).

References: OWASP Secrets Management, Logging, Error Handling, HTTP Headers, Cryptographic Storage, Key Management, Transport Layer Security Cheat Sheets; OWASP A02:2025 Security Misconfiguration, A04:2025 Cryptographic Failures; CWE-798, CWE-200, CWE-209, CWE-215, CWE-532, CWE-327, CWE-328, CWE-329, CWE-330, CWE-338, CWE-295, CWE-770.
