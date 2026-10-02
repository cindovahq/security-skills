# Flutter — Android and iOS Project Configuration

## Contents
- Android: manifest and Gradle
- iOS: Info.plist and entitlements
- Build, signing and CI
- Severity, false positives, verification

Flutter generates `android/` and `ios/` once; they are normal native projects that teams edit by hand. The Flutter-created defaults are mostly safe (`MainActivity` exported with only the LAUNCHER filter, cleartext off for target 28+, `flutter create` template with `android:taskAffinity=""`), so findings are usually edits and plugin merges. Always read the **merged** release manifest (`platform-channels-native.md`).

## Android: manifest and Gradle

| Setting | Finding when | Notes |
|---|---|---|
| `android:debuggable="true"` on `<application>` | present in `src/main` | Default is `false`; Flutter release builds are not debuggable unless you set it. Android: not a vulnerability by itself but "makes it easier to gain access" (adb `run-as`, debugger attach). **High** if it ships to production, otherwise Info |
| `android:allowBackup` | `true` (default) plus sensitive plaintext data and no `dataExtractionRules`/`fullBackupContent` | Android guidance: keep Auto Backup and exclude sensitive paths; see `local-storage.md`. **Hardening/Low** alone |
| `android:usesCleartextTraffic="true"` / `networkSecurityConfig` with `cleartextTrafficPermitted="true"`, `<certificates src="user"/>` | in `src/main` | Governs native stacks, not `dart:io` (`network-tls.md`). Attribute is deprecated and ignored when targeting API 38+ |
| `android:exported="true"` | on activities/services/receivers/providers other than the launcher, deep-link and AppAuth redirect activities | API 31+ requires an explicit value when intent filters exist; missing value fails install on Android 12+ |
| `<intent-filter>` with `BROWSABLE` + custom scheme or unverified `https` | handles auth codes or privileged actions | `deep-links.md` |
| `<uses-permission>` | dangerous or unused (`READ_SMS`, `RECORD_AUDIO`, `ACCESS_BACKGROUND_LOCATION`, `MANAGE_EXTERNAL_STORAGE`, `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`) | Hardening unless the feature is absent; store policies also apply |
| `<queries>` | very broad `<package>` lists | Privacy; Hardening |
| `android:allowClearUserData`, `android:largeHeap`, `android:persistent` | rarely security-relevant | Informational |
| `<meta-data android:name="com.google.android.geo.API_KEY" .../>` | key unrestricted | Restrict by package + SHA-1 in Google Cloud console; public by design otherwise |
| `<meta-data android:name="flutter_deeplinking_enabled" android:value="false"/>` | plugin handles links | Check only one handler is active |

Gradle (`android/app/build.gradle(.kts)`, `android/key.properties`, `android/gradle.properties`):

- Release `signingConfig = signingConfigs.getByName("debug")`: the `flutter create` template ships this with a TODO. A release signed with the debug key is a finding for apps distributed outside Google Play (sideloaded, enterprise, other stores): debug keys are generated per machine and not protected.
- `storePassword`, `keyPassword`, `keyAlias` literals in Gradle, committed `key.properties`, `*.jks`/`*.keystore`: secrets in git (`secrets-binary.md`).
- `targetSdk`/`minSdk` from `flutter.targetSdkVersion`: low explicit values change defaults (cleartext default `true` for target 27 and lower; user CAs trusted by default for target 23 and lower; `adb backup` data export for target 30 and lower). Flag `minSdk` below what the app's security features need (for example flutter_secure_storage 11 needs API 24).
- Build types: `isDebuggable = true` in `release`, `buildConfigField` with secrets, `manifestPlaceholders` secrets, `resValue` keys.
- R8/ProGuard affect Java/Kotlin only; Dart is protected by nothing but obfuscation (`resilience-dynamic-code.md`).

## iOS: Info.plist and entitlements

| Key | Finding when | Notes |
|---|---|---|
| `NSAppTransportSecurity` > `NSAllowsArbitraryLoads` = true | in release plist | Disables ATS for native stacks and WebViews (not for `dart:io`); needs App Review justification. **Medium** with real traffic, **Low** if every endpoint is HTTPS |
| `NSAllowsArbitraryLoadsInWebContent` | true | WebViews only; when present (any value), iOS 10+ ignores `NSAllowsArbitraryLoads` |
| `NSExceptionDomains` with `NSExceptionAllowsInsecureHTTPLoads` / `NSIncludesSubdomains` | broad or production domains | Prefer none; keep dev domains in a debug-only plist |
| `NSAllowsLocalNetworking` | true | Local hosts only, but when present it makes iOS 10+ ignore `NSAllowsArbitraryLoads` (same for `NSAllowsArbitraryLoadsForMedia`): read the effective combination before rating |
| `NSPinnedDomains` | absent / present | Pinning option (iOS 14+); see `network-tls.md` |
| `CFBundleURLTypes` > `CFBundleURLSchemes` | OAuth redirect or privileged actions on a custom scheme | `deep-links.md`, `authentication.md` |
| `LSApplicationQueriesSchemes` | any | Only lets the app probe `canOpenURL`; Informational |
| `UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace` | true with sensitive files in Documents | Exposes Documents in Files/Finder |
| `UIBackgroundModes` | unnecessary modes | Hardening/Review risk |
| `NS*UsageDescription` | missing (crash on access) or requesting broad access (`NSLocationAlwaysAndWhenInUseUsageDescription`, `NSContactsUsageDescription`) unused | Privacy/App Review; `NSFaceIDUsageDescription` is required for `local_auth` |
| `FlutterDeepLinkingEnabled` | false when a plugin handles links | Only one handler |

Entitlements (`Runner.entitlements`): `com.apple.developer.associated-domains` lists must match owned domains; `keychain-access-groups` shares Keychain items with other apps of your team (needed for flutter_secure_storage sharing only); `com.apple.security.application-groups` shares containers.

Info that is **public by design** and not a finding: `GoogleService-Info.plist`, bundle identifiers, URL schemes, Apple team IDs, associated domains.

## Build, signing and CI

- CI files (`.github/workflows`, `codemagic.yaml`, `bitrise.yml`, `fastlane/`, `Makefile`, `tool/*.sh`): secrets in plain text, `--dart-define=SECRET=...` on the command line (appears in logs), `flutter build ... --release` without `--obfuscate --split-debug-info` is Informational, symbol files published with the app, third-party actions not pinned by commit SHA.
- Upload and distribution: Play upload key vs app-signing key, App Store Connect API key `.p8`, Shorebird `SHOREBIRD_TOKEN` and patch-signing private key (`resilience-dynamic-code.md`) belong in a secret store.
- Versioning: lock the Flutter SDK version used in CI (`fvm`, `.fvmrc`, `flutter-action` version) and update it; Flutter only issues security fixes for the current stable (`dependencies.md`).

## Severity, false positives, verification

- Debuggable release build: **High**. `NSAllowsArbitraryLoads` with HTTP endpoints: **Medium**. Release signed with the debug key and distributed outside Google Play: **Medium**. Excess permissions, missing `dataExtractionRules`, `LSApplicationQueriesSchemes`: **Hardening/Info**.
- Not findings: `INTERNET` permission; exported launcher activity; Google/Firebase config files; `<queries>` for `PROCESS_TEXT` that Flutter adds; `debug`/`profile` manifests with cleartext or debuggable settings; `android:allowBackup` default alone.
- Verify:

```bash
apkanalyzer manifest debuggable app-release.apk                 # false
apkanalyzer manifest permissions app-release.apk
apkanalyzer manifest print app-release.apk | rg -n "exported|cleartext|networkSecurityConfig|allowBackup|dataExtractionRules"
plutil -p ios/Runner/Info.plist | rg -n "NSAppTransportSecurity|NSAllows|CFBundleURLSchemes|UIFileSharing"
codesign -d --entitlements :- build/ios/iphoneos/Runner.app    # release entitlements
./gradlew :app:lintRelease                                      # AllowBackup, ExportedReceiver, HardcodedDebugMode, ...
```

References: OWASP MASVS-PLATFORM-1/-3, MASVS-CODE-1, MASVS-STORAGE-2; OWASP Mobile Top 10 2024 M8; CWE-489, CWE-16, CWE-927; https://developer.android.com/guide/topics/manifest/application-element, https://developer.android.com/privacy-and-security/risks/android-debuggable, https://developer.android.com/privacy-and-security/risks/android-exported, https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity.
