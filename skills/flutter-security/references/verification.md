# Flutter — Verifying Findings and Fixes

## Contents
- Ground rules
- Inspect the release artifact
- Static checks
- Tests that prove a fix
- Device and emulator checks
- Backend rules and dependency checks
- Fix-verification checklist

## Ground rules

- Test only apps and backends you are authorized to assess, on your own builds, emulators/simulators or test devices, with test accounts. Prefer staging.
- This skill does not use instrumentation frameworks or bypass techniques. Checks are artifact inspection, static analysis, automated tests and ordinary `adb`/`simctl` commands on debug builds.
- State when a finding came from reading code only (**Likely**, with the missing condition) versus a demonstrated result. Hosting headers, Firebase console settings, App Check enforcement, IdP configuration and server behavior are usually outside the repo.
- Release builds differ from debug: always verify on `flutter build ... --release` output, because assertions, `kDebugMode` code, debug manifests (`src/debug`) and tooling differ.

## Inspect the release artifact

```bash
flutter build apk --release --obfuscate --split-debug-info=build/symbols
APK=build/app/outputs/flutter-apk/app-release.apk
mkdir -p /tmp/apk && unzip -qo "$APK" -d /tmp/apk
ls -la /tmp/apk/assets/flutter_assets                     # note: hidden files such as .env show only with -a
grep -rIl "<first 8 chars of the secret>" /tmp/apk        # expect nothing; also check binary files without -I
strings -n 12 /tmp/apk/lib/arm64-v8a/libapp.so | rg -i "secret|token|bearer|api[_-]?key|BEGIN .*PRIVATE|https?://" | sort -u | head -80
apkanalyzer manifest debuggable "$APK"                    # false
apkanalyzer manifest permissions "$APK"
apkanalyzer manifest print "$APK" | rg -n "exported|cleartext|networkSecurityConfig|allowBackup|dataExtractionRules|android:scheme|autoVerify"
```

- `apkanalyzer` ships in the Android SDK `cmdline-tools` and needs a JDK on `JAVA_HOME`; its manifest subcommands are `print`, `application-id`, `version-name`, `version-code`, `min-sdk`, `target-sdk`, `permissions`, `debuggable`.
- Merged manifest source: `./gradlew :app:processReleaseMainManifest` (from `android/`), output under `build/app/intermediates/merged_manifests/`.
- iOS: `flutter build ipa` or `flutter build ios --release`, then inspect `Runner.app`: `plutil -p Runner.app/Info.plist`; `codesign -d --entitlements :- Runner.app`; `strings Runner.app/Frameworks/App.framework/App | rg -i "secret|token"`; `ls Runner.app/Frameworks/App.framework/flutter_assets`.
- Web: `flutter build web --release`; `find build/web -name '*.map' -o -name '.env*'`; `grep -rE "secret|service_role|sk_" build/web`.
- Any secret found must be rotated even after the code is fixed.

## Static checks

- `flutter analyze` with `package:flutter_lints` (6.0.0) enables `avoid_print` and `avoid_web_libraries_in_flutter`; add `only_throw_errors`, `avoid_dynamic_calls` or project lints as desired. Treat a `print` lint hit near tokens as a signal, not a finding (`logging-privacy-ui.md`).
- Ripgrep signal sets are in each reference; the broad pass:

```bash
rg -n "badCertificateCallback|HttpOverrides|PROCEED|\.proceed\(|allowInsecureConnections|http://|ws://" lib/
rg -n "SharedPreferences|Hive\.openBox|openDatabase|writeAsString|getExternalStorage" lib/
rg -n "fromEnvironment|dotenv|dart-define|apiKey|secret|password" lib/ pubspec.yaml tool/ .github/
rg -n "addJavaScriptChannel|addJavaScriptHandler|runJavaScript|loadRequest|loadHtmlString|initialUrlRequest" lib/
rg -n "Random\(|AESMode\.(ecb|sic)|IV\.(fromUtf8|allZerosOfLength)|Key\.fromUtf8|md5|sha1" lib/
rg -n "MethodChannel|setMethodCallHandler" lib/ android/ ios/
```

- Android Lint: `cd android && ./gradlew :app:lintRelease` (look at `AllowBackup`, `HardcodedDebugMode`, `Exported*`, `TrustAllX509TrustManager`, `BadHostnameVerifier`, `SetJavaScriptEnabled`, `PackagedPrivateKey`). MobSF can scan the built APK/IPA; discard binary-hardening results for `libapp.so` that appear on Flutter's false-positives page (`docs.flutter.dev/reference/security-false-positives`).

## Tests that prove a fix

```dart
// Deep link parser rejects hostile and unknown links (deep-links.md)
test('rejects unexpected hosts and shapes', () {
  for (final raw in ['https://evil.example/orders/1', 'acme://orders/1', 'https://app.acme.example/orders/../admin',
                     'https://app.acme.example//evil.example', 'https://app.acme.example/orders/9999999999999999999999']) {
    expect(parseDeepLink(Uri.parse(raw)), isNull, reason: raw);
  }
});

// WebView allow-list helper (webviews.md)
test('only the first-party https host navigates', () {
  expect(isAllowedNavigation('https://help.acme.example/a'), isTrue);
  for (final u in ['http://help.acme.example/', 'https://help.acme.example.evil.example/', 'javascript:void(0)', 'file:///etc/hosts']) {
    expect(isAllowedNavigation(u), isFalse, reason: u);
  }
});

// TLS: the app's HTTP client must reject an untrusted certificate (network-tls.md)
test('client rejects a self-signed server', () async {
  // test/fixtures: generate once with: openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj "/CN=localhost"
  final ctx = SecurityContext()
    ..useCertificateChain('test/fixtures/cert.pem')
    ..usePrivateKey('test/fixtures/key.pem');
  final server = await HttpServer.bindSecure('localhost', 0, ctx);
  server.listen((r) { r.response..write('ok'); r.response.close(); });
  final api = buildApiClient();                              // the production factory, not a test double
  await expectLater(api.get(Uri(scheme: 'https', host: 'localhost', port: server.port)), throwsA(isA<HandshakeException>()));
  await server.close(force: true);
});

// Logout wipes user data (local-storage.md)
test('logout clears tokens and caches', () async {
  await session.signIn(testUser);
  await session.signOut();
  expect(await secureStorage.readAll(), isEmpty);
  expect((await SharedPreferences.getInstance()).getKeys().where((k) => k.contains('token')), isEmpty);
});
```

Integration tests (`integration_test`, run on an emulator): sign in, background the app and check that the sensitive screen is covered (screenshot comparison or `FLAG_SECURE` through a platform-side test), sign out and assert the router cannot return to authenticated screens, open an unknown deep link and assert a safe landing screen.

## Device and emulator checks

- Debug build (Android): `adb shell run-as <package> ls shared_prefs databases files app_flutter`; read `FlutterSharedPreferences.xml` for tokens; the same `run-as` against a **release** build must fail (not debuggable). Confirm sensitive files are absent after logout.
- Backup rules: follow Android's "Test backup and restore" guide (`developer.android.com/identity/data/testingbackup`, uses `adb shell bmgr`) and verify excluded paths are not restored.
- Deep links: `adb shell am start -a android.intent.action.VIEW -d "<url>" <package>`; `adb shell pm get-app-links <package>` (Android 12+); `xcrun simctl openurl booted "<url>"`.
- Logs: `adb logcat -d | rg -i "bearer|token|password"` after exercising login, profile and payment flows on a release/profile build; Xcode device console on iOS.
- Screens: attempt a screenshot and the recents/app-switcher view on a sensitive screen (expect blocked capture or a cover).
- iOS simulator data: `xcrun simctl get_app_container booted <bundle-id> data` and inspect `Library/Preferences/*.plist` and `Documents`.
- TLS: temporarily point staging DNS or the base URL at a host with an expired/self-signed certificate (or use the test above) and expect a failure, not a silent success.

## Backend rules and dependency checks

- Firebase rules: `firebase emulators:exec --only firestore,storage "npm test"` with `@firebase/rules-unit-testing` (`initializeTestEnvironment`, `assertFails`, `assertSucceeds`): anonymous read denied, user A cannot read/write user B, non-admin cannot set `role`, oversized or wrong-type uploads fail.
- Supabase: `supabase-security` (`get_advisors`, pgTAP) for RLS and grants.
- Dependencies: `flutter pub get` (no advisory lines), `flutter pub outdated`, `osv-scanner scan -L pubspec.lock`, `git ls-files pubspec.lock ios/Podfile.lock`.

## Fix-verification checklist

```text
[ ] Secret removed from source, assets, dart-define files, CI logs; rotated; release artifact grep is clean
[ ] Tokens only in secure storage; logout wipes storage, DB, caches, cookies (test)
[ ] No trust-all TLS callbacks; HTTPS-only base URLs; failing-certificate test passes
[ ] Deep links/WebView URLs/redirects parsed and allow-listed (unit tests with hostile inputs)
[ ] JS channels only on first-party content, arguments validated
[ ] Release manifest/Info.plist reviewed (debuggable false, no unintended exports, ATS/NSC as intended)
[ ] Server/Firebase rules enforce authorization; rules tests pass
[ ] Logs and crash reports contain no tokens or PII in release
[ ] Dependencies free of reachable advisories; pubspec.lock committed
[ ] Same pattern searched for elsewhere (siblings), not just the reported line
```

References: OWASP MASTG (testing guide) and MASVS v2.1.0; https://docs.flutter.dev/testing/overview, https://docs.flutter.dev/cookbook/testing/integration/introduction, https://developer.android.com/identity/data/testingbackup, https://firebase.google.com/docs/rules/unit-tests.
