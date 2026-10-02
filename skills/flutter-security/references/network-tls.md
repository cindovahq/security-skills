# Flutter — Network Security, TLS and Pinning

## Contents
- Two network stacks, two sets of rules
- Cleartext traffic
- Disabled certificate validation
- Pinning: options and trade-offs
- Proxies and interception
- Credentials sent to the wrong host
- Severity, false positives, verification

## Two network stacks, two sets of rules

| Traffic | Stack | Honors Android Network Security Config / `usesCleartextTraffic` and iOS ATS? |
|---|---|---|
| `package:http` default client (`IOClient`), Dio's default `IOHttpClientAdapter`, `Image.network`, `WebSocket.connect`, `HttpClient` | `dart:io` sockets and BoringSSL owned by Dart | **No.** Flutter's own docs: "Flutter does not enforce any policy at socket level... If the socket is owned by Dart/Flutter, no policy will be enforced." A 2.0 change that enforced platform cleartext policy was reverted in 2.2.0 (`docs.flutter.dev/release/breaking-changes/network-policy-ios-android`); `flutter/flutter#106678` records that `usesCleartextTraffic="false"` has no effect on Dart traffic |
| WebViews, `url_launcher`, native SDKs (Firebase, Sentry native), `cronet_http` 1.10, `cupertino_http` 3.1, `native_dio_adapter` 1.8 | Platform stacks (`HttpURLConnection`/OkHttp/Cronet, `URLSession`) | Cleartext policy: yes. NSC/`NSPinnedDomains` pins: documented for platform HTTP stacks and WebViews, unverified for these Dart packages; test it |

Consequences for review: (1) cleartext and pinning must be enforced **in Dart code** for `dart:io` traffic, whatever the manifest says; (2) a strict manifest is still worth having because it governs WebViews and native SDKs; (3) a permissive manifest (`cleartextTrafficPermitted="true"`, `NSAllowsArbitraryLoads`) is a finding on its own for the traffic it does govern, and a signal to read the Dart code for `http://`.

## Cleartext traffic

- Dart: `http://` literals in base URLs, `Uri.http(...)`, `ws://`, API URLs read from remote config or `--dart-define` without scheme validation. A production `API_BASE_URL=http://...` carrying tokens or PII is a finding.
- Android: `android:usesCleartextTraffic` defaults to `false` when targeting API 28+ (`true` for 27 and lower). The attribute "is getting deprecated and will be ignored for apps targeting API levels 38 and above"; use a Network Security Config (`android:networkSecurityConfig="@xml/network_security_config"`). Risky NSC: `<base-config cleartextTrafficPermitted="true">`, wide `domain-config`s with cleartext, `<certificates src="user"/>` in release (apps targeting API 24+ do not trust user-added CAs by default), custom `<trust-anchors>` that add broad or non-public CAs in release. `debug-overrides` is the intended place for debug-only trust.
- Flutter's template keeps cleartext off. The Flutter breaking-change page shows allowing HTTP for **debug** builds through `android/app/src/debug/AndroidManifest.xml` and `src/debug/res/xml/network_security_config.xml`. The same config in `src/main` ships to release.
- iOS: ATS blocks plain HTTP by default. `NSAppTransportSecurity` > `NSAllowsArbitraryLoads` = true disables ATS for all domains not listed (App Review needs a justification); `NSAllowsArbitraryLoadsInWebContent` does it for web views; `NSExceptionDomains` > `NSExceptionAllowsInsecureHTTPLoads` per domain; `NSAllowsLocalNetworking` covers local hosts only. On iOS 10+, `NSAllowsArbitraryLoads` is ignored when `NSAllowsArbitraryLoadsInWebContent`, `NSAllowsLocalNetworking` or `NSAllowsArbitraryLoadsForMedia` is present (any value), so read the effective combination before rating. Prefer narrow per-domain exceptions, and keep them in a debug-only plist (`Info-debug.plist`) as Flutter's docs suggest.

```dart
final base = Uri.parse(const String.fromEnvironment('API_BASE_URL'));
assert(base.scheme == 'https');                       // dev only
if (kReleaseMode && base.scheme != 'https') throw StateError('API base URL must be https');
```

## Disabled certificate validation

Search for these; each is a way to accept any certificate:

```text
badCertificateCallback = (        => true      HttpOverrides.global =      createHttpClient: ... badCertificateCallback
onReceivedServerTrustAuthRequest  ServerTrustAuthResponseAction.PROCEED   onSslAuthError  .proceed()
allowInsecureConnections: true    (flutter_appauth requests; default false)
```

`HttpClient.badCertificateCallback` is only consulted for certificates that cannot be authenticated; returning `true` unconditionally lets any attacker on the network read and modify TLS traffic, including tokens. `HttpOverrides.global` with such a callback applies to every `dart:io` request in the app, including packages. `webview_flutter`'s `SslAuthError.proceed()` is documented as "generally only be used in test environments". Severity: **High** (Critical if it reaches release for an app moving credentials or money). Common origin: "fix for self-signed dev server" left in `main()` without `kDebugMode`/flavor guards.

Fix: delete the callback; trust the real chain. For private CAs or dev servers, add the CA explicitly:

```dart
final ctx = SecurityContext(withTrustedRoots: true)..setTrustedCertificatesBytes(caPemBytes);
final client = HttpClient(context: ctx);              // no badCertificateCallback
```

## Pinning: options and trade-offs

Pinning limits which certificates/keys the app accepts for **your own** endpoints (MASVS-NETWORK-2). It defends against rogue or compromised CAs and some network attackers. It does not defend against an attacker who controls the device (instrumentation or a patched engine can bypass it), and it creates an outage risk when certificates rotate. Treat absence as **Hardening** unless the app's threat model (banking, health, government) calls for it.

| Approach | Covers | Notes |
|---|---|---|
| Android NSC `<pin-set expiration=...>` with SPKI SHA-256 `<pin digest="SHA-256">` | Platform stack only (WebViews, native SDKs, `cronet_http`) | Android docs: always include a backup pin; setting an expiration "may enable attackers to bypass your pinned certificates" |
| iOS `NSAppTransportSecurity` > `NSPinnedDomains` (`NSPinnedCAIdentities`/`NSPinnedLeafIdentities`, iOS 14+) | Platform stack only (`URLSession`, `cupertino_http`, WKWebView) | Pinning does not change other ATS requirements |
| Native HTTP client (`cronet_http`, `cupertino_http`, `native_dio_adapter`) | Makes Dart code inherit platform cleartext policy (NSC/ATS); pin enforcement through NSC/`NSPinnedDomains` is unverified | Different TLS behavior from `dart:io`; test pins with a mismatched certificate |
| `SecurityContext(withTrustedRoots: false)` + `setTrustedCertificatesBytes` of your CA/intermediate | `dart:io` stack | Pins a CA; safer for rotation than leaf pinning. On iOS some certificate-manipulation methods are not implemented; the platform trust store is used through `SecurityContext.defaultContext` |
| Dio `IOHttpClientAdapter(validateCertificate: (cert, host, port) => ...)` comparing a SHA-256 of `cert.der` (SPKI requires parsing the DER yourself) | `dart:io` stack | Dio's README pairs it with `createHttpClient` using `SecurityContext(withTrustedRoots: false)` and `badCertificateCallback = (...) => true` so validation happens only in `validateCertificate`. That is the documented pinning idiom, not an open trust, **but** `validateCertificate` runs after the request has been sent: a MITM still sees request headers and body, and only the response is rejected. For credentialed endpoints prefer a pre-send check (`badCertificateCallback` comparing a hash and returning `false` otherwise, or a CA pin via `SecurityContext(withTrustedRoots: false)` + `setTrustedCertificatesBytes`) |
| `http_certificate_pinning` 3.0.2 and similar | Dart fingerprint checks | Review what it validates and when; do not assume it covers WebViews or other clients |

Operational rules: pin a CA/intermediate or the SPKI of at least two keys (current + backup); do not pin third-party endpoints you do not control (Google APIs, CDNs, analytics); plan rotation and ship remote pin updates or expiry carefully; test with an expired and a wrong certificate.

## Proxies and interception

Dart's `HttpClient` does not use OS proxy settings: per the `findProxy` docs, direct connections are used unless `findProxy` is set (`HttpClient.findProxyFromEnvironment` reads environment variables). Flutter apps therefore often do not appear in a system-proxy tool, but that is **not a security control** and must not be cited as one. Report instead a hard-coded `client.findProxy = (uri) => 'PROXY 10.0.0.5:8888'` or debugging proxy left in release code, especially combined with a trusting `badCertificateCallback`.

## Credentials sent to the wrong host

- Dio interceptors that add `Authorization` to every request: Dio's `RequestOptions.uri` does not prepend `baseUrl` when the path starts with `http:` or `https:` (verified in `dio` source), so a server-provided `next`/`download_url`/`avatar_url` pointing to another host receives the bearer token. Fix: attach the header only when `options.uri.host` is on an allow-list.
- Base URL or host taken from a deep link, QR code, remote config or user input without an allow-list (`deep-links.md`).
- Tokens in URL query strings (logged by proxies, CDNs, crash reports); prefer headers.
- Redirects: before Dart 2.16, `dart:io` `HttpClient` forwarded explicitly set `Authorization`/`Cookie` headers across origins on redirects (GHSA-c8mh-jj22-xg5h, CVE-2022-0451). Keep the SDK current and do not rely on the client to scope credentials.

## Severity, false positives, verification

- Unconditional `badCertificateCallback`/`PROCEED` in release code: **High/Critical**. Cleartext API in production with tokens: **High** (Medium if only public content). Permissive NSC/ATS with all Dart traffic HTTPS: **Low/Medium** (affects WebViews/SDKs). Missing pinning: **Hardening**.
- Not findings: Dio's documented pinning idiom (at most an Informational note that it checks after sending, on credentialed endpoints); `badCertificateCallback` that compares `cert.der` hash/PEM to a pinned value and returns `false` otherwise; cleartext config under `src/debug/` only; `NSAllowsLocalNetworking`; `http://localhost` / `10.0.2.2` in debug-only code; Missing `usesCleartextTraffic="false"` on a target-28+ app.
- Verify: `rg "badCertificateCallback|HttpOverrides|PROCEED|\.proceed\(|allowInsecureConnections|http://" lib/`; `apkanalyzer manifest print app-release.apk | grep -i "cleartext\|networkSecurity"`; merged manifest with `./gradlew :app:processReleaseMainManifest`; against staging, point the app at a host with an untrusted or expired certificate and expect connection failure; if pinning exists, expect failure with a valid but unpinned certificate.

References: OWASP MASVS-NETWORK-1/-2; MASTG network tests; OWASP Mobile Top 10 2024 M5; CWE-295, CWE-319; https://developer.android.com/privacy-and-security/security-config, https://developer.android.com/privacy-and-security/risks/cleartext-communications, https://developer.android.com/privacy-and-security/risks/unsafe-trustmanager, https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity, https://pub.dev/packages/dio (HTTPS certificate verification), https://api.flutter.dev/flutter/dart-io/HttpClient/badCertificateCallback.html.
