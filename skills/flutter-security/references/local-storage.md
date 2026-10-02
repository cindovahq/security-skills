# Flutter — Local Storage, Backups and Client-Side Crypto

## Contents
- Storage options at a glance
- flutter_secure_storage
- Databases and files
- Backups
- Caches and logout
- Writing your own crypto
- Severity, false positives, verification

## Storage options at a glance

| Store | What it really is | Fit for tokens/PII? |
|---|---|---|
| `shared_preferences` | `NSUserDefaults` on iOS/macOS, Android `SharedPreferences` (XML in app-private storage). No encryption. | No. Flags, UI state, non-sensitive settings |
| `flutter_secure_storage` | iOS/macOS Keychain; Android Keystore-wrapped keys with AES-GCM (see below) | Yes, for tokens and small secrets |
| `sqflite` | Plain SQLite file | Not for sensitive data unless the threat model accepts it |
| `drift` | SQLite; encryption via SQLite3MultipleCiphers (`sqlite3` 3.x build hook `user_defines: sqlite3: source: sqlite3mc`, then `PRAGMA key`); `sqlcipher_flutter_libs` is `0.7.0+eol` and no longer does anything | Yes if encrypted and the key is in secure storage |
| `sqflite_sqlcipher` | SQLCipher-backed sqflite fork | Yes if the key is in secure storage |
| `hive` 2.2.3 (last release 2022-06-30), `hive_ce` (maintained fork), `isar` 3.1.0+1 (2023) | Binary boxes; optional `HiveAesCipher` (AES-256-CBC, PKCS7) | Only with a cipher whose key is not hardcoded; prefer maintained forks |
| Files via `path_provider` | `getApplicationDocumentsDirectory`/`getApplicationSupportDirectory`/`getTemporaryDirectory` are app-private; external-storage getters are not | Private dirs yes; external no |
| `supabase_flutter` session | Persisted through `SharedPreferencesLocalStorage` unless you pass a custom `LocalStorage` in `FlutterAuthClientOptions` | Hardening: custom `LocalStorage` over secure storage |

The `shared_preferences` README warns it "must not be used for storing critical data" (durability), and the platform stores are readable on rooted/jailbroken devices, in backups and by forensic tools. Tokens and refresh tokens in prefs are the most common mobile finding in Flutter code.

## flutter_secure_storage

Version-sensitive (11.2.0 current, 2026-09-16):

- **v10.0.0** replaced Jetpack `EncryptedSharedPreferences` (deprecated) with custom ciphers: default `AndroidOptions()` = RSA/ECB/OAEPWithSHA-256AndMGF1Padding key wrap + AES/GCM/NoPadding; `AndroidOptions.biometric(...)` uses Keystore AES-GCM keys. Old RSA-PKCS1 and AES-CBC combinations remain selectable only in 10.x.
- **v11.0.0** removed the deprecated algorithms, the `encryptedSharedPreferences` parameter and `sharedPreferencesName` (use `storageNamespace`) and raised minSdk to 24. Apps jumping from pre-10 straight to 11 lose data; upgrade through 10 first (`checkUpgradeStatus()` arrived in 11.1.0).
- iOS/macOS `IOSOptions(accessibility: KeychainAccessibility.…)`: `unlocked` is the default; `first_unlock` suits background work; `*_this_device` variants map to `…ThisDeviceOnly`, which Apple says "do not migrate to a new device" via backup.
- Biometric-gated reads: `AndroidOptions.biometric(enforceBiometrics: true, biometricType: AndroidBiometricType.strongBiometricOnly)`. Enforcement of strong-only is full on Android 11+ (changelog 10.3.0). This is the crypto-bound alternative to a `local_auth` boolean (`authentication.md`).
- Android: the README says to disable Auto Backup or exclude the plugin's prefs because restored data cannot be decrypted (`InvalidKeyException`); that is a reliability note, but it also means backups carry ciphertext only.
- Web: works only over HTTPS or localhost and is not a secure enclave; browser storage is readable by any script on the origin.

Investigate: tokens, refresh tokens, passwords, PINs, API keys, PII or session objects written with `SharedPreferences`, `Hive.openBox` without `encryptionCipher`, `File.writeAsString`, SQLite rows, `jsonEncode(user)` caches.

```dart
const storage = FlutterSecureStorage(
  iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
);
await storage.write(key: 'refresh_token', value: token);
```

## Databases and files

- Encrypt the database only when the threat model includes device compromise or backup extraction; generate the key with `Random.secure()` once, store it in secure storage, never in source or prefs.
- Hive: `HiveAesCipher(key)` with `key` from `Hive.generateSecureKey()` stored in secure storage. A literal or derived-from-app-constant key is a finding (`crypto` section below).
- External storage (`getExternalStorageDirectory`, `getExternalCacheDirectories`, public Downloads, `MANAGE_EXTERNAL_STORAGE`) is not private to the app. Flutter's own false-positives page says plugins reading/writing it is expected, and quotes the recommendation "We strongly recommend that you not store executables or class files on external storage prior to dynamic loading." Report only sensitive data or code written there. Android risk page: sensitive-data-external-storage.
- iOS `UIFileSharingEnabled` or `LSSupportsOpeningDocumentsInPlace` set to true exposes the app's Documents folder in Files/iTunes; with tokens, databases or exports in `getApplicationDocumentsDirectory()` that is a finding.
- Native iOS networking caches responses in a `Cache.db` SQLite file. The `flutter_appauth` README warns this table can contain the access token returned by the login flow; disable URL caching for native stacks if that matters.

## Backups

- Android: `android:allowBackup` defaults to `true`. Android's current guidance is not "always set false": keep Auto Backup (encrypted in transit and at rest; end-to-end with a lock screen on Android 9+) and exclude sensitive paths with `android:dataExtractionRules` (API 31+, covers cloud and device-to-device) plus `android:fullBackupContent` (API 30 and lower). For apps targeting API 31+, `adb backup` excludes app data unless the app is `debuggable`.
- Report missing exclusions only when sensitive data sits in plaintext stores (prefs, SQLite, files). Secure-storage ciphertext restored on another device is unusable.
- iOS: items in Documents and Application Support are included in device backups unless excluded (`URLResourceKey.isExcludedFromBackupKey`); Keychain `ThisDeviceOnly` classes are not migrated.

## Caches and logout

On logout or account switch delete: tokens (`storage.deleteAll()`; on Android, v11.2 clears only this instance's key prefix, so verify logout still removes everything you need), databases and files with user data, image/HTTP caches holding authenticated content (`cached_network_image`, Dio cache interceptors), `WebViewCookieManager().clearCookies()` and WebView cache, notification payloads, in-memory providers.

## Writing your own crypto

Prefer platform stores over hand-rolled encryption. If you must encrypt:

- Randomness for tokens, keys, IVs, nonces: `Random.secure()` (throws `UnsupportedError` if unavailable), never `Random()` or `DateTime.now()` seeds.
- `package:encrypt` 5.0.3 (2023-09-18): `AES(key)` defaults to `AESMode.sic` (unauthenticated CTR-style stream mode) with `padding: 'PKCS7'`. Use `AESMode.gcm` with a fresh random `IV.fromSecureRandom(12)` per message, and never `IV.allZerosOfLength`, a fixed `IV.fromUtf8(...)`, `AESMode.ecb`, or `Key.fromUtf8('literal')`. Findings: key/IV in source or a bundled asset, static IV, ECB, MD5/SHA-1 for passwords or integrity, client-side "password hashing" with a static salt, home-made XOR/Base64 "encryption".
- The `crypto` package provides hashes/HMAC, not encryption. `package:cryptography` and `pointycastle` provide AEAD primitives.
- Android risk pages: Hardcoded Cryptographic Secrets, Weak PRNG, Broken Cryptographic Algorithm.

## Severity, false positives, verification

- Refresh/access tokens, passwords or PII in plaintext app-private storage: **Medium** (local-access or backup attacker), **High** for long-lived refresh tokens with no rotation in a sensitive app (health, banking); preferences used for locale/theme/onboarding flags are not findings.
- Hardcoded encryption key or static IV protecting user data: **Medium/High** by data sensitivity (the key ships to every device, so the encryption is decorative).
- Missing `dataExtractionRules` alone: **Hardening**. Missing encryption on a non-sensitive cache: not a finding.
- Verify: on a debug build or emulator, `adb shell run-as <package> ls -R shared_prefs files databases app_flutter`; inspect `shared_prefs/FlutterSharedPreferences.xml` (legacy API keys carry a `flutter.` prefix) for tokens. After logout the same directories must hold no user data. For iOS use a simulator container (`xcrun simctl get_app_container booted <bundle-id> data`).

References: OWASP MASVS-STORAGE-1/-2, MASVS-CRYPTO-1/-2; OWASP Mobile Top 10 2024 M9, M10; CWE-312, CWE-327, CWE-330, CWE-321; https://pub.dev/packages/flutter_secure_storage, https://developer.android.com/privacy-and-security/risks/backup-best-practices, https://developer.android.com/guide/topics/manifest/application-element, https://docs.flutter.dev/reference/security-false-positives.
