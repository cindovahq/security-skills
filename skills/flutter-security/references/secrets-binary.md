# Flutter — Secrets and Everything Else in the Binary

## Contents
- What ships in the app
- Where secrets hide in Flutter projects
- Obfuscation is not protection
- Keys that are public by design
- Keys that are findings
- Fix patterns
- Severity, false positives, verification

## What ships in the app

An APK/AAB/IPA is a zip the user (and an attacker) owns. Nothing the app can read at runtime is secret from the person holding the device.

| Mechanism | Where it ends up in a release build | Extractable? |
|---|---|---|
| String literal or `const` in Dart | AOT snapshot (`lib/<abi>/libapp.so` on Android, `Frameworks/App.framework/App` on iOS) | Yes, `strings` is enough |
| `--dart-define=K=V`, `--dart-define-from-file=*.json\|*.env` | Compile-time constants read via `String.fromEnvironment` (const only), baked into the snapshot | Yes |
| `flutter_dotenv` `.env` listed under `flutter: assets:` | Plain-text file in `assets/flutter_assets/.env` (APK) or `flutter_assets/` (iOS) | Yes, unzip |
| Any file under `assets:` (JSON config, service accounts, `.pem`) | `flutter_assets/` | Yes |
| `google-services.json`, `GoogleService-Info.plist`, `firebase_options.dart` | Android resources, iOS bundle, snapshot | Yes (public by design, see below) |
| Android `strings.xml`, `BuildConfig`, Gradle `manifestPlaceholders`, iOS `Info.plist`, `.xcconfig` values | Manifest/resources/plist | Yes |
| Flutter web (`flutter build web`) | `main.dart.js` or `.wasm` served to every visitor | Yes (`flutter-web.md`) |

The `flutter_dotenv` README says it plainly: "Do not store secrets (API keys, tokens, passwords) in your .env file. Flutter assets are bundled into the app binary and can be extracted by anyone with access to the build."

## Where secrets hide in Flutter projects

```bash
grep -rnE "(api|secret|token|passw(or)?d|private)[_-]?(key|token)?['\"]? *[:=] *['\"][A-Za-z0-9_\-\/+=.]{12,}" lib/ tool/ scripts/ android/ ios/ --include=*.dart --include=*.kts --include=*.gradle --include=*.xml --include=*.plist --include=*.sh --include=*.json
grep -n "assets:" -A12 pubspec.yaml            # .env, *.json, *.pem, serviceAccount*.json?
git ls-files | grep -iE "\.env|key\.properties|\.jks|\.keystore|\.p12|\.p8|service.?account|secrets?\.json|google-services|GoogleService"
grep -rn "String.fromEnvironment\|dotenv\|dart-define" lib/ tool/ .github/ codemagic.yaml fastlane/ Makefile 2>/dev/null
```

Also check CI files and `tool/build_*.sh` for `--dart-define=...=<value>` with real values, release signing in `android/app/build.gradle(.kts)` (`storePassword`, `keyPassword` literals, `key.properties` committed), `ios/ExportOptions.plist`, App Store Connect `.p8` keys, `SHOREBIRD_TOKEN`, and Shorebird `--private-key-path` files.

## Obfuscation is not protection

`flutter build apk --obfuscate --split-debug-info=<dir>` renames Dart symbols in the snapshot. Flutter's own docs: obfuscation "does _not_ encrypt resources nor does it protect against reverse engineering. It only renames symbols", and "It is a **poor security practice** to store secrets in an app". String literals, `--dart-define` values, assets, URLs and logic remain readable. Obfuscation is supported for apk/appbundle/ipa/ios/macos/linux/windows, not for web. Never accept "the app is obfuscated" as a mitigation for a secret in the binary. It is worth doing for IP hygiene and smaller binaries; keep the `--split-debug-info` output (needed by `flutter symbolize`) out of the shipped artifact. Details: `resilience-dynamic-code.md`.

## Keys that are public by design

Not findings by themselves (state the control that protects them):

- **Firebase API keys** (`google-services.json`, `GoogleService-Info.plist`, `firebase_options.dart`). Firebase docs: they "only identify your Firebase project and app to those services"; access is enforced by Security Rules, IAM and App Check, and "it's safe to include them in your code or configuration files" provided the key is restricted to Firebase APIs. **Exception to check:** a key whose API restrictions include the Generative Language API, or a Gemini Developer API key, which "should never be included in your code or configuration files".
- **Supabase** publishable key (`sb_publishable_...`) or legacy anon key (`Supabase.initialize(url:, publishableKey:)`, the `anonKey` parameter is deprecated in `supabase_flutter` 2.18). RLS is the control; review with `supabase-security`.
- Stripe publishable keys (`pk_`), Sentry DSNs, analytics/measurement IDs, Mapbox public tokens, Algolia search-only keys, public OAuth/OIDC **client IDs** and issuer URLs, Google Maps keys restricted by Android package + SHA-1 / iOS bundle ID, App Check site keys.
- API base URLs, feature flags, flavor names, timeouts passed by `--dart-define`.

## Keys that are findings

Server-side credentials in the app: Stripe `sk_`/restricted secret keys, Supabase `service_role`/`sb_secret_` keys, Firebase Admin/service-account JSON, OAuth client **secrets** for public clients, AWS/GCP/Azure keys, database URLs, SMTP/SMS/email-provider keys, webhook or JWT signing secrets, admin or internal API tokens, LLM provider keys (cost abuse), CI tokens, upload/signing keystores and their passwords, Shorebird signing private keys.

## Fix patterns

1. **Move the secret behind your backend.** The app calls your API with the user's token; the server holds the provider key and enforces per-user limits. For LLM or paid APIs, proxy and rate-limit per user.
2. **Use per-user, short-lived credentials** (OAuth access tokens, signed upload URLs, Firebase Auth + Rules + App Check) instead of one shared app key.
3. **Restrict what must ship:** Google/Maps keys by package name + signing SHA-1 and bundle ID; Firebase keys to Firebase APIs; turn on App Check enforcement.
4. **Rotate** any secret that was ever built into a released binary or committed. Removing it from the next build does not revoke copies already distributed. Purge from git history if the repo is shared.
5. Keep keystores and passwords out of git: `android/key.properties` in `.gitignore`, read in Gradle from the file or CI secrets; never `signingConfig = signingConfigs.getByName("debug")` for release (the `flutter create` template does this with a TODO).
6. If a build-time value truly is public configuration, say so by naming (`API_BASE_URL`) and keep `.env` out of `assets:`; prefer `--dart-define-from-file=config/prod.json` for non-secret config.

## Severity, false positives, verification

- Privileged server credential in a shipped app: **Critical** if it grants broad data/admin/billing access, **High** for narrower internal tokens. App-signing keystore plus passwords in a shared repo: **High**; an upload key alone is lower (Medium/Low) when Play App Signing is used, because publishing still needs Play Console access. Source maps (web): Low.
- Not findings: Firebase/Supabase/Stripe-publishable keys with proper rules; `.env.example` placeholders; `google-services.json` in the repo; secrets read only by server code in a monorepo `functions/` folder.
- **Verify:** build release, then unzip and search. A secret that still appears is exposed whatever the obfuscation.

```bash
flutter build apk --release --obfuscate --split-debug-info=build/symbols
mkdir -p /tmp/apk && unzip -qo build/app/outputs/flutter-apk/app-release.apk -d /tmp/apk
ls /tmp/apk/assets/flutter_assets                                     # unexpected .env/.json/.pem?
grep -rIl "<first 8 chars of the secret>" /tmp/apk                  # expect nothing
strings -n 12 /tmp/apk/lib/arm64-v8a/libapp.so | grep -E "sk_|secret|token|Bearer|https?://" | sort -u | head -50
```

References: OWASP MASVS-STORAGE and MASVS-CODE; OWASP Mobile Top 10 2024 M1 (Improper Credential Usage); CWE-798, CWE-312; https://docs.flutter.dev/deployment/obfuscate, https://firebase.google.com/docs/projects/api-keys, https://pub.dev/packages/flutter_dotenv, https://developer.android.com/privacy-and-security/risks/hardcoded-cryptographic-secrets.
