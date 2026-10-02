# NestJS — SSRF, Outbound Requests and Redirects

Generic SSRF reasoning (allow-lists, private-range blocking at connect time, DNS rebinding, redirect re-validation, axios `allowAbsoluteUrls`) is in the `nodejs-security` skill (SSRF and redirects reference). This file covers the Nest-specific entry points.

## Outbound HTTP in Nest

- `HttpService` from `@nestjs/axios` (`HttpModule.register({...})`, `registerAsync`) wraps axios and returns RxJS Observables (`firstValueFrom(this.http.get(url))`). Module-level `baseURL`, `headers`, `timeout`, `maxRedirects` are axios options. `@nestjs/axios` 12.x on 2026-10-02; the installed axios version determines which axios advisories apply.
- Nest 12's docs now describe `@nestjs/http-client` (built on `fetch`, named clients, `baseUrl`, `timeout`, retries). It is `0.0.1` on npm (2026-09-27); relative URLs are appended to `baseUrl`, but a client without `baseUrl` requires absolute URLs. Review its handling of absolute-URL overrides in the installed version rather than assuming `baseUrl` is a boundary.
- Plain `fetch`, `got`, `undici`, `node-fetch`, SDKs, and headless browsers (`puppeteer` `page.goto(url)`) are equally in scope.
- Webhook delivery features (outgoing webhooks, "test this URL" buttons), URL preview/unfurl, avatar-from-URL, RSS/import-from-URL, OAuth/OIDC discovery with user-supplied issuers, PDF/screenshot services.

## What to investigate

```ts
// Vulnerable: user chooses the URL; the response (or its status/timing) comes back
@Post('preview')
async preview(@Body() dto: PreviewDto) {              // dto.url: @IsUrl() only checks the format
  const { data } = await firstValueFrom(this.http.get(dto.url));
  return { data };
}
```

- `@IsUrl()` validates syntax, not destination: literal IP URLs such as `http://169.254.169.254/` pass, and hostnames resolving to private addresses pass too (and `localhost` passes when `require_tld: false`). Without `protocols: ['https']` and a post-resolution IP check, treat it as no control.
- Axios follows redirects by default (`maxRedirects: 5`): an allow-listed host can redirect to an internal address. Set `maxRedirects: 0` and handle manually, or re-validate each hop. On axios 1.17.0 to 1.19.x the fetch adapter ignores `maxRedirects: 0` (CVE-2026-101907, fixed 1.20.0).
- Validate the **resolved address** at connect time (custom `httpAgent`/`lookup`), not only the hostname string.
- URLs built as `` `${base}/${userPath}` `` with unencoded input (`../`, `@evil.example`, `?`, `#`). Use `new URL()` and check `url.origin`, or encode path segments with `encodeURIComponent`.
- Internal credentials forwarded: default `headers: { Authorization }` on a shared `HttpModule` sent to user-controlled hosts.
- Blind SSRF (no response returned) is still High if internal services or cloud metadata are reachable (`169.254.169.254`, `metadata.google.internal`, Kubernetes API, Redis/Elasticsearch on private IPs); Medium if egress is restricted.

## Redirects (`@Redirect`)

```ts
@Get('callback')
@Redirect()
callback(@Query('next') next: string) {
  return { url: next, statusCode: 302 };      // open redirect: attacker chooses the destination
}
```

`@Redirect(url, statusCode)` and returning `{ url }` from the handler, or `res.redirect(next)` with `@Res()`, are the sinks. Parse with `new URL(next, base)`, require the base origin, reject control characters and backslashes in the raw input (URL parsers strip tabs and newlines, so `/<TAB>/evil.example` becomes `//evil.example`), and return `pathname + search + hash` only if it doesn't start with `//` (see the `safeNext` helper in `nodejs-security`). A plain "starts with a single `/`" check is bypassable. Open redirect alone: Low; Medium when it chains with OAuth `redirect_uri` handling, login flows or password reset links.

OAuth/OIDC: verify `state`, exact `redirect_uri` matching and PKCE on the server side; Passport strategies (`passport-google-oauth20`, etc.) with `passReqToCallback` and user-supplied `callbackURL` are suspect.

## False positives

- Calls to a fixed, configured host where user input only fills an `encodeURIComponent`-encoded path segment or a query value.
- `HttpService` calls to internal services whose URLs come solely from validated configuration.
- `@Redirect('https://docs.example.com')` with a constant URL.
- Redirects to relative paths validated with a strict pattern.

## Verification

```ts
it.each(['http://127.0.0.1:3000/', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'http://[::1]/'])(
  'refuses internal destination %s', async (url) => {
    await request(app.getHttpServer()).post('/integrations/preview').set(auth).send({ url }).expect(400);
  });
it('rejects off-site redirects', () =>
  request(app.getHttpServer()).get('/auth/callback?next=https://evil.example').expect(400));
```

Use a local mock server (nock/msw) in tests; never probe real metadata endpoints from production systems.

References: OWASP SSRF Prevention Cheat Sheet, OWASP Unvalidated Redirects Cheat Sheet, https://docs.nestjs.com/techniques/http-module; CWE-918, CWE-601.
