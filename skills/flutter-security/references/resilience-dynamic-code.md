# Flutter — Resilience, Obfuscation, Root Detection and Dynamic Code

## Contents
- How to treat resilience findings
- Obfuscation and reverse engineering
- Root/jailbreak detection and attestation
- Code push (Shorebird) and updates
- Remote-driven behavior
- Severity, false positives, verification

## How to treat resilience findings

OWASP MASVS-RESILIENCE (obfuscation, anti-debugging, anti-tampering, root/jailbreak detection, RASP) is defense in depth. The current MASVS-RESILIENCE text (mas.owasp.org) is explicit: "**The absence of these measures does not in itself constitute a vulnerability**. Instead, resilience controls provide additional protection against threat-specific attacks." The v2.1.0 release words it as "the lack of any of these measures does not necessarily cause vulnerabilities". They matter for apps with business assets to protect (payments, games with revenue, DRM, ML models, high fraud risk) and can be undesirable for public-interest apps that value transparency.

Rules for reviews:

1. Never report "no root detection", "no obfuscation", "no anti-debugging", "no pinning" or "no tamper detection" as Medium or above. Use **Hardening/Info** and tie it to a stated threat (fraud, cheating, regulatory requirement).
2. Never accept a resilience control as the **fix** for a confidentiality or authorization bug. Secrets in the binary, trusting client checks and missing server authorization stay findings whatever the obfuscation or root detection (`secrets-binary.md`, `authorization-backends.md`).
3. A detection that exists but is trivially defeated is not a vulnerability either; at most Hardening: note where the result is stored and who consumes it.

## Obfuscation and reverse engineering

- `flutter build apk|appbundle|ios|ipa --obfuscate --split-debug-info=<dir>` (the flags must be used together, release builds only). `flutter build` help: it "removes identifiers and replaces them with randomized values", so `runtimeType.toString()`, `Enum.toString`, `Stacktrace.toString` become obfuscated. Docs: enum names are not obfuscated; web builds are not supported (minified output only); obfuscation "does not encrypt resources nor does it protect against reverse engineering".
- The Dart AOT snapshot (`libapp.so`, `App.framework/App`) keeps string literals, constants, `--dart-define` values, URLs, assets and program structure. Verified with Flutter 3.47.2 (2026-10) that a literal, a `--dart-define` value and a `flutter_dotenv` asset all remained readable in an obfuscated release APK (`strings`/`unzip`). Public tooling recovers structure from Flutter snapshots, and patched engines can disable TLS validation, so client-side pinning and checks should be considered bypassable by an attacker who owns the device.
- Do: use it for IP hygiene and smaller stack traces; store `--split-debug-info` output in private CI storage (needed for `flutter symbolize`); keep secrets out of the app.
- Do not: rely on it for secrets, license checks, or business rules that the server should enforce.

## Root/jailbreak detection and attestation

| Option | Notes (versions checked 2026-10-02) |
|---|---|
| Client-side checks: `flutter_jailbreak_detection` 1.10.0 (last published 2023-01-11), `jailbreak_root_detection` 1.2.3, `root_jailbreak_sniffer` 1.1.4, `safe_device` 1.4.1 | Heuristics (su binaries, writable system paths, packages). Defeated by hooking or hiding root; false positives on custom ROMs and accessibility setups. Review maintenance before adopting |
| RASP SDK: `freerasp` 8.2.3 | In-app threat detection/RASP SDK (its README lists root/jailbreak, bootloader and tampering detection and anti-reverse-engineering aims); still client-side, but raises the bar |
| Platform attestation verified **by your server**: Google Play Integrity API, Apple App Attest / DeviceCheck, Firebase App Check (`authorization-backends.md`) | Strongest option: the verdict is checked server-side per request or session, not as a Dart `bool` |

Review points:

- Where does the result go? `prefs.setBool('isRooted', ...)`, an in-memory flag, or a server call. A detection result only consumed in Dart is advisory.
- Fail-open on exceptions, timeouts or missing Play services? Decide deliberately.
- What happens on detection: warn, block high-risk actions, wipe tokens, or hard-block (hard-blocking harms legitimate users).
- Keep detection libraries current: stale ones miss modern root hiders and cause false positives on new devices.
- Do not penalize the absence of detection in ordinary apps. Do flag a financial/regulated app whose own requirements demand it and which has none, as Hardening/Compliance.

## Code push (Shorebird) and updates

Shorebird patches Dart code in released apps (`shorebird release`, `shorebird patch`; `shorebird_code_push` 2.0.7 for in-app update checks). The attack surface is the patch pipeline: whoever can publish a patch changes the code on every installed copy without store review.

- Patch signing (optional): `shorebird release android --public-key-path public.pem` (or `--public-key-cmd`) embeds an RSA public key; `shorebird patch ... --private-key-path private.pem` signs patches; the updater then loads only patches signed with the matching key. Shorebird docs: no required code changes, supports command-based signing with cloud KMS/HSM, and warn that the private key must not be in public source control (it is not sufficient alone: attackers would also need Shorebird credentials). Losing the key means a new release is required.
- Review: is signing enabled for sensitive apps? Where is `SHOREBIRD_TOKEN` stored (CI secret store, scoped)? Who can run `shorebird patch` (CI approvals, branch protection)? Are private keys in the repo? Is there a rollback procedure (Shorebird supports rolling back a patch)?
- Missing patch signing: **Hardening** (it removes the vendor and account compromise from the trust base). A committed private key or token: **High/Critical** (can ship code to all users).
- Store policies (Shorebird FAQ): do not use patches for significant behavioral changes beyond what users and stores accepted.
- Google Play in-app updates and forced-upgrade checks (MASVS-CODE-1/-2) are about getting users off vulnerable versions: a minimum-version endpoint is good practice when older builds have known flaws.

## Remote-driven behavior

Server-controlled configuration expands the trust boundary to whoever controls the server, CDN or remote-config project.

- **Remote Config / feature flags** (`firebase_remote_config`, LaunchDarkly, custom JSON) that carry API base URLs, WebView URLs, pinning keys, deep-link routes, or "admin" toggles. Validate hosts and schemes (`network-tls.md`, `webviews.md`); never use them as access control.
- **Server-driven UI**: `rfw` 1.1.4 renders declarative widget descriptions at runtime; JSON-to-widget systems and `dart_eval` 0.8.5 ("dynamic execution and code push for AOT Dart apps") interpret server-provided definitions or bytecode. Check which capabilities (navigation, URLs, file or channel calls, events) are reachable from remote definitions, that definitions are authenticated and integrity-protected, and that unknown actions are rejected.
- **Downloaded native code or assets**: `DynamicLibrary.open`, `DexClassLoader`, `System.load` from downloaded files; Flutter's false-positives page: executables must not sit on external storage before loading, and "the files should be signed and cryptographically verified prior to dynamic loading". Android risk page: dynamic code loading.
- **Deferred components** (Android dynamic feature modules) delivered through Play are signed with the app; treat other download paths as dynamic code.
- **Build-time code**: Dart build hooks (`hook/build.dart`, Dart 3.10+) can compile or download native assets, so a dependency runs code and fetches binaries at build time (`dependencies.md`).

## Severity, false positives, verification

- Server-controllable URL used for credentialed requests or WebView with bridges: **High**; unsigned remote code or definitions that can invoke privileged actions: **High**; Shorebird token or patch-signing key leaked: **High/Critical**; missing signing, root detection, obfuscation, anti-debug, pinning: **Hardening/Info**.
- Not findings: absence of obfuscation or root detection; use of Shorebird itself; Remote Config for non-sensitive UI copy; `kDebugMode`-only debug tooling.
- Verify: unpack a release build and confirm what is readable (`secrets-binary.md`); with App Check/Play Integrity, call the API with a missing or invalid token on staging and expect rejection; review CI for who can publish patches; test fail-closed/fail-open behavior of detection on an emulator and a rooted test device you own.

References: OWASP MASVS-RESILIENCE-1..4, MASVS-CODE-1/-2; OWASP Mobile Top 10 2024 M7; https://mas.owasp.org/MASVS/ (RESILIENCE), https://docs.flutter.dev/deployment/obfuscate, https://docs.shorebird.dev/code-push/guides/patch-signing/, https://docs.flutter.dev/reference/security-false-positives, https://developer.android.com/privacy-and-security/risks/dynamic-code-loading.
