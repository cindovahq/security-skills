# Laravel — XSS and Output Encoding

## Contents
- Blade escaping model
- Raw output
- Context-specific traps
- Markdown and rich text
- Livewire, Inertia, and front-end frameworks
- Non-HTML responses
- Content Security Policy
- Verification

## Blade escaping model

`{{ $value }}` runs `e()` → `htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8', $doubleEncode = true)`. That's safe for **HTML element content and quoted attribute values**, not for every context.

`Htmlable` objects (`HtmlString`, `Illuminate\Support\HtmlString`, components, `Str::of(...)->toHtmlString()`) are **not escaped** by `{{ }}`. Their `toHtml()` output is trusted.

## Raw output

**Sinks:**

```blade
{!! $post->body !!}
{!! request('q') !!}
{!! $comment->html !!}
{!! nl2br($bio) !!}          {{-- raw: nl2br does not escape --}}
{!! __('messages.welcome', ['name' => $user->name]) !!}   {{-- translation params are NOT escaped --}}
@php echo $value; @endphp
<?php echo $value; ?>
```

Plus PHP code returning `new HtmlString($userInput)` or `->toHtmlString()` on user data.

For each `{!! !!}`, trace the variable back to its source. Report only if user-controlled data reaches it without a sanitizer. **Stored XSS** (saved user content shown to other users, especially admins) → High. **Reflected** → Medium/High. **Self-XSS only** → Low/Informational.

**Safe patterns:**

```blade
{!! nl2br(e($bio)) !!}
{!! clean($post->body) !!}                          {{-- mews/purifier (HTMLPurifier) --}}
{!! $sanitizer->sanitize($post->body) !!}           {{-- symfony/html-sanitizer --}}
{{ __('messages.welcome', ['name' => $user->name]) }}
```

Review the sanitizer config. An HTMLPurifier config that allows `style`, `on*` attributes, `<iframe>` or `<script>`, or `HTML.Trusted = true`, defeats the purpose.

## Context-specific traps

`{{ }}` is correct HTML escaping but **wrong for these contexts**:

| Context | Problem | Fix |
|---|---|---|
| `href="{{ $url }}"`, `src`, `action`, `formaction` | `javascript:alert(1)` contains no characters that need escaping | Validate scheme (`http`/`https`) on input **and** before output, e.g. `Str::startsWith(strtolower($url), ['http://','https://'])` |
| `<script> var x = "{{ $x }}"; </script>` | HTML entities aren't decoded inside `<script>`, so data is mangled. The safe-looking pattern invites developers to switch to `{!! !!}`. | `var x = @json($x);` or `{{ Js::from($x) }}` (both escape `<`, `>`, `&`, quotes) |
| Unquoted attributes `<div class={{ $c }}>` | Space breaks out of the attribute | Always quote attributes |
| Event handlers `onclick="go('{{ $id }}')"` | HTML-decoding happens before JS parsing, so entity-encoded quotes become live quotes | Pass data via `data-*` attributes and read them in JS |
| `<style>` / `style="{{ }}"` | CSS injection (data exfil, UI redress) | Allow-list values |
| Inside `@verbatim` / Alpine `x-data="{{ ... }}"` | Alpine evaluates attribute values as JS expressions | `x-data="@js($data)"` (Laravel's `@js` directive) and never put raw user strings into Alpine expressions |

## Markdown and rich text

- `Str::markdown($input)` / `Str::inlineMarkdown($input)` use league/commonmark. **By default raw HTML in the markdown is passed through and unsafe links are allowed.** Rendering user markdown with `{!! Str::markdown($comment) !!}` is stored XSS.
  - Fix: `Str::markdown($input, ['html_input' => 'strip', 'allow_unsafe_links' => false])`, then (defense in depth) sanitize the HTML.
- WYSIWYG editors (TinyMCE, CKEditor, Trix, Tiptap): client-side filtering is not a control. The server must sanitize on save or on render.
- Mail templates: Markdown mailables escape `{{ }}` like views, but `{!! !!}` and HTML in `@component('mail::panel')` follow the same rules. HTML email to admins with unsanitized user content is a phishing/XSS vector in webmail.

## Livewire, Inertia, and front-end frameworks

- **Livewire:** Blade rules apply. `{!! !!}` inside components is the usual sink. Alpine expressions with user data (`x-html`, `x-data` with interpolated strings) are sinks.
- **Inertia (Vue/React/Svelte):** props are JSON-encoded into the `data-page` attribute safely. The sinks are front-end ones: Vue `v-html`, React `dangerouslySetInnerHTML`, Svelte `{@html}`. Data passed via `HandleInertiaRequests::share()` goes to **every** page. Check it doesn't expose sensitive fields (a data-exposure issue, not XSS).
- `@json` is meant for `<script>` blocks. **Inside an HTML attribute** (`x-data="@json($x)"`), the JSON's own `"` delimiters close the attribute, and spaces in user strings can start new attributes (`onmouseover=...`). In attributes use `@js($x)`, which emits `JSON.parse('...')` with all quotes hex-escaped, or `{{ json_encode($x) }}` (entity-escaped). Custom `@json($x, $flags)` without the `JSON_HEX_*` flags is unsafe even inside `<script>`.

## Non-HTML responses

- `return response($request->input('callback') . '(' . $json . ')')`: JSONP callback injection. Validate the callback name against `^[A-Za-z_$][\w$.]*$` or drop JSONP.
- `response($userContent)` defaults to `text/html`. Returning user-controlled strings or files without setting `Content-Type: text/plain` / `application/json` → XSS.
- **Uploaded files served from the app origin:** SVG, HTML, XML and PDF with JS. An uploaded `avatar.svg` containing `<script>` served from `https://app.example.com/storage/...` is stored XSS on the app origin. Laravel 12+ `image` rule excludes SVG by default; `image:allow_svg`, `mimes:svg` or `File::types(['svg'])` re-allow it. See `file-uploads.md`.
- Error pages in debug mode reflect input. That's covered by the `APP_DEBUG` finding.

## Content Security Policy

Laravel ships no CSP. `spatie/laravel-csp` or web-server headers are typical. With Vite, use `Vite::useCspNonce()` and add the nonce to the policy. A missing CSP is **Hardening**, never the primary XSS finding. A CSP with `'unsafe-inline'` for scripts gives little XSS protection.

## Verification

```php
it('escapes stored comments', function () {
    $payload = '<img src=x onerror=alert(1)>';
    $post = Post::factory()->create();
    Comment::factory()->for($post)->create(['body' => $payload]);

    $this->get("/posts/{$post->id}")
        ->assertDontSee($payload, escape: false)   // raw payload absent
        ->assertSee($payload);                      // escaped form present
});

it('rejects javascript urls in profile website', function () {
    $this->actingAs(User::factory()->create())
        ->patch('/profile', ['website' => 'javascript:alert(1)'])
        ->assertSessionHasErrors('website');
});
```

References: OWASP XSS Prevention Cheat Sheet, DOM-based XSS Cheat Sheet; CWE-79, CWE-80, CWE-83; https://laravel.com/docs/blade#displaying-data, /strings#method-str-markdown.
