# Flutter — Authorization Lives on the Server (and in Firebase Rules)

## Contents
- The client is not a trust boundary
- Review checklist
- Firebase: Firestore, Realtime Database, Storage rules
- Cloud Functions and the Admin SDK
- App Check
- Supabase and custom backends
- Severity, false positives, verification

## The client is not a trust boundary

Every Dart `if (user.isAdmin)`, hidden route, disabled button, feature flag, entitlement check or decoded JWT claim runs on a device the user controls. It can be skipped or edited (a rebuilt app, a hooked function, or simply a direct API call with a stolen/own token). These are UX conveniences. A Flutter app's real authorization boundary is the API, the database rules or the backend functions it calls.

Reviewing the Flutter repo alone usually shows only the missing half. Rate client-only findings **Likely**, name the server evidence that is missing ("is `GET /v1/orders/{id}` scoped to the caller?"), and review the backend with its own skill if it is in scope (`nestjs-security`, `nodejs-security`, `django-security`, `laravel-security`, `supabase-security`).

## Review checklist

- Screens and routes gated by `user.role == 'admin'`, `isStaff`, `featureFlags['x']`, `go_router` `redirect` guards. For each, find the API calls the screen makes and ask what the server checks.
- IDs taken from route parameters or deep links (`/orders/:id`, `state.pathParameters['id']`) passed straight to API calls: object-level authorization (BOLA/IDOR) is the server's job; a hidden or unlinked screen is not protection.
- Role or tenant sent by the client (`{"role": "admin"}`, `orgId` in bodies, `x-user-id` headers). The server must derive identity and tenant from the verified token.
- Mass assignment: `toJson()` of the full user model sent to `PUT /me`, so a user can include `role`, `isVerified`, `credits`.
- Entitlements and payments: purchase state kept in prefs or checked only in Dart (`isPremium`); in-app purchase receipts must be validated server-side.
- Remote Config / feature flags used as access control: Firebase Remote Config values and any client-fetched JSON are readable by every user.
- Admin tooling shipped in the consumer app. Not a vulnerability by itself if the server enforces roles; **Likely** otherwise.
- Secrets used to call "privileged" APIs from the app (`secrets-binary.md`): that is a credential leak, not authorization.

## Firebase: Firestore, Realtime Database, Storage rules

Firebase's client SDKs talk directly to the database, so **Security Rules are the authorization layer**; the Firebase API key does not protect data. Files are normally `firestore.rules`, `database.rules.json`, `storage.rules` referenced from `firebase.json`; rules edited only in the console are not visible in the repo (**Likely**).

Fix-needed patterns (from Firebase's "Fix insecure rules" guide):

```text
// Firestore / Storage: open to the internet
match /{document=**} { allow read, write: if true; }
// Realtime Database
{ "rules": { ".read": true, ".write": true } }
// Authenticated but not authorized: any signed-in user (including anonymous sign-in)
allow read, write: if request.auth != null;
```

- Console-created Firestore databases default to deny; test-mode and tutorial rules are what ship in the repo. A shallower RTDB `.read`/`.write` grants access to everything below it because the rules "cascade".
- Owner-scoped example: `allow read, delete: if request.auth.uid == resource.data.author_uid;` and `allow create: if request.auth.uid == request.resource.data.author_uid;` plus an `update` rule that checks both `resource.data` and `request.resource.data` so ownership cannot be reassigned.
- **Role from a user-writable document** (`get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'` while users can write their own `users/{uid}` document) is privilege escalation. Use custom claims set by trusted code (`request.auth.token.admin == true`) or a document only the Admin SDK can write.
- Restrict writable fields: `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName', 'photoUrl'])` for profile updates.
- Validate shape and size on write (`request.resource.data.keys().hasOnly([...])`, types, string lengths); RTDB uses `.validate`.
- Storage: scope paths to the user or tenant, and bound uploads, e.g. `request.resource.size < 5 * 1024 * 1024 && request.resource.contentType.matches('image/.*')`. Public-read buckets holding private documents are a finding.
- **Rules are not filters.** A client query such as `.where('orgId', isEqualTo: myOrg)` is not a security control unless the rule also requires `resource.data.orgId == request.auth.token.orgId`; otherwise the query can be rewritten.
- Multi-tenancy: tenant ID must come from the token or a membership document the user cannot edit.

Verify with the Firebase emulator and `@firebase/rules-unit-testing` (`initializeTestEnvironment`, `assertFails`, `assertSucceeds`): unauthenticated read fails, user A cannot read/write user B's document, a non-admin cannot set `role`, oversized uploads fail. Run with `firebase emulators:exec --only firestore "npm test"`.

## Cloud Functions and the Admin SDK

- Server SDKs and Admin credentials **bypass Security Rules** (Firebase docs: use IAM for them). Every callable or HTTP function must authenticate the caller itself: callable functions expose `request.auth` (check it and its claims), HTTP functions must verify the ID token (`getAuth().verifyIdToken`) and then authorize the object.
- Functions that take a `uid` or `docId` from the request body and use Admin access are IDOR when they do not compare it with the verified caller.
- Service-account JSON in the app or `assets/` is a Critical credential leak.

## App Check

`firebase_app_check` 0.4.8 attests that requests come from your genuine app instance (Play Integrity on Android and DeviceCheck on Apple by default, App Attest opt-in, reCAPTCHA on web). It is abuse reduction, **not** user authorization, and it does not replace rules.

- Check that enforcement is turned on per product in the console (not visible in the repo, **Likely**).
- `activate(providerAndroid: ..., providerApple: ...)` is the current API (`androidProvider`/`appleProvider` are deprecated). Debug providers (`AndroidDebugProvider`, `AppleDebugProvider`, or the older `AndroidProvider.debug` / `AppleProvider.debug`) in release code give no genuine attestation (tokens are rejected once enforcement is on, so App Check is either broken or left unenforced); a hardcoded `debugToken` shipped in the app is an outright bypass. Limit them to debug builds with registered debug tokens (`kDebugMode`, flavors).
- Default `AppleDeviceCheckProvider`; `AppleAppAttestProvider` is stronger where iOS 14+ is the minimum.

## Supabase and custom backends

- Supabase from Flutter: the publishable (anon) key in code is expected; **RLS and grants are the control**. Delegate to `supabase-security` (tables without RLS, `service_role` in the app, storage policies, `SECURITY DEFINER` functions).
- Custom REST/GraphQL: see the backend's skill. Flutter-side signs: `dio` calls with ID parameters from user input, GraphQL operations that expose admin mutations, API paths containing `/admin`, `/internal`, `/debug`.
- `go_router` redirects and `onEnter` are navigation logic only.

## Severity, false positives, verification

- Open Firestore/RTDB/Storage rules on data users expect private: **Critical/High** (whole-database read/write by anyone with the project ID). `request.auth != null` on multi-user data: **High** (any signup reads everyone's data). Client-only role check with an unreviewed API: **Likely**, High if the screen performs privileged writes or reads. App Check not enforced: **Hardening**.
- Not findings: public-read rules on genuinely public content (catalog, blog) with owner-only writes; client-side role checks that are also enforced server-side (defense in depth); Firebase/Supabase publishable keys; Remote Config values that are non-sensitive UI toggles.
- Verify: rules unit tests as above; call the API with a second user's token for the first user's IDs (test accounts, staging only), expect 403/404; call privileged endpoints with a low-privilege token; confirm role claims cannot be changed through any client-writable path.

References: OWASP MASVS-AUTH-1, MASVS-PLATFORM-1; OWASP Mobile Top 10 2024 M3; OWASP API Security Top 10 2023 API1/API5; CWE-285, CWE-639, CWE-862; https://firebase.google.com/docs/firestore/security/insecure-rules, https://firebase.google.com/docs/firestore/security/rules-query, https://firebase.google.com/docs/rules/unit-tests, https://firebase.google.com/docs/app-check/flutter/default-providers.
