# Flutter — Authentication, Tokens and Local Authentication

## Contents
- Sign-in flows
- OAuth/OIDC with flutter_appauth
- Redirect URIs: custom scheme vs claimed https
- Token handling
- Firebase Auth and Supabase Auth notes
- Biometrics and app lock (local_auth)
- Severity, false positives, verification

## Sign-in flows

Mobile apps are **public clients**: anything in the binary is known to attackers (`secrets-binary.md`). Review what proves identity to the server and what the app merely assumes.

| Pattern | Verdict |
|---|---|
| System browser (ASWebAuthenticationSession, Custom Tabs) + authorization code + PKCE | Correct (RFC 8252, RFC 9700) |
| Email/password sent to your own API over HTTPS, server issues short-lived tokens | Fine; server must rate-limit |
| Embedded WebView login (`webview_flutter`, `flutter_inappwebview`) for a third-party IdP, or JS injected to read the form | Finding: RFC 8252 §8.12 says native apps MUST NOT use embedded user-agents for authorization requests, because the host app sees credentials and cookies and cannot share the browser session |
| Resource Owner Password Credentials grant (`grant_type=password`) to a third-party IdP | Finding: RFC 9700 §2.4 says it MUST NOT be used |
| Implicit flow / tokens in the redirect fragment | Finding: cannot use PKCE; RFC 8252 says NOT RECOMMENDED |
| `clientSecret:` in `AuthorizationTokenRequest`, or a client secret in Dart/assets | Finding: public clients cannot keep secrets; use PKCE with a public client registration |
| Home-made login that stores `isLoggedIn`/`role` flags and trusts them | Authorization belongs on the server (`authorization-backends.md`) |

## OAuth/OIDC with flutter_appauth

`flutter_appauth` 12.1.0 wraps the AppAuth SDKs, which open the system browser (AppAuth-Android's README: `WebView` is explicitly not supported) and support PKCE. Check:

- `AuthorizationTokenRequest(clientId, redirectUrl, issuer|discoveryUrl|serviceConfiguration, scopes: [...])` with **no** `clientSecret`.
- `allowInsecureConnections` stays `false` (the default). `true` allows HTTP endpoints.
- `authorize` + manual `token(...)` must pass the same `codeVerifier` and `nonce` returned by `authorize` (the README warns about mismatches).
- iOS: `externalUserAgent: ExternalUserAgent.ephemeralAsWebAuthenticationSession` avoids sharing the Safari session (and the "wants to use ... to sign in" prompt); the same choice must be used for `endSession`. This replaced the older `preferEphemeralSession` flag shown in some READMEs.
- Validate ID token claims (issuer, audience, nonce, expiry) when the app reads them; access decisions still belong to the API.
- Request only the scopes and `offline_access` the app needs.
- Android redirect scheme comes from `manifestPlaceholders["appAuthRedirectScheme"]` (lower-case) and the AppAuth `RedirectUriReceiverActivity`, which must be `android:exported="true"`.

`flutter_web_auth_2` 5.1.0 only opens the browser and returns the callback URL: PKCE, `state`/`nonce` generation and verification, and token exchange are yours to implement. Missing `state` or PKCE there is a finding.

## Redirect URIs: custom scheme vs claimed https

- Private-use schemes (`acmeapp://callback`, Info.plist `CFBundleURLTypes`, Android `<data android:scheme=...>`) can be registered by any installed app; Android lets multiple apps claim the same URI. Apple: custom schemes are "an acceptable form of deep linking" but "universal links are strongly recommended" and "URL schemes offer a potential attack vector into your app". RFC 8252 §7.2: claimed `https` redirects let the OS guarantee the destination app's identity; §7.1: private-use schemes MUST be based on a reversed domain name the app controls; §8.1: PKCE mitigates code interception by a co-installed app.
- With a custom scheme: PKCE (S256) is mandatory on both client and IdP, schemes use reverse-DNS (`com.acme.orders:/oauth2redirect`), and the IdP enforces exact redirect matching.
- Prefer Android App Links (`android:autoVerify="true"` + `/.well-known/assetlinks.json`) and iOS Universal Links (Associated Domains `applinks:` + `apple-app-site-association`) for redirects when the IdP supports them. See `deep-links.md`.
- Finding signals: wildcard or multiple loosely matched redirect URIs in IdP config files in the repo; `startsWith(scheme)` checks on callbacks; callback code parameters accepted from any deep link without a pending flow `state`.

## Token handling

- Store access/refresh tokens in `flutter_secure_storage`, not `shared_preferences`, Hive without a cipher or files (`local-storage.md`).
- Short access-token lifetime, refresh-token rotation and reuse detection are server settings; report their absence only when you can see the server. Refresh on 401 in one place; serialize refresh calls.
- Do not log tokens or put them in URLs, route extras, analytics events or crash reports (`logging-privacy-ui.md`).
- Do not authorize from decoded JWT claims in the app (`jwt_decoder` etc.); that is display logic. Verify tokens on the server.
- Logout: revoke at the server if supported, `endSession` for OIDC, clear secure storage, caches, WebView cookies, push token registration.
- Multiple accounts and shared devices: namespace storage per user and clear on switch.
- Passwords: never store; if "remember me" exists use refresh tokens. Avoid client-side hashing as a substitute for TLS plus server-side hashing.

## Firebase Auth and Supabase Auth notes

- Firebase Auth (`firebase_auth` 6.7.0): the SDK persists and refreshes sessions natively; send `await user.getIdToken()` to your backend and verify with the Admin SDK. Roles come from custom claims set by trusted code, never from user-writable Firestore documents (`authorization-backends.md`). Review enabled providers, email-enumeration settings and App Check in the Firebase console (not visible in the repo, so **Likely**).
- Supabase (`supabase_flutter` 2.18.0): `FlutterAuthClientOptions.authFlowType` defaults to `AuthFlowType.pkce`; the session is persisted through `SharedPreferencesLocalStorage` unless `localStorage` is replaced (Hardening: back it with secure storage). Redirect allow-lists and auth settings belong to `supabase-security`.

## Biometrics and app lock (local_auth)

`local_auth` 3.0.2 (breaking change in 3.0: `AuthenticationOptions` replaced by named parameters such as `biometricOnly` and `persistAcrossBackgrounding`; failures throw `LocalAuthException`) returns a `bool`. It does not unlock a key or prove anything to a server.

- A biometric prompt that only flips an in-memory flag (`if (await auth.authenticate(...)) showBalance()`) is a **UI gate**. On a device the attacker controls, the call can be bypassed; the data it "protects" was readable all along if it sits in prefs or an unencrypted DB. Fine for convenience re-entry (app lock) when the data and tokens are already protected by the OS lock screen and secure storage. A finding when the app presents it as the control for money movement, secrets or admin actions without a server-side check.
- Crypto-bound alternative: store the secret in `flutter_secure_storage` with `AndroidOptions.biometric(enforceBiometrics: true, biometricType: AndroidBiometricType.strongBiometricOnly)` or iOS `IOSOptions(accessControlFlags: [AccessControlFlag.biometryAny])`, so the key itself requires the biometric. For sensitive server operations require step-up authentication (fresh OTP/passkey/password) verified by the server (MASVS-AUTH-3).
- `biometricOnly: true` rejects PIN/pattern fallback. Android needs `FlutterFragmentActivity`, `USE_BIOMETRIC`; iOS needs `NSFaceIDUsageDescription`. Missing setup is a bug, not a vulnerability.
- Do not treat the absence of local biometrics as a vulnerability.

## Severity, false positives, verification

- `clientSecret`/admin credential shipped in the app: **High/Critical** by what it unlocks. Embedded-WebView login of a third-party IdP: **Medium**. ROPC grant or missing PKCE with custom scheme redirect: **Medium/High** (code interception needs a malicious co-installed app). Tokens in prefs: **Medium** (`local-storage.md`). Local-auth-only gate in front of sensitive server actions: **Medium/High** when no server check exists.
- Not findings: `flutter_appauth` with default settings and a public client ID; custom scheme redirect **with** PKCE as the only option the IdP offers (Hardening: add App Links); biometrics used only for local re-entry with tokens in secure storage; Firebase Auth/Supabase publishable keys in code.
- Verify: unit-test that requests contain `code_challenge_method=S256` (inspect the authorization URL in a test IdP); test that a callback without the pending `state` is rejected; after logout assert secure storage, DB and cookies are empty; grep `rg "clientSecret|grant_type|allowInsecureConnections|response_type=token" lib/`.

References: OWASP MASVS-AUTH-1/-2/-3; OWASP Mobile Top 10 2024 M3; RFC 8252, RFC 9700, RFC 7636; https://pub.dev/packages/flutter_appauth, https://pub.dev/packages/local_auth, https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app, https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks.
