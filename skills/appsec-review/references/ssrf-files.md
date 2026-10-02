# SSRF, File Uploads and Downloads

## Contents
- SSRF sinks
- SSRF impact factors
- SSRF fixes
- Upload risks
- Upload fixes
- Downloads and file serving
- Verification

## SSRF sinks

Server-side fetches of URLs or hosts the user influences:
- HTTP clients: `fetch`, `axios`, `got`, `requests`, `httpx`, `urllib`, `HttpClient`, `RestTemplate`/`WebClient`, `net/http`, Guzzle, `Net::HTTP`, `open-uri` (`URI.open` also opens files on older Rubies).
- Features: link previews/unfurling, webhooks with user-configured URLs, "import from URL", avatar URLs, RSS/OPML, OAuth/OIDC discovery with user-supplied issuers, SAML metadata URLs, PDF/screenshot renderers (headless Chrome, wkhtmltopdf, Puppeteer/Playwright, WeasyPrint, dompdf with remote enabled), image processors (ImageMagick URL coders), XML external entities, SVG renderers, LLM tools that browse/fetch URLs.

## SSRF impact factors

Severity depends on what is reachable and what is returned:
- **Cloud metadata** (`169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`): AWS IMDSv1 → instance-role credentials with a simple GET → **Critical**. IMDSv2, GCP and Azure require special headers, which limits plain SSRF.
- **Internal services:** admin panels, Redis/Memcached (protocol smuggling via `gopher://` or CRLF in some clients), Elasticsearch, Kubernetes API, Docker API, internal microservices trusting network location.
- **Response returned to the attacker** (full read) vs **blind** (port scanning, side effects).
- **Schemes supported** by the client: `file://`, `gopher://`, `dict://`, `ftp://`, `jar:`, `netdoc:`.
- **Redirect following:** allow-listed host → 302 → internal address.

## SSRF fixes

1. Prefer allow-lists of destinations.
2. If arbitrary URLs are a feature: resolve the hostname, reject private, loopback, link-local, ULA, multicast, unspecified and reserved addresses (IPv4 and IPv6, IPv4-mapped IPv6, decimal/octal/hex encodings), then **pin the connection to the validated IP** (to defeat DNS rebinding). Re-validate on every redirect, or disable redirects. Use maintained libraries (e.g. `ssrf-req-filter`, `advocate` for Python, `ssrf_filter` for Ruby) rather than regexes.
3. Restrict schemes to `http`/`https` and ports to expected ones.
4. Run fetchers in an isolated network segment / egress proxy with deny-by-default to internal ranges.
5. Cloud: enforce IMDSv2 (`HttpTokens=required`) and a hop limit of 1 for containers.
6. Renderers: disable network access or intercept requests. Block `file://`.

## Upload risks

| Risk | Condition | Typical severity |
|---|---|---|
| Remote code execution | Attacker controls stored extension **and** files land in a directory where the server executes scripts (PHP, JSP, ASPX, CGI) | Critical |
| Stored XSS | HTML/SVG/XML (or content-sniffed files) served inline from the app origin | High |
| Overwrite / traversal | Client filename used in the storage path (`../`, absolute paths, reserved names) | High |
| Malware distribution / phishing | Public hosting of arbitrary files on your domain | Medium |
| Resource exhaustion | No size/count limits, decompression bombs, image pixel floods | Medium |
| Parser exploits | ImageMagick, ExifTool, PDF, office, archive parsers on untrusted input | High (depends on version) |
| Privacy | EXIF GPS in public photos | Low/Medium |
| Access control | Private documents in public buckets/paths, guessable URLs | Medium/High |

Client-provided `Content-Type` and filenames are attacker-controlled. Magic-byte checks help but polyglots exist. Storage location and serving behavior matter more than detection.

## Upload fixes

- Allow-list extensions **and** verify content type server-side.
- Generate the stored filename server-side (random ID plus an allow-listed extension). Keep the original name only as metadata.
- Store outside the web root or in object storage. Never execute scripts in upload locations (web server config).
- Serve user files from a separate cookieless domain, or with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Sanitize SVG or convert it to raster.
- Enforce size limits at the proxy and app. Check image dimensions before decoding. Limit archive entry count and total size.
- Private files: authorization on every download; short-lived presigned URLs issued after authorization.
- Scan files (antivirus/CDR) where the business risk warrants it.

## Downloads and file serving

- `sendFile(req.query.path)`, `send_file(request.args['f'])`, `File.ReadAllBytes(Path.Combine(base, input))`, `new File(base, input)` → path traversal (see `injection.md`).
- Object storage keys built from input without authorization → read other users' objects.
- `Content-Disposition` filename with user input: let the framework encode it.
- Directory listing enabled on upload/static directories.

## Verification

- SSRF tests (with outbound HTTP mocked): `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254/`, `http://2130706433/`, `http://0x7f.1/`, `http://localtest.me/`, `file:///etc/passwd`, redirect-to-internal → all rejected.
- Upload tests: `.php`/`.jsp`/`.html`/`.svg` with script, double extensions (`a.php.jpg`), path-traversal names (`../../x`), oversized files → rejected or neutralized. Stored names are random.
- Download tests: another user's file ID → 403/404; `../` in any path parameter → 400/404.

References: OWASP SSRF Prevention, File Upload Cheat Sheets; OWASP API7:2023; CWE-918, CWE-434, CWE-22, CWE-73, CWE-400, CWE-409.
