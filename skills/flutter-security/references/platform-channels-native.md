# Flutter — Platform Channels, Native Code and Plugins

## Contents
- Where the trust boundary is
- Channel handlers
- Native Android code to read
- Native iOS code to read
- Plugins and merged manifests
- FFI and dynamic loading
- Severity, false positives, verification

## Where the trust boundary is

Dart code and the platform code of the same app are one trust domain; the boundary that matters is between the app and **untrusted data**: other apps (intents, URLs, files, share targets, clipboard), the network, WebView content, NFC/BLE peers and the user. A `MethodChannel` call is just a function call, but arguments often originate from those untrusted sources: a deep-link parameter forwarded to a `launchUrl`-style channel, a WebView message relayed to a native file API, a push payload turned into an Intent.

Review `android/app/src/main/{kotlin,java}/**`, `ios/Runner/*.swift|m`, custom plugins under `packages/` or `plugins/`, and `GeneratedPluginRegistrant` is generated, ignore it.

## Channel handlers

Search: `MethodChannel(`, `EventChannel(`, `BasicMessageChannel(`, `setMethodCallHandler`, `invokeMethod`, `FlutterMethodChannel`, `MethodCallHandler`.

- Validate type, range and allow-listed values for every argument (`call.argument<String>("path")` can be null or anything). Pigeon-generated typed channels remove type confusion, not semantic validation.
- Do not let a channel become a generic "run X" primitive: `Runtime.getRuntime().exec(cmd)`, `ProcessBuilder`, reflection by class name, `Class.forName(call.argument("cls"))`, SQL built by string concatenation, raw file paths, arbitrary `Intent` actions/URIs, arbitrary `PendingIntent`s.
- File parameters: canonicalize and require the result to stay under an intended directory (`File.canonicalPath.startsWith(baseDir)`); Dart-side `p.join` does not make a path safe.
- Responses and logs: do not return or log secrets; channel traffic is visible in logcat/`os_log` if you print arguments.
- Direction native-to-Dart: data from intents/URLs/NFC forwarded into Dart is untrusted in Dart too (`deep-links.md`).
- Background entrypoints (`@pragma('vm:entry-point')`, WorkManager/notification callbacks) run without UI guards; apply the same authorization.

## Native Android code to read

| Look for | Why |
|---|---|
| `Intent(Intent.ACTION_VIEW, Uri.parse(arg))`, `startActivity(intent)` with implicit intents built from channel/URL data | Implicit-intent hijacking, intent redirection (Android risk pages) |
| `PendingIntent.getActivity(..., FLAG_MUTABLE)` wrapping an implicit/empty intent | Another app can fill in the intent (lint: `UnsafeIntentLaunch`, `MutableImplicitPendingIntent`) |
| `<provider android:exported="true">`, `FileProvider` with `<root-path>` or `path="."`, `grantUriPermissions` broadly | File exposure (lint: `ExportedContentProvider`, `GrantAllUris`) |
| Exported `Service`/`BroadcastReceiver` without `android:permission`; dynamic `registerReceiver` without `RECEIVER_NOT_EXPORTED` | Other apps can drive app logic (`ExportedReceiver`, `ExportedService`) |
| `X509TrustManager` with empty `checkServerTrusted`; `HostnameVerifier { _, _ -> true }`; `SSLContext` with trust-all | TLS bypass in native SDK code (`TrustAllX509TrustManager`, `BadHostnameVerifier`; Android risk pages "Unsafe X509TrustManager/HostnameVerifier") |
| `webView.settings.javaScriptEnabled = true`, `addJavascriptInterface`, `allowFileAccess*` in native code | Same issues as `webviews.md` |
| `Context.MODE_WORLD_READABLE`, files in external storage, `getExternalFilesDir` for secrets | `sensitive-data-external-storage` risk page; lint `WorldReadableFiles` |
| `DexClassLoader`/`PathClassLoader`/`System.load` from downloaded or writable paths | Dynamic code loading; Flutter docs: never load executables from external storage |
| `Log.d`/`Log.i` with tokens or PII | `logging-privacy-ui.md` |
| Keystore/crypto: `Cipher.getInstance("AES")` (ECB default), static keys | `local-storage.md` crypto section |

## Native iOS code to read

- `URLSessionDelegate` `urlSession(_:didReceive:completionHandler:)` that answers `.useCredential` with `URLCredential(trust: challenge.protectionSpace.serverTrust!)` without `SecTrustEvaluateWithError`; `WKNavigationDelegate` doing the same: TLS bypass.
- `UIApplication.shared.open(url)` / `application(_:open:options:)` / `scene(_:openURLContexts:)` handlers that act on URL parameters (`deep-links.md`); `NSKeyedUnarchiver` with `requiresSecureCoding = false`; secrets in `UserDefaults`; `kSecAttrAccessibleAlways` (deprecated in iOS 12; Apple: use a level that gives some user protection, such as `kSecAttrAccessibleAfterFirstUnlock`).
- `WKScriptMessageHandler` implementations: same bridge risks as `webviews.md`.
- `Info.plist` and entitlements are covered in `platform-config.md`.

## Plugins and merged manifests

- Plugins add permissions, exported components and queries to the final manifest. Always read the **merged** manifest of a release build, not just `src/main/AndroidManifest.xml`:

```bash
./gradlew :app:processReleaseMainManifest          # merged manifest under build/intermediates/merged_manifests/
apkanalyzer manifest print build/app/outputs/flutter-apk/app-release.apk
```

- Remove permissions you do not need with `tools:node="remove"` (for example `READ_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION` pulled by a transitive plugin). Over-broad permissions are **Hardening** unless the feature is absent.
- Prefer plugins from verified publishers (flutter.dev, firebase.google.com, and others shown on pub.dev); read the native sources of small plugins that handle credentials, TLS, files or WebViews. Advisories relevant to plugins: `shared_preferences_android` 2.3.3 (arbitrary deserialization, fixed 2.3.4), `image_picker_android` before 0.8.12+18 and `file_selector_android` 0.5.1 through 0.5.1+11 (file-name sanitization with malicious document providers); see `dependencies.md`.
- Android Lint (`./gradlew :app:lintRelease`) flags many of the above: `AllowBackup`, `HardcodedDebugMode`, `ExportedContentProvider`, `ExportedReceiver`, `ExportedService`, `SetJavaScriptEnabled`, `AddJavascriptInterface`, `TrustAllX509TrustManager`, `BadHostnameVerifier`, `PackagedPrivateKey`, `UnsafeIntentLaunch`, `GrantAllUris`.

## FFI and dynamic loading

`dart:ffi` calls into C/C++/Rust: memory-safety bugs live in the native library, not in Dart; review it like native code and keep it updated. Flutter's own false-positives page says missing RELRO, stack canaries, fortified functions or NX on `libapp.so` are not Dart vulnerabilities; but "in principle, you can create vulnerable code when using Dart FFI". Do not `DynamicLibrary.open` a path that is writable by other apps or downloaded without signature verification.

## Severity, false positives, verification

- Channel that executes attacker-influenced commands, classes or paths: **High/Critical**. Exported provider/receiver exposing app data: **High**; exported component with no sensitive effect: **Low**. Native trust-all `TrustManager` in release: **High**. Mutable implicit `PendingIntent`: **Medium**. Over-requested permission: **Hardening**.
- Not findings: using `MethodChannel` itself; `MainActivity` exported (required); `GeneratedPluginRegistrant`; channel methods returning constants (version, device model); permissions required by a used feature; scanner output about `libapp.so` hardening (MobSF "no RELRO/canary/fortify", `_strlen`/`_sscanf`/`_malloc` usage), listed in Flutter's `security-false-positives` page; `file.delete()` "insecure deletion"; image-picker reading external storage.
- Verify: `rg "MethodChannel|setMethodCallHandler|Runtime.getRuntime|ProcessBuilder|Class.forName|DexClassLoader|TrustManager|HostnameVerifier|PendingIntent|FileProvider" android/ ios/ packages/`; run Lint; write a native unit test (JUnit/XCTest) feeding the handler `../`, empty, wrong-type and oversized arguments and expect an error result.

References: OWASP MASVS-PLATFORM-1, MASVS-CODE-4; MASTG Android/iOS platform interaction tests; CWE-20, CWE-22, CWE-78, CWE-927, CWE-295; https://docs.flutter.dev/platform-integration/platform-channels, https://docs.flutter.dev/reference/security-false-positives, https://developer.android.com/privacy-and-security/risks/implicit-intent-hijacking, https://developer.android.com/privacy-and-security/risks/dynamic-code-loading.
