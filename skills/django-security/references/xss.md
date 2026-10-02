# Django — XSS and Output Encoding

## Contents
- Escaping model
- Raw-output sinks to investigate
- Context traps (attributes, URLs, scripts)
- Responses outside templates
- Rich text and Markdown
- Defense in depth (CSP)
- Severity, false positives, verification

## Escaping model

The Django template language (DTL) auto-escapes `<`, `>`, `'`, `"` and `&` in `{{ variable }}` output. The Jinja2 backend that Django configures also enables autoescape by default. Escaping is **HTML-body escaping only**. It does not make values safe inside unquoted attributes, `href`/`src` URLs, `<script>`, `<style>`, event handlers or CSS. The Django docs call out this limit, for example `<style class={{ var }}>` with an unquoted attribute.

`SafeString` values (`mark_safe`, `format_html` output, anything with `__html__`) skip escaping. The template system trusts them.

## Raw-output sinks to investigate

```text
|safe  |safeseq  {% autoescape off %}  mark_safe(  SafeString(  format_html( with mark_safe args
is_safe=True (custom filters)   @register.simple_tag returning mark_safe   Field help_text/label with HTML
admin list_display / readonly_fields callables returning mark_safe or format_html
messages.* with mark_safe   HttpResponse(f"<...{x}...>")   Jinja2: |safe, Markup(
```

- `{{ comment.body|safe }}`, `{% autoescape off %}{{ x }}{% endautoescape %}`, `mark_safe(user_text)`: stored/reflected XSS if the value is attacker-influenced. **High** when other users or staff view it (stored), **Medium** for self-XSS or reflected with required interaction.
- **`mark_safe` with an f-string, `%` or `.format()`** is the classic mistake: `mark_safe(f"<b>{obj.label}</b>")` escapes nothing. The safe form is `format_html("<b>{}</b>", obj.label)`: `format_html` runs `conditional_escape()` on every argument and then marks the result safe (Django docs). `format_html` with only a literal and no args raises `TypeError` since Django 6.0 (earlier a deprecation). Wrapping an argument in `mark_safe()` re-opens the hole.
- `format_html_join` is safe on the same terms. `format_html("<a href='{}'>", url)` escapes quotes but still allows a `javascript:` URL (below).
- Custom template filters marked `is_safe=True` must not add unescaped data; `needs_autoescape=True` filters must call `conditional_escape` themselves.
- Admin: `ModelAdmin` display methods and `list_display` callables returning `mark_safe(f"...{obj.field}")` give stored XSS against staff, which is higher impact than normal users. Django also fixed an admin `URLField` stored-scheme XSS (CVE-2026-15920, Aug 2026).
- Inside `{% autoescape off %}`, sequence filters such as `join` do not escape elements; the docs point to the `escapeseq` filter. `{{ value|default:"<em>none</em>" }}` with a literal is fine.

Fix: remove `|safe`/`mark_safe`, use `format_html`, or sanitize HTML with an allow-list library and only then mark safe (`nh3`, `bleach`, `django-bleach`, `html-sanitizer`).

## Context traps (attributes, URLs, scripts)

**Attributes:** always quote: `<div class="{{ cls }}">`, never `<div class={{ cls }}>`. Event handler attributes (`onclick="go('{{ x }}')"`) combine HTML and JavaScript parsing; HTML-escaping alone is not enough. Move values into `data-*` attributes and read them from JavaScript.

**URLs:** `<a href="{{ profile.website }}">` is safe against attribute breakout but allows `javascript:` and `data:` URLs if the value is attacker-controlled. Django does not filter schemes on output. Model `URLField` validation (`URLValidator`: `http`, `https`, `ftp`, `ftps`) only runs when the data passes through a form, serializer or `full_clean()`; a plain `CharField`, a raw `create()`, imports and API writes bypass it. **Medium** (needs a click, can run in the victim's session). Fix: validate schemes on input and on output (`urlparse(url).scheme in {"http", "https"}`), or render non-http values as text, and add `rel="noopener noreferrer"`.

**Scripts:**
- Data into JavaScript: use `{{ data|json_script:"dom-id" }}` and `JSON.parse(document.getElementById("dom-id").textContent)`. `json_script` escapes `<`, `>` and `&` so the payload cannot close the script element.
- `var x = {{ json_string|safe }};`, `var x = "{{ value }}";` in an inline script, and `json.dumps(...)` rendered with `|safe` are injectable (`</script>` inside a JSON string; quote/backslash handling). **High/Medium**.
- `|escapejs` is for values inside quoted JavaScript string literals only. The docs say it is not safe in JavaScript template literals (backticks) and recommend `data-` attributes or `json_script`.

**Client-side sinks:** `innerHTML`, `outerHTML`, `document.write`, jQuery `.html()`, Vue `v-html`, React `dangerouslySetInnerHTML` fed from Django JSON. Django's server-side escaping does not apply there.

## Responses outside templates

- `HttpResponse("...")` defaults to `text/html`. `HttpResponse(f"Hello {request.GET['name']}")` and `HttpResponseBadRequest(f"Unknown {x}")` reflect XSS. Use templates or `django.utils.html.escape`.
- `HttpResponse(json.dumps(data))` returns `text/html`; use `JsonResponse` (content type `application/json`). `SECURE_CONTENT_TYPE_NOSNIFF` is on by default via `SecurityMiddleware`, which limits sniffing.
- User-uploaded HTML/SVG served from your origin: see `file-uploads.md`.
- DRF: the Browsable API escapes data, but DRF before 3.15.2 had an XSS in its `break_long_headers` template filter (CVE-2024-21520, fixed 3.15.2). Disable `BrowsableAPIRenderer` in production unless needed (`api-security.md`).
- Email templates are autoescaped like pages. Plain-text emails are not an XSS risk but carry phishing links.

## Rich text and Markdown

`markdown.markdown(user_text)` passes raw HTML through; wrapping the result in `mark_safe` makes stored XSS. `django-markdownx`, `django-ckeditor`/`django-ckeditor-5`, `TinyMCE`, `RichTextField` store HTML: sanitize on save and on render, restrict tags/attributes/URL schemes, and keep the editor package and its bundled JavaScript current (`dependencies.md`).

## Defense in depth (CSP)

Django 6.0 added built-in CSP support: `ContentSecurityPolicyMiddleware`, `SECURE_CSP` and `SECURE_CSP_REPORT_ONLY` (dictionaries using `django.utils.csp.CSP` constants such as `CSP.SELF` and `CSP.NONCE`), the `csp` context processor for nonces, and `csp_nonce_attr` (6.1). Earlier versions use `django-csp`. A CSP without `'unsafe-inline'`/`'unsafe-eval'` in `script-src` reduces XSS impact. Missing CSP is **Hardening**, not a vulnerability by itself.

## Severity, false positives, verification

Severity: stored XSS reaching staff/admin sessions **High** (Critical with an admin that allows privileged actions by session); stored XSS for ordinary users **High/Medium**; reflected **Medium**; self-XSS **Low**; `javascript:` in a profile link **Medium**. Raise or lower for session cookie flags (`HttpOnly` limits theft, not actions) and CSP.

False positives: `|safe` or `mark_safe` on constants, on output of `format_html`, on sanitizer output (confirm configuration), or on trusted admin-only content that is not user-influenced; `{{ x|safe }}` where `x` was escaped earlier in the same code path and cannot be changed afterwards; `json_script`; `linebreaksbr`/`linebreaks` (they escape when autoescape is on); `|urlize` (escapes with autoescape on); `format_html` with attacker data as arguments.

Verify:

```python
def test_comment_body_is_escaped(client, user, ticket):
    Comment.objects.create(ticket=ticket, author=user, body="<script>alert(1)</script>")
    client.force_login(user)
    html = client.get(f"/support/tickets/{ticket.pk}/").content.decode()
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html

def test_website_scheme_rejected(client, user):
    client.force_login(user)
    r = client.post("/accounts/profile/", {"website": "javascript:alert(1)"})
    user.refresh_from_db(); assert not user.website.lower().startswith("javascript:")
```

```bash
bandit -r . | grep -i 'B703\|B308'      # mark_safe, django template XSS hints
grep -rnE "\|safe|mark_safe\(|autoescape off|SafeString\(" --include=*.py --include=*.html .
```

References: OWASP XSS Prevention cheat sheet, OWASP Top 10:2025 A05 Injection; CWE-79, CWE-83; https://docs.djangoproject.com/en/stable/topics/security/#cross-site-scripting-xss-protection, https://docs.djangoproject.com/en/stable/ref/templates/builtins/#json-script, https://docs.djangoproject.com/en/stable/howto/csp/.
