# Flutter — Logging, Crash Reports, Screens, Clipboard and Input

## Contents
- Logging in release builds
- Crash reporting and analytics
- Screenshots, recents and screen recording
- Clipboard
- Text input and keyboards
- Notifications
- Severity, false positives, verification

This is mostly **MASVS-STORAGE-2** (leakage) and **MASVS-PLATFORM-3** (UI), with some **MASVS-PRIVACY**. Calibrate carefully: these are real but usually Low/Medium, and heavily dependent on the app's data.

## Logging in release builds

Flutter's debugging guide says of `debugPrint()`: it "will print messages in release mode unless part of a debug mode check or an assert". `print()` also runs in release builds, and neither is removed by the compiler. Output goes to the platform log (Android logcat, iOS/macOS unified log), visible to anyone with USB debugging, bug reports or a connected Mac. `dart:developer` `log()` feeds the DevTools Logging view.

Investigate:

```bash
rg -n "\b(print|debugPrint|log|developer\.log)\(" lib/ | rg -i "token|password|secret|authorization|bearer|cookie|otp|pin|ssn|card|email|phone|response|body|headers"
rg -n "LogInterceptor|PrettyDioLogger|logPrint|requestBody: true|responseBody: true|requestHeader: true|Logger\(|logger\." lib/
```

- Log lines containing tokens, refresh tokens, credentials, full request/response bodies, `Authorization` headers, PII, payment data.
- Dio `LogInterceptor(requestHeader: true, requestBody: true, responseBody: true)` or similar interceptors added unconditionally.
- Safe guard patterns: `if (kDebugMode) debugPrint(...)`, `assert(() { debugPrint(...); return true; }());`, or a logger that is a no-op when `kReleaseMode`. `kDebugMode`/`kReleaseMode` are compile-time constants, so guarded code is removed from release builds (API docs).
- Fix: a small logging facade with redaction (mask tokens and emails), levels (`warning` and above in release without PII), and no request/response bodies in release. Use IDs, not data.
- `flutter run --release` output and CI logs also leak when builds print defines or env (`secrets-binary.md`).

## Crash reporting and analytics

- **Crashlytics** (`firebase_crashlytics` 5.4.0): custom keys, logs (`log()`), `setUserIdentifier`, and recorded exceptions reach Firebase. Do not put emails, tokens, phone numbers or document text in them.
- **Sentry** (`sentry_flutter` 9.30.1): `SentryOptions.sendDefaultPii` attaches IP, user and request details when true; HTTP/Dio integrations and breadcrumbs can capture URLs, headers and bodies; use `beforeSend`/`beforeBreadcrumb` to scrub, and avoid screenshots/session replay for sensitive screens or mask them.
- Analytics (Firebase Analytics, Mixpanel, Segment, AppsFlyer): events and user properties with email, full name, tokens, search text with PII; ad-ID or fingerprinting without consent (MASVS-PRIVACY-1/-2/-3: minimize collection, avoid identification, be transparent). iOS requires a privacy manifest (`PrivacyInfo.xcprivacy`) for required-reason APIs and many SDKs; Play requires a Data Safety declaration. Mismatch between declarations and SDK behavior is a compliance finding, not a technical vulnerability.
- Exception messages: `catch (e) { showSnackBar('$e') }` or sending `e.toString()` from the server to the UI shows stack traces and SQL/URLs to users; show generic messages and log details privately.
- Obfuscated builds: keep `--split-debug-info` directories out of the artifact and upload them privately to the crash service (`flutter symbolize`).

## Screenshots, recents and screen recording

- **Android:** `WindowManager.LayoutParams.FLAG_SECURE` ("treat the content of the window as secure, preventing it from appearing in screenshots or from being viewed on non-secure displays") set in `MainActivity.onCreate` (`window.setFlags(FLAG_SECURE, FLAG_SECURE)`) also blanks the app's thumbnail in the recents screen on current Android versions (confirm on a device). `Activity.setRecentsScreenshotEnabled(false)` (API 33) disables only the recents thumbnail. Packages such as `no_screenshot` 2.0.1 and `screen_protector` 1.5.3 wrap this (they also cover iOS overlays and capture detection); `flutter_windowmanager` 0.2.0 has not been updated since 2021. Review the maintenance of whatever is used.
- **iOS** has no `FLAG_SECURE`. The app-switcher snapshot is taken when the app resigns active: show an opaque cover view on `AppLifecycleState.inactive` (via `AppLifecycleListener(onInactive: ...)` or `WidgetsBindingObserver`) and remove it on `resumed`; plugins above provide a ready-made overlay.
- This is **Hardening** for apps whose screens show banking, health, ID-document, 2FA, or private messaging content. Absence is not a finding for ordinary apps. `FLAG_SECURE` on a login screen is not a mandatory control.

## Clipboard

- `Clipboard.setData(ClipboardData(text: x))` supports plain text only (`ClipboardData` API docs): there is no sensitive-content flag in Flutter's API. Android 13 and later honor `ClipDescription.EXTRA_IS_SENSITIVE` (`android.content.extra.IS_SENSITIVE`) to hide the keyboard clipboard preview, which needs native code (Android risk page "Secure clipboard handling"). Before Android 10 background apps could read the clipboard; Android 12+ shows a toast when an app reads it.
- Findings: auto-copying passwords, one-time codes, recovery phrases or tokens to the clipboard without clearing or flagging; reading `Clipboard.getData` on resume to prefill secrets. Copy-on-tap of a non-secret (order ID) is fine. Mitigation: avoid copying secrets, offer "show/reveal", clear after a short timeout (`Clipboard.setData(const ClipboardData(text: ''))`), set the sensitive flag natively.

## Text input and keyboards

For password, PIN, OTP and recovery fields:

```dart
TextField(
  obscureText: true,
  enableSuggestions: false,              // Android only; on iOS suggestions follow autocorrect
  autocorrect: false,
  enableIMEPersonalizedLearning: false,  // Android only
  keyboardType: TextInputType.visiblePassword,
  autofillHints: const [AutofillHints.password],
)
```

`enableSuggestions` and `enableIMEPersonalizedLearning` only affect Android per their API docs. Keyboard caches and third-party keyboards are an accepted residual risk; report missing flags only on genuinely secret inputs, as **Hardening**.

## Notifications

`flutter_local_notifications` 22.3.1 and FCM payloads: sensitive text shown on the lock screen (use private visibility/redacted content), tokens or PII in the `data` payload (stored by the OS and Google/Apple push services), payload `route`/`url` values used to navigate (`deep-links.md`).

## Severity, false positives, verification

- Tokens/passwords/PII logged in release, or `LogInterceptor` bodies enabled in release: **Medium** (Low if logs are only reachable with physical access and the data is low value; High where credentials in third-party log aggregation). PII in Crashlytics/Sentry/analytics: **Medium** with a privacy/compliance dimension. Missing `FLAG_SECURE`/snapshot overlay: **Hardening**. Sensitive clipboard use: **Low/Medium**.
- Not findings: `debugPrint` inside `kDebugMode`/`assert`; logging non-sensitive state or IDs; Crashlytics enabled with scrubbed data; `print` in tests, `tool/`, or `example/`.
- Verify: run a release/profile build on a test device while using the app with a test account and read `adb logcat -d | rg -i "token|bearer|password"` (Android) or the Xcode device console; check the crash dashboard for PII in custom keys; on Android take a screenshot of a secured screen (expect a blocked-capture notice) and open recents (expect a blank card).

References: OWASP MASVS-STORAGE-2, MASVS-PLATFORM-3, MASVS-PRIVACY-1..4; OWASP Mobile Top 10 2024 M6, M9; CWE-532, CWE-200; https://docs.flutter.dev/testing/code-debugging, https://developer.android.com/privacy-and-security/risks/log-info-disclosure, https://developer.android.com/privacy-and-security/risks/secure-clipboard-handling, https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE.
