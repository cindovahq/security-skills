# Flutter — WebViews and JavaScript Bridges

## Contents
- Packages and defaults
- The bridge is the risk
- Navigation and URL loading
- Dart-to-JS injection
- File, content and mixed-content access
- TLS errors, debugging and cookies
- Safe pattern
- Severity, false positives, verification

## Packages and defaults

| Package (checked 2026-10-02) | Notes |
|---|---|
| `webview_flutter` 4.14.1 (+ `webview_flutter_android` 4.14.1, `webview_flutter_wkwebview` 3.27.0) | Android `WebView`, iOS/macOS `WKWebView`. `JavaScriptMode.disabled` or `.unrestricted` is set explicitly with `setJavaScriptMode`; when unset, JavaScript is off on Android (WebSettings default) but on in WKWebView. `NavigationDelegate` hooks: `onNavigationRequest` (with `isMainFrame`), `onPageStarted/Finished`, `onWebResourceError`, `onSslAuthError`, `onHttpAuthRequest` |
| `flutter_inappwebview` 6.1.5 (2024-10-08; 6.2.0-beta.3 on pub since 2026-02) | Much larger API: `InAppWebViewSettings`, `addJavaScriptHandler`, `shouldOverrideUrlLoading` (needs `useShouldOverrideUrlLoading`), `onReceivedServerTrustAuthRequest`, `isInspectable`. `javaScriptEnabled` is on by default |
| `url_launcher` with `LaunchMode.externalApplication` / in-app browser view | Custom Tabs / SFSafariViewController: no JavaScript bridge to your app, the right choice for third-party pages |

Advisory state (queried 2026-10-02 against GitHub): no published security advisories for `webview_flutter` or `flutter_inappwebview`. Do not invent CVEs for them; report concrete misuse instead. Android WebView itself updates through the system.

## The bridge is the risk

A JavaScript channel gives web content a way to call Dart/native code. Android's guidance: `addJavascriptInterface` "injects a supplied Java object into every frame of the WebView, including iframes", and "there is no mechanism for the application to verify the origin of the calling frame". `webview_flutter`'s `addJavaScriptChannel(name, onMessageReceived:)` and `flutter_inappwebview`'s `addJavaScriptHandler(handlerName:, callback:)` build on `addJavascriptInterface` on Android (stated in the inappwebview docs) and on a WKWebView script message handler on iOS. So:

- Any page, ad iframe, injected script or XSS in a page loaded into that WebView can call the channel. Channels apply to the next page load (`addJavaScriptChannel` docs).
- Review every channel/handler: what native or Dart action does it perform (open URLs, read tokens, write files, launch intents, make authenticated requests, start payments)? Does it validate its arguments?
- A channel on a WebView that can navigate to third-party or user-supplied URLs is a **High** finding when the channel does anything sensitive. A channel on a constant first-party origin whose pages you control, with navigation locked to that origin, is the intended use.
- Do not pass access tokens to pages through channels or `runJavaScript("localStorage.setItem('token', ...)")` unless the page is first-party, the token is short-lived and audience-limited, and navigation is locked down.

## Navigation and URL loading

- `loadRequest(Uri.parse(userInput))`, `InAppWebView(initialUrlRequest: URLRequest(url: WebUri(x)))` where `x` comes from a deep link, API field, push payload or text field: attacker-chosen page inside your app chrome, phishing, and JS bridge exposure (`deep-links.md`).
- Use `onNavigationRequest` (webview_flutter) or `shouldOverrideUrlLoading` (inappwebview) to allow only expected schemes and hosts, and treat `isMainFrame == false` separately. Allow-list `https` and exact hosts; block `file:`, `javascript:`, `data:`, `intent:` and custom schemes unless required. Open off-site links with `url_launcher` externally.
- `loadHtmlString(html, baseUrl: ...)` with server or user HTML: sanitize it, and avoid giving it a first-party `baseUrl`, JavaScript or a channel.
- Host checks: compare `uri.host` with exact values; `endsWith('acme.example')` also matches `evilacme.example`.

## Dart-to-JS injection

```dart
controller.runJavaScript("showName('$name')");                 // finding: string-built script
controller.runJavaScript('showName(${jsonEncode(name)})');     // JSON-encode data; still prefer messages
```

`runJavaScript`/`evaluateJavascript` with interpolated user, API or deep-link data is script injection into the page (and its channels).

## File, content and mixed-content access

- webview_flutter (Android): `AndroidWebViewController.setAllowFileAccess` — default `true` when targeting API 29 or lower and `false` when targeting API 30+. `loadFile`, `loadFlutterAsset`, `setAllowContentAccess` and `setMixedContentMode(MixedContentMode.alwaysAllow)` widen access; `alwaysAllow` lets HTTPS pages pull HTTP subresources (finding).
- flutter_inappwebview: `allowFileAccessFromFileURLs` and `allowUniversalAccessFromFileURLs` (both default `false`; the plugin's own docs warn "Don't enable this setting if you open files that may be created or altered by external sources"), `allowFileAccess`, `allowContentAccess` (default true), `mixedContentMode`. Android deprecated `setAllowUniversalAccessFromFileURLs` in API 30 with "This setting is not secure, please use androidx.webkit.WebViewAssetLoader". Prefer the plugin's WebViewAssetLoader option for local content.
- iOS: `NSAllowsArbitraryLoadsInWebContent` in `Info.plist` removes ATS for WebViews (`platform-config.md`).
- Downloads and file choosers (`onShowFileSelector`, download handlers) writing to external storage: validate names (`image_picker_android`/`file_selector_android` had path-handling advisories fixed in 0.8.12+18 and 0.5.1+12; see `dependencies.md`).

## TLS errors, debugging and cookies

- `NavigationDelegate(onSslAuthError: (e) => e.proceed())` and `onReceivedServerTrustAuthRequest` returning `ServerTrustAuthResponse(action: ServerTrustAuthResponseAction.PROCEED)` disable certificate checks for the page (`network-tls.md`). The `SslAuthError` docs say `proceed` "should generally only be used in test environments".
- `AndroidWebViewController.enableDebugging(true)`, `InAppWebViewController.setWebContentsDebuggingEnabled(true)` or `InAppWebViewSettings(isInspectable: true)` outside `kDebugMode`: remote debugging of in-app pages. **Low/Medium**.
- Cookies and session: `WebViewCookieManager().clearCookies()` on logout; do not share one WebView session across accounts; avoid putting tokens in URLs.

## Safe pattern

```dart
final controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.disabled)                       // enable only if the page needs it
  ..setNavigationDelegate(NavigationDelegate(
    onNavigationRequest: (r) {
      final u = Uri.tryParse(r.url);
      final ok = u != null && u.scheme == 'https' && u.host == 'help.acme.example';
      return ok ? NavigationDecision.navigate : NavigationDecision.prevent;
    },
  ))
  ..loadRequest(Uri.parse('https://help.acme.example/'));            // constant first-party URL
```

## Severity, false positives, verification

- JS channel/handler reachable by untrusted or user-chosen content and exposing tokens or privileged actions: **High** (**Critical** if it executes commands or reads arbitrary files). User-controlled URL in a WebView without a bridge: **Medium/Low** (phishing, cookie/session abuse). `onSslAuthError.proceed`/`PROCEED`: **High**. File-URL universal access or `alwaysAllow` mixed content: **Medium**. Debugging enabled in release: **Low**.
- Not findings: a WebView loading only a constant first-party `https://` URL; `JavaScriptMode.unrestricted` with no channels on first-party content; `NavigationDelegate` allow-list that prevents other hosts; `flutter_inappwebview` `javaScriptEnabled` default; `url_launcher` opening external links.
- Verify: unit/widget test the allow-list function with `https://help.acme.example.evil.example`, `http://`, `javascript:alert(1)` (a harmless marker is enough), `file:///`; in a debug build, load a local test page that calls the channel with unexpected arguments and confirm the Dart handler rejects them; `rg "addJavaScriptChannel|addJavaScriptHandler|runJavaScript|loadRequest|loadHtmlString|initialUrlRequest|onSslAuthError|PROCEED|enableDebugging|setWebContentsDebuggingEnabled|mixedContentMode|allowUniversalAccess" lib/`.

References: OWASP MASVS-PLATFORM-2; MASTG WebView tests; OWASP Mobile Top 10 2024 M4; CWE-79, CWE-749, CWE-346; https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges, https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading, https://pub.dev/packages/webview_flutter, https://pub.dev/packages/flutter_inappwebview.
