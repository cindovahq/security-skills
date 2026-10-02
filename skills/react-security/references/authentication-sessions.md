# React — Authentication, Tokens and Sessions

## Contents
- Scope
- Where tokens live: the honest trade-offs
- OAuth/OIDC in browser apps
- React Router sessions and cookies
- Client-side auth state
- Logout and shared devices
- Severity, false positives, verification

## Scope

A SPA has no secrets and no enforcement of its own: password checks, session issuance, token validation and rate limiting live in the backend (see `nodejs-security`, `laravel-security`, `supabase-security` or `appsec-review`). Review the client half here: where credentials are stored, how they are sent, and what the UI trusts. In React Router framework mode, TanStack Start and Remix, `action`s/server functions *are* the backend and must be reviewed as such.

## Where tokens live: the honest trade-offs

| Storage | Readable by injected script | Sent automatically | Main risks |
|---|---|---|---|
| `localStorage` / `sessionStorage` / IndexedDB | **Yes**, and can be exfiltrated for use elsewhere | No (not CSRF-prone) | Any XSS, malicious dependency or third-party script steals a reusable token. OWASP HTML5 Cheat Sheet: "Do not store session identifiers in local storage as the data is always accessible by JavaScript." |
| In-memory variable (plus refresh via `httpOnly` cookie) | Only while the page lives; script can still call the refresh endpoint | Refresh cookie is | Lost on reload unless refreshed; XSS still acts in-page |
| `httpOnly; Secure; SameSite=Lax/Strict` cookie | **No** | Yes | Token can't be stolen, but XSS can still make authenticated requests as the user; needs CSRF defenses (see `csrf-cors.md`) |
| Backend-for-Frontend (BFF) holding OAuth tokens, browser gets a session cookie | No | Yes | Most robust; RFC 10017 (OAuth 2.0 for Browser-Based Applications, BCP 212) "strongly recommended for business applications, sensitive applications, and applications that handle personal data" |

Neither choice makes XSS harmless. Rate the finding by what is actually stored and what sinks exist:

- Long-lived JWT/refresh token in `localStorage` **and** a confirmed XSS sink: report the XSS at its own severity and state that token theft raises the impact.
- Token in `localStorage` with no XSS sink found: **Hardening/Low**, recommend BFF or `httpOnly` cookies for sensitive apps. Short-lived access tokens in memory are acceptable.
- Tokens in URLs (`?token=`, `#access_token=` for non-OAuth flows, WebSocket query strings) leak via history, logs and `Referer`: Medium.
- Auth0 SPA SDK `cacheLocation` defaults to `memory`; `localstorage` is opt-in (SDK docs). Supabase JS persists sessions in browser storage by default (see `supabase-security`).

## OAuth/OIDC in browser apps

- Authorization Code flow **with PKCE** (S256). RFC 9700 (OAuth Security BCP): public clients MUST use PKCE; clients SHOULD NOT use the implicit grant (`response_type=token`); authorization servers MUST use exact string matching for redirect URIs. Implicit flow, wildcard or prefix-matched redirect URIs in the IdP config, and missing `state`/`nonce` checks are findings (Medium/High depending on token exposure).
- No client secret in the bundle (`secrets-config.md`). Public SPAs use client IDs only.
- Validate the `state` returned in the callback route before exchanging the code. Callback routes that redirect to `returnTo` need the open-redirect check in `ssrf-redirects.md`.
- `id_token`/access token claims decoded in the browser (`jwt-decode`) are for display. Verifying signatures in the client is not authorization (`authorization.md`).

## React Router sessions and cookies

Docs: `createCookieSessionStorage` stores the session in a signed cookie; `createCookie(name, { secrets })` signs and verifies; the first secret signs, older ones still verify (rotation); recommended options `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `maxAge`, `path: '/'`.

```ts
const { getSession, commitSession } = createCookieSessionStorage({
  cookie: { name: '__session', secrets: [process.env.SESSION_SECRET ?? 'dev-secret'], secure: false, httpOnly: false },
});
```

Investigate:

- Hardcoded or fallback secrets (`?? 'dev-secret'`), secrets committed to the repo, missing `secrets` (unsigned cookie, forgeable), short secrets, or one secret shared across environments. Forged session cookies mean account takeover: **Critical/High**.
- `secure`/`httpOnly`/`sameSite` weakened, `sameSite: 'none'`, very long `maxAge` for sensitive apps.
- Signing gives integrity, not confidentiality: do not put secrets or PII in cookie sessions you wouldn't show the user (the contents are readable by the cookie owner).
- `createFileSessionStorage` with unsigned cookies: CVE-2025-61686 (path traversal outside the session directory, `@react-router/node` <7.9.4, fixed 7.9.4). `createMemorySessionStorage` is for dev/test only (docs).
- State changes in a `loader` (logout, delete, "confirm" links): GET is not protected by action-origin checks and is CSRF-able. React Router docs: "perform any mutation ... in an `action` and not a `loader`".
- Session ID rotation on login (fixation): with `createSessionStorage` (database-backed) create a new session on login.
- Login actions: unthrottled attempts, user enumeration in messages, weak password hashing (unsalted `sha256`/`md5`), long-lived reset tokens. Backend topics: see `nodejs-security`/`appsec-review`.

## Client-side auth state

`AuthContext`, `useAuth()`, decoded JWT roles, `localStorage.isAdmin`, and `<RequireAuth>` wrappers decide what the UI renders. They are not authorization: anyone can edit client state or call the API directly. See `authorization.md`. Persisting `user`/`role` to storage and trusting it on reload is cosmetic at best.

## Logout and shared devices

Logout should call the server to end the session (or revoke the refresh token), clear in-memory and persisted state (`queryClient.clear()`, Redux reset, `localStorage`, service-worker caches), and navigate away. Leaving cached query data lets the next user on a shared browser see the previous user's data (Medium if sensitive).

## Severity, false positives, verification

- Forgeable session (hardcoded/absent secret) or tokens exposed via URL on a sensitive app: Critical/High. `localStorage` token only: Hardening/Low (Medium if XSS sinks exist and tokens are long-lived).
- **Not findings:** a decoded JWT used only for display; `sessionStorage` for non-sensitive UI state; Supabase auth cookies readable by JS (SSR client default); auth cookies lacking `httpOnly` when the SDK requires JS access and tokens are short-lived (Hardening).
- **Verify:** inspect `Set-Cookie` flags with `curl -i`; try replaying a session cookie signed with the fallback secret in a test environment; after logout confirm `localStorage`, IndexedDB and query caches are empty; confirm the IdP rejects an unregistered `redirect_uri`.

References: OWASP ASVS V3/V7, Session Management and HTML5 Security Cheat Sheets; CWE-312, CWE-384, CWE-522, CWE-798; https://datatracker.ietf.org/doc/rfc10017/, https://www.rfc-editor.org/rfc/rfc9700, https://reactrouter.com/explanation/sessions-and-cookies, https://github.com/remix-run/react-router/security/advisories/GHSA-9583-h5hc-x8cw.
