---
name: flutter-security
description: Security review and secure-coding guidance for Flutter and Dart apps on Android and iOS, plus Flutter web builds (Flutter 3.x, Dart 3.x). Use when auditing, reviewing or hardening a Flutter codebase, or when writing or changing Dart code that handles API keys, tokens, local storage, HTTP and TLS, OAuth login, biometrics, deep links, WebViews, platform channels, AndroidManifest.xml or Info.plist. Triggers on pubspec.yaml with the flutter SDK, lib/main.dart, AndroidManifest.xml, ios/Runner/Info.plist, flutter_secure_storage, dio, webview_flutter, firebase_core or supabase_flutter. Covers secrets in the app binary (dart-define, flutter_dotenv, obfuscation), insecure storage and backups, cleartext traffic, badCertificateCallback and pinning, flutter_appauth PKCE and redirects, local_auth gating, Firebase rules and App Check, App Links, exported components, ATS, logging, screenshots, root detection, Shorebird and pub supply chain. Supabase RLS belongs to supabase-security.
license: Apache-2.0
metadata:
  author: Cindova Technologies
  homepage: https://github.com/cindovahq/security-skills
  version: "1.0.0"
  status: beta
  framework-versions: "Flutter 3.x (3.47.6 latest stable, 2026-10-01), Dart 3.x (3.13.5), flutter_secure_storage 10.x-11.x, local_auth 3.x, flutter_appauth 12.x, dio 5.x, webview_flutter 4.x, firebase_app_check 0.4.x"
  last-verified: "2026-10-02"
---

# Flutter Security

Find, explain, fix and verify security issues in Flutter apps, and write Flutter code that does not introduce them.

All paths in this skill (`references/...`) are relative to the directory containing this `SKILL.md`.

## Modes

- **Review mode**: audit, security review, pre-release or pentest prep, "is this app secure?". Follow the workflow below and produce findings.
- **Build mode**: writing or changing Dart or platform code. Apply the [build-mode guardrails](#build-mode-guardrails) and load only the reference for the area you touch.

If the `appsec-review` skill is installed it owns the methodology and report format; this skill supplies the Flutter knowledge. Backends have their own skills: `supabase-security` (RLS, grants, storage policies, Supabase auth config), `nestjs-security`, `nodejs-security`, `django-security`, `laravel-security`. React Native, Kotlin/Swift-only and Dart server apps are out of scope.

## The Flutter security model in one paragraph

A Flutter app is a public client. The release APK/IPA contains the Dart AOT snapshot, every asset and every `--dart-define` value, and the user (or an attacker) owns the device, so nothing in the app is secret and no check in Dart is a trust boundary. Obfuscation renames symbols and nothing else. Real risks cluster in: server credentials shipped in the binary; tokens and PII stored in plaintext or leaked through logs, backups and crash reports; transport security (and the fact that `dart:io` traffic ignores Android Network Security Config and iOS ATS); disabled TLS validation; OAuth redirect handling; deep links and WebView bridges that carry untrusted input into privileged code; Firebase rules or APIs that do not enforce authorization; manifest and plist misconfiguration; and stale dependencies. Mobile reports are noisy: most "missing hardening" items are not vulnerabilities (see false positives).

## Review workflow

### 1. Confirm the stack and versions

1. Identify targets from `pubspec.yaml` and the folders present: `android/`, `ios/`, `web/`, `macos/`, `linux/`, `windows/`. Review each shipped target; desktop shares the Dart checks.
2. Read **locked** versions from `pubspec.lock` (and `sdks:`), not ranges: `flutter_secure_storage`, `dio`/`http`, `flutter_appauth`, `local_auth`, `webview_flutter`/`flutter_inappwebview`, `go_router`/`app_links`, Firebase and Supabase packages, `sentry_flutter`.
3. Support status (checked 2026-10-02): Flutter 3.47.6 with Dart 3.13.5 is the latest stable. Flutter publishes security fixes only for the current stable, there is no LTS, and the pub ecosystem has very few advisories. See `references/dependencies.md`.
4. Find the backend: own API, Firebase (`firebase.json`, `firestore.rules`, `storage.rules`), Supabase. Client-only authorization findings stay **Likely** until the server side is seen.
5. Note what the repo cannot show: Firebase console settings, App Check enforcement, IdP redirect configuration, store listings, CDN/hosting headers.

### 2. Map the attack surface

- **Secrets and config:** `lib/**/config*.dart`, `.env*`, `pubspec.yaml` `assets:`, `--dart-define*` in scripts and CI, `firebase_options.dart`, Gradle signing.
- **Data at rest:** `shared_preferences`, `flutter_secure_storage`, Hive/sqflite/drift, files, caches, backups.
- **Network:** Dio/`http` clients and interceptors, `HttpClient`/`HttpOverrides`, WebSockets, Network Security Config, ATS keys.
- **Identity:** login flows, `flutter_appauth`, Firebase/Supabase auth, token refresh, `local_auth`, route guards.
- **Inputs from outside:** deep/app links, push payloads, intents, WebView messages, files, QR codes, clipboard.
- **Native bridge:** `MethodChannel`s, Kotlin/Swift sources, plugins, merged manifest, exported components.
- **Distribution:** signing, CI, Shorebird, remote config, dependency sources.

### 3. Review each area

Load the reference for each area as you reach it, not all up front.

| Area (MASVS-v2.1.0) | Reference | Start by looking for |
|---|---|---|
| Secrets in binary (CODE, STORAGE) | `references/secrets-binary.md` | `String.fromEnvironment`, `flutter_dotenv`/`.env` under `assets:`, literals like `apiKey`, service accounts, keystore passwords, which keys are public by design |
| Local storage, backups, crypto (STORAGE, CRYPTO) | `references/local-storage.md` | Tokens in `SharedPreferences`/Hive/sqflite, `flutter_secure_storage` options, `allowBackup`, `encrypt` AES defaults, static keys/IVs, `Random()` |
| Network and TLS (NETWORK) | `references/network-tls.md` | `http://`, `badCertificateCallback`, `HttpOverrides`, cleartext in NSC/ATS, pinning, `dart:io` ignoring platform policy, Authorization sent to any host |
| Authentication (AUTH) | `references/authentication.md` | `flutter_appauth` options, `clientSecret`, custom scheme redirects, token storage and logout, `local_auth` as a gate, Firebase/Supabase session handling |
| Authorization and backends (AUTH) | `references/authorization-backends.md` | Role checks in Dart, hidden admin screens, Firestore/RTDB/Storage rules, Cloud Functions without auth, App Check provider, client-sent role/tenant |
| Deep links and intents (PLATFORM, CODE) | `references/deep-links.md` | Intent filters, `autoVerify`, associated domains, `go_router`/`app_links` params reaching sinks, link-triggered actions, `url_launcher` |
| WebViews (PLATFORM) | `references/webviews.md` | `addJavaScriptChannel`/`addJavaScriptHandler`, `loadRequest(userUrl)`, `runJavaScript` string building, file access, `proceed()` on TLS errors |
| Platform channels and native code (PLATFORM, CODE) | `references/platform-channels-native.md` | `MethodChannel` handlers, `Runtime.exec`, exported providers/receivers, trust-all `TrustManager`, merged permissions, FFI |
| Manifest, plist, Gradle (PLATFORM, CODE) | `references/platform-config.md` | `debuggable`, `exported`, `allowBackup`, `usesCleartextTraffic`, `NSAllowsArbitraryLoads`, URL schemes, debug-key release signing |
| Logs, privacy, UI (STORAGE, PLATFORM, PRIVACY) | `references/logging-privacy-ui.md` | `print`/`debugPrint`/Dio loggers in release, PII in Crashlytics/Sentry, `FLAG_SECURE`, clipboard, keyboard flags |
| Resilience, dynamic code (RESILIENCE) | `references/resilience-dynamic-code.md` | Obfuscation claims, root/jailbreak packages, attestation, Shorebird signing and tokens, server-driven UI, downloaded code |
| Dependencies and supply chain (CODE-3) | `references/dependencies.md` | Flutter/Dart versions, `pubspec.lock`, `ignored_advisories`, unpinned `git:` deps, abandoned packages, OSV scan, scanner noise |
| Flutter web | `references/flutter-web.md` | Source maps, secrets in `build/web`, `innerHTML`/`HtmlElementView`/`postMessage`, token storage, headers |
| Verification | `references/verification.md` | Release-artifact greps, `apkanalyzer`, tests that prove each fix, rules tests |

### 4. Classify and report

Every finding needs a file and line, the code or config, and the path from untrusted input (or attacker position) to impact. Use the [severity calibration](#severity-calibration) and the [reporting rules](#evidence-and-reporting-rules).

### 5. Remediate and verify (when asked to fix)

Explain the issue first. Make the smallest change that uses the platform's mechanism (move the secret behind the backend, use secure storage, delete the TLS bypass, allow-list the link, tighten the rule). Then verify with `references/verification.md`: inspect the **release** artifact, run a test that fails before and passes after, and search for sibling occurrences.

## High-signal patterns

Investigation signals, not findings. Trace each before reporting.

```text
# Secrets / config
fromEnvironment(  dotenv.  dart-define  assets:\n - .env  apiKey  secret  token  password  BEGIN PRIVATE  serviceAccount  storePassword  key.properties
# Storage / crypto
SharedPreferences  Hive.openBox  openDatabase  writeAsString  getExternalStorage  allowBackup  AESMode.ecb  AESMode.sic  IV.fromUtf8  allZerosOfLength  Random(  md5(  sha1(
# Network / TLS
http://  ws://  badCertificateCallback  HttpOverrides.global  PROCEED  .proceed(  allowInsecureConnections  findProxy  cleartextTrafficPermitted  NSAllowsArbitraryLoads  certificates src="user"
# Auth
clientSecret:  grant_type=password  response_type=token  isLoggedIn  isAdmin  role ==  authenticate(  biometricOnly  jwtDecode  JwtDecoder
# Links / WebView / bridge
uriLinkStream  getInitialLink  state.uri  queryParameters  pathParameters  launchUrl(  addJavaScriptChannel  addJavaScriptHandler  loadRequest(  loadHtmlString  runJavaScript(  MethodChannel(
# Manifest / plist / firebase
android:debuggable  android:exported  usesCleartextTraffic  CFBundleURLSchemes  UIFileSharingEnabled  allow read, write: if true  request.auth != null  AndroidProvider.debug  AndroidDebugProvider
# Logging / UI
print(  debugPrint(  LogInterceptor  sendDefaultPii  setUserIdentifier  Clipboard.setData  FLAG_SECURE
```

## Common false positives

Do not report these without further evidence:

- **Firebase API keys** in `google-services.json`, `GoogleService-Info.plist`, `firebase_options.dart`: public by design (Firebase docs); the controls are Security Rules, IAM and App Check. Check the key is restricted to Firebase APIs and is not a Gemini/Generative Language key. **Supabase publishable/anon keys**, Stripe `pk_`, Sentry DSNs, analytics IDs, restricted Maps keys and OAuth client IDs: same.
- **Missing root/jailbreak detection, obfuscation, anti-debugging, pinning or tamper detection.** MASVS-RESILIENCE: their absence "does not in itself constitute a vulnerability" (current text; v2.1.0: "does not necessarily cause vulnerabilities"). Hardening/Info only, tied to a stated threat.
- **`android:allowBackup` default** or missing `dataExtractionRules` alone. Auto Backup is encrypted; report only with plaintext sensitive data and no exclusions.
- **Scanner output on `libapp.so`** (no RELRO, stack canary, fortified functions; `_strlen`/`_malloc` use; iOS `@rpath`; CBC/PKCS7 from ExoPlayer HLS) and "app can read/write external storage", `file.delete()` insecure deletion, image-picker storage access. All listed on Flutter's `security-false-positives` page (NX is listed there as obsolete: report it only if seen with a current stable SDK).
- **Exported `MainActivity`** with the launcher filter; AppAuth `RedirectUriReceiverActivity` exported; `INTERNET` permission; `LSApplicationQueriesSchemes`.
- **Cleartext or `badCertificateCallback => true` limited to debug builds** (`src/debug`, `kDebugMode`, separate flavor), and Dio's documented pinning idiom (`badCertificateCallback => true` paired with `validateCertificate` fingerprint checks and `withTrustedRoots: false`; it checks after the request is sent, so at most an Informational note on credentialed endpoints).
- **`print`/`debugPrint` inside `kDebugMode` or `assert`**; logging of non-sensitive state.
- **`flutter_secure_storage` for tokens**, `local_auth` for local re-entry when tokens are already in secure storage.
- **A WebView loading only a constant first-party `https` URL** with an allow-listing `NavigationDelegate`; `url_launcher` opening https links externally.
- **Client-side role checks that the server also enforces** (defense in depth); `.env.example` placeholders; `kDebugMode`-guarded dev tooling.
- **Old but unaffected packages.** `flutter pub outdated` is not a vulnerability list. Cite an advisory whose range matches the locked version and a reachable feature.
- **Proxy-unfriendliness or "can't intercept with Burp".** Not a control and not a finding.

## Severity calibration

Common mis-ratings to avoid:

- **Server credential in the app** (service-role/secret key, admin token, Stripe `sk_`, service-account JSON): **Critical/High** by what it unlocks. It is exposed regardless of obfuscation; rotation is the fix.
- **Open Firebase rules** (`if true`, or `auth != null` on shared data) or a backend that trusts client-sent roles: **Critical/High**. Client-only checks with an unreviewed server: **Likely**, never closed as "frontend only".
- **TLS validation disabled in release** (`badCertificateCallback` returning `true`, `proceed()`): **High**. Cleartext API carrying tokens: **High**. Permissive NSC/ATS with all Dart traffic on HTTPS: **Low/Medium**. Missing pinning: **Hardening**.
- **Tokens in `shared_preferences`**: **Medium** (**High** for long-lived refresh tokens in sensitive apps). Missing biometric/`FLAG_SECURE`/clipboard flags: **Hardening**.
- **JS bridge exposed to untrusted or user-chosen content**: **High**. User URL in a WebView without a bridge: **Medium/Low**. Link-triggered state changes without confirmation: **Medium/High**.
- **`debuggable="true"` in a shipped build**: **High**. `allowBackup`, extra permissions, `NSAllowsArbitraryLoads` with HTTPS-only endpoints: **Low**.
- **Local-auth-only gate** protecting server-side actions: **Medium/High** when no server check exists. Leaked Shorebird token or patch-signing key: **High/Critical**.
- **Dependency findings** are rated by the reachable advisory, not by age or the Flutter engine CVE headline.

## Build-mode guardrails

1. **No secrets in the app.** Only public configuration in code, `--dart-define-from-file` or assets. Server credentials live behind your backend; use per-user tokens, App Check and rules. Obfuscation is optional hygiene.
2. **Store tokens and secrets in `flutter_secure_storage`**; keep `shared_preferences` for non-sensitive flags. Clear storage, caches, DBs and WebView cookies on logout. Exclude sensitive paths from backups with `dataExtractionRules`.
3. **HTTPS only**, validated base URLs, never a trust-all callback. Pin your own endpoints only if the threat model warrants it, with a backup pin and a rotation plan. Attach `Authorization` only to your hosts.
4. **OAuth:** system browser, PKCE, no client secret, claimed `https` redirects where possible, validate `state`/`nonce`, `allowInsecureConnections` left false.
5. **Authorize on the server and in rules.** Treat every Dart role/flag check as UX. Derive identity and tenant from the verified token, never from request fields.
6. **Parse links into typed objects and allow-list.** No link-supplied URLs in WebViews, API hosts or file paths; confirm sensitive link actions.
7. **WebViews:** JavaScript off unless needed, no channels on untrusted content, navigation allow-list, no `proceed()`, debugging only in `kDebugMode`.
8. **Platform channels:** validate arguments natively, no generic exec primitives, minimal exported components, read the merged manifest.
9. **No sensitive logging.** Guard logs with `kDebugMode`, scrub crash reports and analytics, no request/response bodies in release.
10. **Use `Random.secure()`**, authenticated encryption (GCM) with fresh IVs and keys from the platform keystore; never hardcode keys or IVs.
11. **Keep Flutter, Dart and packages current**, commit `pubspec.lock`, run advisory checks (`flutter pub get`, `osv-scanner`), review native dependencies and build hooks.
12. **Add tests for each boundary you write** (hostile deep links, rejected certificates, logout wipe, rules tests) and inspect the release artifact before shipping.

## Evidence and reporting rules

Use these when `appsec-review` is not installed.

- **Confirmed**: source-to-impact path fully traced, or safely demonstrated. **Likely**: strong evidence with one unverified condition (server check, console setting, hosting headers) named explicitly. **Hardening**: no demonstrated exploit, stronger control advised. **Informational**: context only.
- **Severity** = impact x exploitability x required privileges x exposure; do not raise it for scary keywords. Say who the attacker must be (network attacker, other app on the device, malicious link, device owner, any signed-in user).
- Finding format: `### F-01 [SEVERITY] Title - Confirmed|Likely|Hardening`, then Location (`lib/services/api.dart:42`), Evidence, Impact, Preconditions (platform, SDK/package versions, build mode), Fix (Flutter-native code), Verify, Refs (MASVS control, CWE, doc link).
- Never invent files, versions, packages, API names or CVE IDs. Redact secrets (`sk_****`) and recommend rotation without testing them. State when no runtime verification was performed and which target (Android, iOS, web) was reviewed.
- Test only authorized apps and backends, on test builds and accounts, non-destructively.

## References

- Flutter security and false positives: https://docs.flutter.dev/security, https://docs.flutter.dev/reference/security-false-positives; obfuscation: https://docs.flutter.dev/deployment/obfuscate
- OWASP MASVS v2.1.0 and MASTG: https://mas.owasp.org/MASVS/, https://mas.owasp.org/MASTG/; OWASP Mobile Top 10 2024: https://owasp.org/www-project-mobile-top-10/
- Android security risks and configuration: https://developer.android.com/privacy-and-security/risks, https://developer.android.com/privacy-and-security/security-config
- Apple App Transport Security and URL schemes: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity
- Firebase API keys, rules and App Check: https://firebase.google.com/docs/projects/api-keys, https://firebase.google.com/docs/firestore/security/insecure-rules, https://firebase.google.com/docs/app-check
- OAuth for native apps and the Security BCP: https://www.rfc-editor.org/rfc/rfc8252, https://www.rfc-editor.org/rfc/rfc9700
- pub advisories: https://dart.dev/tools/pub/security-advisories
