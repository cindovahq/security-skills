# Flutter — Web Builds

## Contents
- What is different on the web
- Public code and source maps
- Storage and sessions
- DOM sinks: dart:html, package:web, HtmlElementView
- Messaging, headers and CSP
- Severity, false positives, verification

Apply the rest of this skill to the Dart code; this file covers what changes when `flutter build web` (JavaScript or Wasm) is a deployment target. For general browser-side concerns (CSP design, CORS, cookies) the headers/CSP and CSRF/CORS references of the `react-security` skill are good companions if installed.

## What is different on the web

- Everything is delivered to the browser: `main.dart.js` or `main.dart.wasm`, `flutter_bootstrap.js`, assets, fonts and `AssetManifest`. Anyone can download and read it. There is no obfuscation for web (Flutter docs: "Web apps don't support obfuscation. A web app can be minified, which provides a similar result."). Secrets, `--dart-define` values and bundled `.env` files are public (`secrets-binary.md`).
- Android/iOS-only controls do not apply: no Keychain/Keystore, `FLAG_SECURE`, root detection, App Links or manifest. Conversely, browser controls (cookies, CSP, CORS, same-origin policy, frame protection) become your platform security.
- Flutter draws to a canvas (CanvasKit/Skwasm), so classic DOM XSS from widget text is rare; the risks live at the boundaries: platform views, JS interop, URL handling, storage, and headers.
- `flutter_secure_storage` on web works only on HTTPS or localhost (its README) and is browser storage: readable by any script on the origin. `shared_preferences` on web uses `localStorage`. Do not treat either as protection against XSS.

## Public code and source maps

- `flutter build web --source-maps` is opt-in (default off; docs: it creates separate `.js.map` or `.wasm.map` files in `build/web`). Deploying them publishes readable original Dart structure and comments. **Low/Hardening** alone; upload maps privately to the error tracker and do not serve them.
- Check hosting output (`build/web`, `firebase.json` `public`) for stray files: `.env`, `*.map`, `*.pem`, `serviceAccount*.json`, `assets/` test data, and for `.git` or backup files copied by CI.
- API keys for web are exposed by design: restrict Google API keys by HTTP referrer; Firebase web config is public (`secrets-binary.md`).

## Storage and sessions

- Tokens in `localStorage`/IndexedDB (including `shared_preferences`, Hive on web, Firebase Auth's default web persistence) are readable by any injected script. Prefer an HttpOnly, Secure, SameSite session cookie issued by your backend (BFF) where the architecture allows; otherwise short-lived access tokens, no long-lived refresh tokens in script-readable storage, and a strong CSP.
- Cookie-authenticated APIs need CSRF defenses and a tight CORS policy (exact origins, no `*` with credentials); Dio's browser adapter has a `withCredentials` option. Bearer-token APIs do not need CSRF tokens.
- OAuth on web: `flutter_appauth` does not target web; `flutter_web_auth_2` opens a popup/redirect page and returns the callback URL through browser messaging, so verify `state`, PKCE and message origins in the redirect page (`authentication.md`).

## DOM sinks: dart:html, package:web, HtmlElementView

- **`dart:html` is deprecated** in favor of `package:web` + `dart:js_interop` (Dart docs: `package:web` is "replacing dart:html and other web libraries"; `dart:html` is not supported when compiling to Wasm). Both appear in Flutter web code and plugins.
- `dart:html` `Element.innerHtml = x` sanitizes by default ("uses the default sanitization behavior"); `setInnerHtml(x, validator: ..., treeSanitizer: NodeTreeSanitizer.trusted)` or a permissive `NodeValidatorBuilder` removes that protection. `createFragment(x, treeSanitizer: NodeTreeSanitizer.trusted)` likewise. Inputs from URLs, APIs or users reaching these = **XSS**.
- The Dart linter's `unsafe_html` rule (now deprecated and removed) listed these `dart:html` sinks, which remain good grep targets: assigning `AnchorElement.href`, `src` of `EmbedElement`/`IFrameElement`/`ScriptElement`, `IFrameElement.srcdoc`, `Element.createFragment`, `Window.open`, `Element.setInnerHtml`, `Element.html(...)`, `DocumentFragment.html(...)`.
- `package:web` `element.innerHTML = value.toJS`, `insertAdjacentHTML`, `document.write`, `HTMLScriptElement.src/text` and `HTMLIFrameElement.srcdoc` are raw browser sinks with no Dart sanitization. Same for `globalContext.callMethod('eval'.toJS, ...)` and `Function` constructors via interop.
- **`HtmlElementView`** (platform views) embeds arbitrary DOM (`registerViewFactory` / `HtmlElementView.fromTagName`): iframes with attacker-influenced `src`, missing `sandbox`/`allow` attributes, `<a href>` built from API data (`javascript:`), HTML-rendering packages fed untrusted markup. Allow-list URLs (`https` only) and sanitize HTML on the server or with a maintained sanitizer.
- `window.postMessage` listeners (`web.window.onMessage`, `addEventListener('message', ...)`) must check `event.origin` exactly; senders must pass an explicit `targetOrigin`, never `'*'`, for sensitive data.
- Router URLs (hash `/#/path` is the default strategy; path strategy via `usePathUrlStrategy()`): route and query parameters are untrusted input (`deep-links.md`).

## Messaging, headers and CSP

- Hosting headers are not in the Flutter repo; check `firebase.json` `hosting.headers`, nginx/CDN config, Netlify/Vercel files: CSP, `frame-ancestors` (clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS, `Cache-Control` for authenticated responses. Missing headers alone are **Hardening**.
- `flutter build web --csp` ("Disable dynamic generation of code in the generated output. This is necessary to satisfy CSP restrictions", `flutter build web -h`) matters if you deploy a strict `script-src`; test the bootstrap, renderer files and fonts against your policy because defaults may load resources from CDNs.
- Custom service workers must not cache authenticated API responses for the next user of the browser.

## Severity, false positives, verification

- Unsanitized HTML/URL from untrusted data into a DOM sink: **High** if it can reach other users (stored) or run in an authenticated origin; **Medium** for reflected-only. Script-readable long-lived tokens: **Medium** (impact amplifier for XSS). Source maps or `.env` published: **Low** to **High** by contents. Missing CSP/HSTS alone: **Hardening**.
- Not findings: public Firebase/Supabase web config; `dart:html` use with default sanitization on trusted content; `HtmlElementView` showing a constant first-party iframe/video; absence of obfuscation on web; Flutter text widgets rendering user strings (drawn as pixels, not parsed as HTML).
- Verify: `flutter build web --release` then `find build/web -name '*.map' -o -name '.env*'`; `grep -rE "sk_|secret|service_role" build/web | head`; run the app against staging and check response headers with `curl -sI`; for sinks, a widget/integration test (`flutter test --platform chrome`) that renders content containing `<img src=x onerror="document.title='xss-test'">` and asserts the title is unchanged.

References: OWASP MASVS (client-side concepts: STORAGE, PLATFORM-2/-3, CODE-4); OWASP ASVS 5.0; CWE-79, CWE-922, CWE-942; https://docs.flutter.dev/deployment/web, https://docs.flutter.dev/deployment/obfuscate, https://dart.dev/interop/js-interop/package-web, https://api.flutter.dev/flutter/dart-html/Element/innerHtml.html.
