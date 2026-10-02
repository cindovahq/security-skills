# Django — SSRF and Open Redirects

## Contents
- Open redirects
- SSRF
- Severity, false positives, verification

## Open redirects

Django's tools:
- `django.utils.http.url_has_allowed_host_and_scheme(url, allowed_hosts, require_https=False)` returns `True` only if the URL is relative or its host is in `allowed_hosts` and its scheme is `http`/`https` (`https` only with `require_https=True`). It returns `False` for empty URLs and treats `///`, backslash tricks and over-long URLs as unsafe. Its docstring adds that `True` does not mean the URL is well-formed; pass untrusted paths through `iri_to_uri()` too.
- `LoginView`, `LogoutView` and `set_language` validate `next` with it. `HttpResponseRedirect` only accepts the `http`, `https` and `ftp` schemes by default (`DisallowedRedirect` otherwise) but happily redirects to any host.

Investigate: `redirect(request.GET["next"])`, `redirect(request.POST.get("next") or "/")`, `HttpResponseRedirect(request.GET[...])`, `redirect(request.META["HTTP_REFERER"])`, `RedirectView` with a user-controlled `url`, custom login/SSO/logout/payment-return views, OAuth `redirect_uri`/`state` handling, `?return_to=`, `?continue=`, `?url=`, and `Location` headers set manually. The `redirect()` shortcut treats any string containing `/` or `.` as a URL, so user data reaches `Location` unchanged.

Not safe: `url.startswith("/")` (allows `//evil.example`), `"example.com" in url`, `urlparse(url).netloc.endswith("example.com")` (matches `evilexample.com`), checks that do not handle backslashes or `/\evil.example`.

```python
next_url = request.GET.get("next", "")
if not url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()},
                                       require_https=request.is_secure()):
    next_url = settings.LOGIN_REDIRECT_URL
return redirect(next_url)
```

Severity: **Low/Medium** alone. **Medium/High** when the redirect is part of login, SSO or OAuth flows (token or code leakage, phishing from the real domain) or can be chained to bypass an SSRF/allow-list check.

## SSRF

Sinks: `requests.get/post/request(user_url)`, `httpx.get(...)`, `urllib.request.urlopen(user_url)` (also supports `file://` and `ftp://`), `urllib3`, `aiohttp`, `http.client`, `socket.create_connection`, `boto3`/SDK clients with user-chosen endpoints, `Image.open(requests.get(url).raw)`, `ImageField` or `FileField` "upload by URL", link previews/oEmbed/unfurling, webhook delivery to user-registered URLs, import-from-URL (CSV, feeds, OpenAPI), PDF/HTML-to-image renderers (WeasyPrint `url_fetcher`, wkhtmltopdf, headless Chrome/Playwright), SVG/XML processors with external entities (`lxml`, `xml.etree` without `defusedxml`), OpenID/OAuth discovery URLs, Celery tasks that fetch what a request supplied.

Targets that raise impact: cloud metadata (`169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`), internal admin panels, Redis/Memcached/Elasticsearch/Docker sockets, other pods and services, `localhost` Django admin or debug pages, internal APIs that trust network position.

Bypass patterns to look for in "protection" code:
- Hostname checks with `startswith`/`in`/regex, or allow-lists that match `example.com.attacker.invalid`, `example.com@attacker.invalid`.
- Blocking only `127.0.0.1` or `localhost`: decimal/octal/hex IPs, IPv6 (`[::1]`, IPv4-mapped), `0.0.0.0`, DNS names resolving to private IPs.
- Validate-then-fetch: the name is resolved twice (DNS rebinding). Resolve once, check `ipaddress.ip_address(ip).is_global`, then connect to that IP.
- Redirects: `requests` follows redirects for GET/HEAD by default; a public URL can redirect to an internal one. Disable redirects (`allow_redirects=False`) or re-validate every hop.
- Schemes: restrict to `https` (or `http`) explicitly. Restrict ports.
- Returning the response body to the user (full-read SSRF) or only status/timing (blind) changes severity.

Fixes, in order of strength: do not fetch user-supplied URLs; fetch only from a fixed allow-list of hosts; route through an egress proxy that denies private ranges; otherwise resolve, validate the IP, pin the connection, cap size and time, disable redirects, drop credentials/headers, run the fetcher in a network segment with no internal access, and never return raw bodies.

Severity: **High** (Critical if cloud credentials or internal admin services are reachable or the response body is returned); **Medium** blind SSRF with limited reach; **Low** when the target set is constrained by egress rules (name the condition).

## Severity, false positives, verification

False positives: `requests.get(settings.EXCHANGE_URL)` or any URL built entirely from constants or server config; user input used only as a **path segment or query value on a fixed trusted host** (note path traversal in that case: `quote(user, safe="")`); `url_has_allowed_host_and_scheme` guarding a redirect; LoginView's own `next` handling; redirects to `reverse(...)` results.

Verify:

```python
def test_next_param_is_not_open_redirect(client, user):
    r = client.post("/accounts/login/?next=https://other.example.net/", {"username": "u", "password": "pw-u-123456"})
    assert r.status_code == 302 and r["Location"].startswith("/")

def test_preview_rejects_internal_targets(client, user):
    client.force_login(user)
    for target in ("http://127.0.0.1/", "http://169.254.169.254/", "file:///etc/passwd"):
        assert client.get("/support/preview/", {"url": target}).status_code in (400, 403)
```

For SSRF in a staging environment use a harmless listener you control (`http://<your-collaborator-host>/probe`) and observe that the server does not call internal addresses; never probe real internal services.

References: OWASP SSRF Prevention cheat sheet, Top 10:2025 A01 (SSRF); CWE-918, CWE-601; https://docs.djangoproject.com/en/stable/ref/utils/#django.utils.http.url_has_allowed_host_and_scheme.
