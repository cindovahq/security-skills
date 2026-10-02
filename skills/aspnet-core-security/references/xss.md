# ASP.NET Core — XSS and Output Encoding

## Contents
- Encoding model
- Raw-output sinks
- Context traps
- Fix patterns
- Severity, false positives, verification

## Encoding model

- Razor (`.cshtml`, `.razor`) HTML-encodes every `@expression` using HTML attribute encoding rules, which cover element content and quoted attributes. Tag helpers (`asp-for`, `<input value="@x">`) and HTML helpers (`Html.DisplayFor`, `Html.TextBoxFor`) encode too.
- Values that implement `IHtmlContent` are written as-is: `Html.Raw(...)`, `new HtmlString(...)`, `HtmlContentBuilder.AppendHtml(...)`, `TagBuilder.InnerHtml.AppendHtml(...)`, `IHtmlContent` returned from view components or custom helpers. In Blazor, `(MarkupString)value` renders raw HTML.
- `Content(html, "text/html")`, `Results.Content(html, "text/html")`, `Results.Text(...)` with an HTML content type, and writes to `Response.Body` bypass Razor completely.
- `@Json.Serialize(model)` (`IJsonHelper`) and `System.Text.Json` with the default `JavaScriptEncoder` escape HTML-sensitive characters (`<`, `>`, `&`, `'`) in strings, so output placed in a `<script>` block can't close the element. `@Json.Serialize` always uses the default HTML-safe encoder, even if `MvcJsonOptions` sets a relaxed one. Plain `JsonSerializer` output with `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` does not escape them; Microsoft's docs say never to emit that raw output into an HTML page or `<script>` element.
- `HtmlEncoder`, `JavaScriptEncoder`, `UrlEncoder` (`System.Text.Encodings.Web`) are available through DI for code outside Razor.

## Raw-output sinks

```text
@Html.Raw(   new HtmlString(   AppendHtml(   (MarkupString)   Content(..., "text/html")   Results.Content(
UnsafeRelaxedJsonEscaping   JavaScriptEncoder.Create(UnicodeRanges.All)  (only affects non-ASCII; not an XSS issue by itself)
IJSRuntime.InvokeVoidAsync("eval"   element.innerHTML =   document.write(   jQuery .html(
```
For each, trace the value: user profile fields, ticket bodies, comments, file names, query strings, database content that users can write, and data from other systems. Markdown renderers (Markdig) allow raw HTML by default unless the pipeline disables it (`DisableHtml()`), so `Html.Raw(Markdown.ToHtml(userText))` is a sink unless sanitized.

## Context traps

1. **URLs in attributes.** `<a href="@Model.Website">` is encoded but `javascript:alert(1)` contains nothing to encode. Validate the scheme (`Uri.TryCreate(..., UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp)`).
2. **Inline JavaScript.** `var name = '@Model.Name';` is HTML-encoded, not JavaScript-encoded. Microsoft's guidance: put the value in a `data-` attribute and read it from script, or JavaScript-encode it. `@Html.Raw(Model.Name)` inside `<script>` is a direct injection.
3. **Event handler attributes and `style`.** `onclick="doThing('@Model.Id')"`: HTML attribute encoding is decoded by the browser before the JavaScript runs, so `'` encoded as `&#x27;` becomes a quote again. Treat as a JS context.
4. **Unquoted attributes** written by hand in `HtmlString` or string concatenation.
5. **JSON responses with HTML content type**, or API responses rendered by a front end that uses `innerHTML`/`dangerouslySetInnerHTML`/`v-html` (report on the front end, cite the API as source).
6. **File names and uploaded content** served same-origin (`file-uploads.md`): SVG and HTML uploads are stored XSS.
7. **Blazor:** `MarkupString` from user data; JS interop passing user strings to `eval`, `innerHTML` or `insertAdjacentHTML`; user-controlled URLs bound to `href` (same scheme check as item 1). WebAssembly components run in the browser, so XSS there has the same reach as in any SPA.
8. **Validation and error messages** that echo input through `Html.Raw` (custom `ValidationSummary` templates).

## Fix patterns

```cshtml
@* Default encoding *@
<p>@Model.Ticket.Description</p>

@* Rich text: sanitize with an allow-list sanitizer (e.g. Ganss.Xss HtmlSanitizer) before storing or rendering *@
@Html.Raw(Sanitizer.Sanitize(Model.Ticket.DescriptionHtml))

@* Data for scripts *@
<div id="cfg" data-user-name="@Model.Name"></div>
<script>const cfg = @Json.Serialize(Model.ClientConfig);</script>
```

Add a Content-Security-Policy (ASP.NET Core through 10.0 has no built-in CSP middleware; set the header in middleware or at the proxy, with nonces via a per-request value) as defense in depth, and keep auth cookies `HttpOnly` (`sessions-data-protection.md`).

## Severity, false positives, verification

Severity: stored XSS rendered to staff/admins **High** (Critical if it leads to admin actions with no further barrier); stored XSS to other users **High/Medium**; reflected XSS **Medium**; self-XSS only **Low/Info**. Raise one level if the auth cookie is not `HttpOnly` or tokens are kept in `localStorage`.

False positives: `@value` in element content or quoted attributes; tag helpers; `@Json.Serialize` with default options; `Html.Raw` of constants, resource strings or server-generated markup without user data; `Html.Raw` of output from a configured allow-list sanitizer (check its configuration allows no `script`, event handlers or `javascript:` URLs).

Verify:
```csharp
[Fact]
public async Task Ticket_description_is_encoded()
{
    await SeedTicketAsync(description: "<img src=x onerror=alert(1)>");
    var html = await _factory.CreateClientAs("staff").GetStringAsync("/Tickets/Details/1");
    Assert.Contains("&lt;img src=x", html);
    Assert.DoesNotContain("<img src=x onerror", html);
}
```

References: https://learn.microsoft.com/aspnet/core/security/cross-site-scripting, https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/character-encoding, https://learn.microsoft.com/aspnet/core/blazor/components/#raw-html; OWASP XSS Prevention cheat sheet; CWE-79.
