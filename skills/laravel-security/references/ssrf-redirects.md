# Laravel — SSRF and Open Redirects

## Contents
- SSRF sinks
- What makes SSRF exploitable
- Fix patterns
- Open redirects
- Verification

## SSRF sinks

Any server-side fetch of a URL, host or path the user influences:

```php
Http::get($request->input('url'));                  // HTTP client (Guzzle)
Http::withOptions([...])->post($webhook->url, ...); // user-configured webhooks
file_get_contents($url);  fopen($url, 'r');  copy($url, $dest);
Image::make($url) / ImageManager::read($url)        // Intervention Image
getimagesize($url);  simplexml_load_file($url);
$client->request('GET', $request->callback);        // direct Guzzle
Storage::build(['driver' => 's3', 'endpoint' => $userEndpoint])
```

Indirect SSRF through renderers:
- **HTML-to-PDF / screenshot** (dompdf with `isRemoteEnabled`/`enable_remote`, Browsershot/Puppeteer, wkhtmltopdf, Snappy, Gotenberg) rendering user-supplied HTML or URLs. Tags like `<img src="http://169.254.169.254/...">` and `<iframe src="file:///etc/passwd">` fetch internal resources or local files. Chrome-based renderers can also execute JS.
- **Link previews / oEmbed / OpenGraph unfurling**, RSS importers, "import from URL", avatar-from-URL, and webhook test buttons.
- **SVG/XML processing** with external entities (see `injection.md`).

## What makes SSRF exploitable

State these in the finding to set severity:

- **Cloud metadata:** AWS `169.254.169.254` (IMDSv1 needs no token; IMDSv2 requires a PUT with a header, which limits basic SSRF), GCP `metadata.google.internal` (requires `Metadata-Flavor` header), Azure `169.254.169.254` (requires `Metadata: true` header). Reachable credentials → **Critical**.
- **Internal services:** Redis, Elasticsearch, admin panels, `localhost` debug tools (Horizon/Telescope on internal hosts), Docker socket proxies, Kubernetes API.
- **Response visibility:** full response returned to the user (high impact) vs blind (lower, but still allows port scanning and blind exploitation).
- **Schemes:** Guzzle supports `http`/`https` only. PHP stream functions (`file_get_contents`) also accept `file://`, `php://`, `ftp://`, `data:`, and `phar://` (pre-PHP-8 deserialization).
- **Redirect following:** Guzzle follows redirects by default (up to 5). An allow-listed external URL can redirect to an internal one.

## Fix patterns

1. **Allow-list destinations** where the feature permits (known domains, known webhook providers).
2. Otherwise **validate the resolved IP**, not the hostname string. Resolve DNS, reject private, loopback, link-local, multicast and reserved ranges (IPv4 and IPv6, including `::ffff:127.0.0.1`, `0.0.0.0`, decimal/octal IP encodings), then **connect to the IP you validated** to avoid DNS rebinding. Libraries help here; hand-rolled regexes on the URL string are a common false fix.
3. Disable or re-validate redirects: `Http::withOptions(['allow_redirects' => false])`, or validate each hop.
4. Restrict schemes to `http`/`https`. Never pass user URLs to `file_get_contents`.
5. Renderers: dompdf → keep `isRemoteEnabled` false and set `chroot`; Browsershot → block requests by host via request interception, or render from sanitized HTML with network disabled.
6. Network layer (defense in depth): egress firewall, IMDSv2 required (`HttpTokens=required`), metadata hop limit 1 for containers.

## Open redirects

**Sinks:**

```php
return redirect($request->input('next'));
return redirect()->to($request->query('return_url'));
return redirect()->away($request->input('url'));
return Redirect::to($request->headers->get('referer'));
```

`redirect()->intended()` uses the URL stored in the session by the `auth` middleware. That's safe unless code stores user input into `url.intended` (`session()->put('url.intended', $request->next)`) or `redirect()->setIntendedUrl($input)`.

**Validation pitfalls:** `str_starts_with($url, '/')` allows `//evil.com` and `/\evil.com`. `str_contains($url, 'example.com')` allows `example.com.evil.com`. `parse_url` differences between validator and browser.

**Fix:**

```php
$next = $request->input('next', '/dashboard');
if (! Str::startsWith($next, '/') || Str::startsWith($next, ['//', '/\\'])) {
    $next = '/dashboard';
}
return redirect($next);
// or compare parse_url($next, PHP_URL_HOST) against an allow-list of hosts
```

**Severity:** a standalone open redirect is usually **Low/Medium** (phishing). Raise it to **High** if it leaks OAuth codes or tokens (open redirect in an OAuth `redirect_uri` flow, or password-reset/magic-link flows that append tokens).

## Verification

```php
it('blocks internal addresses', function (string $url) {
    $this->actingAs(User::factory()->create())
        ->postJson('/api/link-preview', ['url' => $url])
        ->assertUnprocessable();
})->with([
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/',
    'http://0x7f000001/', 'file:///etc/passwd', 'http://localtest.me/',
]);

it('does not redirect off-site', function () {
    $this->get('/login?next=//evil.example')->assertRedirect('/dashboard');
});
```

Use `Http::fake()` in tests so nothing actually leaves the test runner. For manual confirmation, use a request-catcher you control, never third-party internal targets.

References: OWASP SSRF Prevention Cheat Sheet, Unvalidated Redirects Cheat Sheet, OWASP API7:2023; CWE-918, CWE-601; https://laravel.com/docs/http-client.
