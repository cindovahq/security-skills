# Flutter — SDK Support, Dependencies and Supply Chain

## Contents
- Versions and support (checked 2026-10-02)
- Advisories that matter
- Commands and tooling
- Supply-chain review points
- Native dependencies and scanner noise
- Severity, false positives, verification

## Versions and support (checked 2026-10-02)

- **Flutter 3.47.6** (released 2026-10-01) with **Dart 3.13.5** is the latest stable; 3.47.0 shipped 2026-08-12 and 3.44.9 2026-08-06 (source: `storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`, the data behind `docs.flutter.dev/install/archive`). Flutter's security policy: "We commit to publishing security updates for the version of Flutter currently on the stable branch." There is no long-term-support line; older Flutter versions get no fixes, so an app built from an old SDK inherits old engine components (BoringSSL, Skia/Impeller, ICU, zlib...). Read the SDK version from `.fvmrc`/`.fvm/fvm_config.json`, CI (`flutter-action`, Codemagic `flutter:`), `pubspec.yaml` `environment:` and `pubspec.lock` `sdks:`.
- Record installed (locked) versions from `pubspec.lock`, not from ranges in `pubspec.yaml`. Notable current majors: `flutter_secure_storage` 11.2.0, `shared_preferences` 2.5.5, `dio` 5.11.1, `http` 1.6.0, `flutter_appauth` 12.1.0, `local_auth` 3.0.2, `webview_flutter` 4.14.1, `flutter_inappwebview` 6.1.5, `app_links` 7.2.1, `go_router` 18.0.2, `firebase_core` 4.15.0, `firebase_auth` 6.7.0, `cloud_firestore` 6.10.0, `firebase_app_check` 0.4.8, `supabase_flutter` 2.18.0, `sentry_flutter` 9.30.1, `flutter_dotenv` 6.0.1.
- Stale or abandoned (pub.dev last-publish dates): `uni_links` 0.5.1 (2021, discontinued, replace with `app_links`), `hive` 2.2.3 (2022; `hive_ce` is the maintained fork), `isar` 3.1.0+1 (2023), `encrypt` 5.0.3 (2023), `flutter_jailbreak_detection` 1.10.0 (2023), `flutter_windowmanager` 0.2.0 (2021), `sqlcipher_flutter_libs` 0.7.0+eol (no longer does anything), `ssl_pinning_plugin` 2.0.0 (2021). A stale package is Hardening unless it handles security-sensitive data or has an advisory.
- Package API churn that interacts with security: `flutter_secure_storage` v10 and v11 (`local-storage.md`), `local_auth` 3.0 (`authentication.md`), `firebase_app_check` 0.4.x provider parameters (`authorization-backends.md`), `supabase_flutter` `publishableKey`, Dio 5 `IOHttpClientAdapter` (`network-tls.md`).

## Advisories that matter

From the GitHub Advisory Database for the `pub` ecosystem and the Dart/Flutter repositories (queried 2026-10-02; the pub ecosystem has few advisories, so "no advisory" is the common case):

| Advisory | Affects | Fixed in | Relevance |
|---|---|---|---|
| GHSA-3hpf-ff72-j67p (shared_preferences_android) | `shared_preferences_android` 2.3.3 only | 2.3.4 | Special string prefixes in the prefs file allow arbitrary class deserialization, so a prefs file overwritten by an attacker (rooted device, backup restore, other vuln) runs code at load. Low severity in the advisory |
| CVE-2024-54462 (image_picker_android) | 0.8.5+6 to 0.8.12+17 | 0.8.12+18 | File names from a malicious document provider are not sanitized; could overwrite app cache files |
| CVE-2024-54461 (file_selector_android) | 0.5.1 through 0.5.1+11 | 0.5.1+12 | Same class as above |
| CVE-2026-27704 (Dart SDK pub client) | Dart before 3.11.0, Flutter before 3.41.0 | Dart 3.11.0, Flutter 3.41.0 | Zip slip when extracting a package into the pub cache via symlinks; developer/CI machines only; pub.dev packages were vetted |
| CVE-2026-34240 (`jose`) | `jose` <= 0.3.5 | 0.3.5+1 | Untrusted JWK header key accepted during signature verification; relevant only if the app or a Dart server verifies JWTs with it |
| CVE-2024-29887 (`serverpod_client`) | < 1.2.6 | 1.2.6 | Client accepts any certificate |
| CVE-2024-48915 (`agent_dart`) | <= 1.0.0-dev.28 | 1.0.0-dev.29 | Missing certificate verification checks |
| CVE-2023-39139, CVE-2023-39137 (`archive`) | <= 3.3.7 | 3.3.8 | Path traversal and filename spoofing when extracting archives; check any ZIP/TAR handling of user data |
| CVE-2021-31402 (`dio`) | < 5.0.0 | 5.0.0 | CRLF injection through the HTTP method string |
| CVE-2020-35669 (`http`) | < 0.13.3 | 0.13.3 | Header injection |
| CVE-2022-0451 (Dart SDK) | Dart < 2.16.0 (Flutter < 2.10.0) | 2.16.0 | `HttpClient` forwarded explicit sensitive headers across origins on redirect |
| GHSA-cr65-55v9-xhvv (`dio_http2_adapter`) | >= 1.0.0, <= 2.7.1 | 2.8.0 | Cross-origin redirect leaks `Authorization`/`Cookie` headers; only when `Http2Adapter` is used (repo advisory, 2026-08-15) |

Rules: report an advisory only when the installed version is in the vulnerable range **and** the vulnerable feature is reachable. `flutter_inappwebview` and `webview_flutter` have no published GitHub security advisories (checked 2026-10-02): do not cite CVEs for them. Do not invent identifiers.

## Commands and tooling

```bash
flutter pub get                        # prints "affected by advisory: [^0]" lines for locked packages (dart.dev/tools/pub/security-advisories)
flutter pub outdated --no-dev-dependencies --transitive
flutter pub deps --style=compact
osv-scanner scan -L pubspec.lock       # OSV-Scanner supports pubspec.lock and package_config.json
```

- `dart pub get` surfaces advisories at resolution time. A package may suppress one with `ignored_advisories:` in its `pubspec.yaml`; the list only affects the root package. Any entry needs a written justification (reachability), or it hides a real finding.
- There is no `dart pub audit` command in Dart 3.13 (the subcommand list is: add, bump, cache, deps, downgrade, global, get, publish, outdated, remove, unpack, upgrade, login, logout, token, workspace).
- Dependabot supports the `pub` ecosystem (`package-ecosystem: "pub"`, version and security updates); Renovate also supports Dart/Flutter. Also scan native lockfiles below.
- Dart/Flutter guidance: commit `pubspec.lock` for **application** packages ("changes to transitive dependencies are explicit"); for libraries do not. A missing lock file in an app repo is a finding (Low/Hardening): builds are not reproducible and a compromised newer release flows in unreviewed.

## Supply-chain review points

- `pubspec.yaml`: `any` or very wide constraints, `dependency_overrides` in an app, `git:` dependencies without a pinned `ref` (commit SHA), `path:` dependencies to unreviewed code, `publish_to: none` is normal for apps, custom `hosted:` registries and tokens (`dart pub token`).
- New or typosquatted package names, packages from unverified publishers handling credentials/TLS/WebView/crypto; check the pub.dev publisher badge, repository link, recent maintenance, issue tracker and the permissions the plugin adds to the manifest (`platform-channels-native.md`).
- Build hooks: Dart 3.10+ packages can ship `hook/build.dart` that compiles **or downloads** native assets at build time (Dart docs: "Hooks"). Review hooks of third-party packages like install scripts; pin and review updates.
- Native layer: Android Gradle dependencies (`./gradlew :app:dependencies`, versions pinned by plugin or Firebase BoM) and iOS CocoaPods/Swift Package Manager (`ios/Podfile.lock` committed). Plugin updates move these.
- CI: pin GitHub Actions by SHA, restrict secrets to release workflows, verify checksums when downloading SDKs or tools, run `flutter pub get --enforce-lockfile` for reproducible builds in CI (it fails if `pubspec.lock` is not already exact).
- Generated code (`build_runner`) and code-gen packages run during development: treat their versions like build tooling.

## Native dependencies and scanner noise

- Scanners (MobSF, Trivy on the APK, vendor SCA) flag Flutter binaries for libc-hardening, `_strlen`/`_malloc` usage, RELRO, stack canaries, iOS `@rpath`, and CBC/PKCS7 use inside ExoPlayer HLS (DRM, not a vulnerability). NX is listed as obsolete: valid only for old SDKs. Flutter's `security-false-positives` page explains why these do not apply to `libapp.so`; treat them as false positives unless tied to your own FFI/native code. Only a concrete advisory against an included native library version (OkHttp, Firebase Android SDK, a plugin's embedded C library) is a finding; map it to the plugin and check reachability.
- Engine components (`libflutter.so`) are fixed by upgrading Flutter; one stale engine CVE is **Low/Hardening** with a fix of "upgrade to current stable", not a bug in the app's code.
- `flutter pub outdated` listing newer versions is not a vulnerability list; "old" is not "vulnerable".

## Severity, false positives, verification

- Reachable advisory in a security-sensitive package (TLS bypass such as `serverpod_client` <1.2.6, JWT verification `jose` <=0.3.5): **High**. Plugin advisories with low impact (`shared_preferences_android` 2.3.3, image picker cases): **Low/Medium**. Old Flutter SDK without a specific advisory: **Hardening**. Missing lock file: **Low**. Unpinned `git:` dependency: **Low/Medium**.
- Not findings: `publish_to: none`; dev-only dependencies (`build_runner`, `flutter_lints`); Flutter-bundled test dependencies; scanner "no stack canary" on `libapp.so`; `dependency_overrides` in a package's own tests.
- Verify: `flutter pub get` after upgrading shows no advisory lines; `osv-scanner scan -L pubspec.lock` clean or each result triaged; `git ls-files pubspec.lock ios/Podfile.lock` present; `flutter doctor -v` and CI use the same stable version.

References: OWASP MASVS-CODE-3; OWASP Mobile Top 10 2024 M2; CWE-1104, CWE-1357; https://dart.dev/tools/pub/security-advisories, https://dart.dev/tools/pub/private-files, https://flutter.dev/security, https://docs.flutter.dev/reference/security-false-positives, https://github.com/advisories?query=ecosystem%3Apub, https://google.github.io/osv-scanner/supported-languages-and-lockfiles/.
