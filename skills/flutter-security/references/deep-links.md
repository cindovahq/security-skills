# Flutter — Deep Links, App Links and Incoming Intents

## Contents
- How links reach a Flutter app
- Registration: Android and iOS
- Handling untrusted link data in Dart
- What other apps can send to an exported activity
- Outbound links (url_launcher)
- Severity, false positives, verification

## How links reach a Flutter app

- **Flutter's default handler.** Unless disabled, Flutter delivers an incoming link to the framework as a route (`initialRoute`, then `pushRoute` or the `RouteInformationParser`). Apps using a plugin (`app_links` 7.2.1, the abandoned `uni_links` 0.5.1 from 2021) opt out with `flutter_deeplinking_enabled` = false in `AndroidManifest.xml` or `FlutterDeepLinkingEnabled` = false in `Info.plist`. Check that both handlers are not active at once (double handling, or a guard applied to one path only).
- **Routers:** `go_router` 18.0.2 (`GoRouterState.uri`, `pathParameters`, `redirect`, `onEnter`), `auto_route`, Navigator named routes. Whatever reads `state.uri.queryParameters`, `pathParameters` or `extra` is consuming untrusted input when the route can be opened by a link.
- **Plugin streams:** `AppLinks().uriLinkStream` / `getInitialLink()`; push-notification payloads that carry a `route`/`url` are the same class of input.

## Registration: Android and iOS

Android (`android/app/src/main/AndroidManifest.xml`):

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="app.acme.example" android:pathPrefix="/orders"/>
</intent-filter>
```

- `android:autoVerify="true"` plus `https://<host>/.well-known/assetlinks.json` (package name and SHA-256 signing fingerprint) makes it an Android App Link: only your app opens it by default. Android's risk page: "By design, Android allows multiple apps to register intent filters for the same deep link URI", so unverified `http(s)` and custom-scheme links can be claimed by other apps; Android 12 tightened this for web intents.
- Custom schemes (`acmeapp://`) are claimable by any app. Never put authorization codes, session tokens or one-click privileged actions behind a custom scheme without PKCE/state and confirmation (`authentication.md`).
- `<data android:scheme="https"/>` with no host/path, or `pathPattern=".*"`, accepts every link on a host; keep paths narrow.
- `android:exported="true"` is needed for the main activity and for any activity with an intent filter that other apps must start (API 31+ requires it to be explicit). Review all other activities, services, receivers and providers, including those added by plugins and manifest merge (`platform-config.md`).
- AppAuth's `RedirectUriReceiverActivity` is exported by design.

iOS: Associated Domains entitlement (`Runner.entitlements`, `applinks:app.acme.example`) plus the `apple-app-site-association` file for Universal Links; `CFBundleURLTypes` in `Info.plist` for custom schemes. Apple: custom schemes "offer a potential attack vector into your app, so make sure to validate all URL parameters and discard any malformed URLs"; universal links are "strongly recommended". `LSApplicationQueriesSchemes` only whitelists schemes the app may probe with `canOpenURL`; it is not an exposure.

Flutter's cookbooks (`docs.flutter.dev/cookbook/navigation/set-up-app-links` and `set-up-universal-links`) cover the setup; a wrong or missing `assetlinks.json` is a reliability bug unless an attacker-controlled host is trusted.

## Handling untrusted link data in Dart

Findings arise when link data reaches a sink without validation:

| Sink | Example | Risk |
|---|---|---|
| Navigation to an arbitrary route or tab | `context.go(uri.queryParameters['next']!)` | Open-redirect-style navigation into privileged screens, phishing screens |
| WebView URL | `controller.loadRequest(Uri.parse(state.uri.queryParameters['url']!))` | Attacker page inside your app, with JS channels and cookies (`webviews.md`) |
| API request host/path | `dio.get(uri.queryParameters['endpoint']!)`, `baseUrl` from a link | Token sent to attacker host (`network-tls.md`) |
| Object ID | `/orders/:id` straight into `GET /orders/$id` | IDOR is a server problem, but check the screen does not display data it should not |
| State-changing action on open | `/transfer?to=...&amount=...`, `/logout`, `/delete-account`, `/set-email` | Link-triggered actions (CSRF-like) |
| Token or code parameter | `/reset?token=...`, `/verify?code=...`, magic links | Token leakage via logs/analytics; must be single-use and bound server-side |
| File path | `file=../../x`, `path` joined into `File(...)` | Path traversal into app-private files |
| Interprocess hand-off | link data forwarded through a `MethodChannel` to native code | Input trusted on the native side (`platform-channels-native.md`) |

Fix pattern: parse into a typed object, allow-list, and require confirmation for anything sensitive.

```dart
sealed class DeepLink {}
class OrderLink extends DeepLink { OrderLink(this.id); final int id; }

DeepLink? parseDeepLink(Uri uri) {
  if (uri.scheme != 'https' || uri.host != 'app.acme.example') return null;
  final seg = uri.pathSegments;
  if (seg.length == 2 && seg[0] == 'orders') {
    final id = int.tryParse(seg[1]);
    return id == null ? null : OrderLink(id);
  }
  return null;                                   // unknown links go to the home screen
}
```

Also: pass `redirect` targets through the same allow-list helper (`isInternalPath`), apply auth guards in `go_router.redirect` **and** on the API, never put sensitive values in `extra` that a link can set, and treat push-notification `data` the same as a link.

## What other apps can send to an exported activity

Verified in the Flutter engine source (`FlutterActivity.java`): when `MainActivity` is exported (it must be, to be launchable), any app can start it with the Intent extras `route` (initial route), `dart_entrypoint` (name of a Dart function annotated `@pragma('vm:entry-point')`) and `dart_entrypoint_args`. Consequences are usually small, but check that: routes reachable at start-up are guarded by the same auth logic as in-app navigation; no `@pragma('vm:entry-point')` function is a debug/admin/test `main`; `main(List<String> args)` does not trust `args`. Report as **Hardening/Informational** unless a concrete sensitive entrypoint or unguarded route exists.

## Outbound links (url_launcher)

- `launchUrl(uri)` with a server- or user-provided URL: allow-list schemes (`https`, optionally `mailto`, `tel`) and, where relevant, hosts. Prefer `LaunchMode.externalApplication` for untrusted pages instead of an in-app WebView.
- `canLaunchUrl` needs Android `<queries>` entries and iOS `LSApplicationQueriesSchemes`; those are configuration, not findings.

## Severity, false positives, verification

- Link-triggered state change without confirmation or auth: **Medium/High** by action. Link-supplied URL loaded in a WebView with JavaScript channels: **High**. Open redirect-style navigation only: **Low**. Missing `autoVerify` on an `https` intent filter: **Low/Hardening**; with auth codes on custom scheme without PKCE: **Medium/High**.
- Not findings: broad `BROWSABLE` filter on a marketing page route; custom scheme used only for harmless navigation; AppAuth redirect activity exported; link parameters validated with an allow-list and typed parsing; `uri.queryParameters` read without use in sinks.
- Verify: `adb shell am start -a android.intent.action.VIEW -d "https://app.acme.example/orders/abc" <package>` and malformed/unknown paths on a debug build (use only apps you are authorized to test): unknown or malformed links must land on a safe screen; `adb shell pm get-app-links <package>` shows verification state on Android 12+; iOS: `xcrun simctl openurl booted "<url>"`. Unit-test `parseDeepLink` with hostile inputs (extra segments, `//host`, encoded dots, very long IDs).

References: OWASP MASVS-PLATFORM-1 (IPC), MASVS-CODE-4 (input validation); CWE-939, CWE-601, CWE-20; https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks, https://docs.flutter.dev/ui/navigation/deep-linking, https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app, https://developer.android.com/training/app-links/verify-android-applinks.
