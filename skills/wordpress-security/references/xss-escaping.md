# WordPress — XSS and Output Escaping

## Contents
- Escape late, by context
- Common XSS sinks in plugins and themes
- Shortcodes and blocks (contributor-controlled)
- Translations
- JavaScript data
- `wp_kses` and `unfiltered_html`
- Admin-side XSS
- Verification

## Escape late, by context

Escape at the moment of output, matching the context:

| Context | Function |
|---|---|
| HTML text | `esc_html()`, `esc_html__()`, `esc_html_e()` |
| HTML attribute | `esc_attr()`, `esc_attr__()`, `esc_attr_e()` |
| URL in `href`/`src`/`action` | `esc_url()` (blocks `javascript:` and other unsafe protocols) |
| URL to store/redirect (not output) | `esc_url_raw()` / `sanitize_url()` |
| `<textarea>` content | `esc_textarea()` |
| Inline JS string in an attribute (legacy) | `esc_js()` |
| Data for scripts | `wp_json_encode()` / `wp_localize_script()` / `wp_add_inline_script()` with `wp_json_encode` |
| HTML that must keep some tags | `wp_kses_post()` (post-content tags) or `wp_kses( $html, $allowed )` |
| XML | `esc_xml()` (5.5+) |

Sanitizing on input (`sanitize_text_field`) doesn't replace escaping on output. Data can be modified later, or come from other sources.

## Common XSS sinks in plugins and themes

```php
echo $_GET['tab'];                                         // reflected
echo '<input value="' . $_POST['name'] . '">';             // attribute breakout
echo '<a href="' . esc_attr( $url ) . '">';                // esc_attr doesn't block javascript: → use esc_url
printf( '<div class="%s">', $class );                      // unescaped printf arguments
echo get_post_meta( $id, 'note', true );                   // stored: meta set by contributors/customers/forms
echo $user->display_name;                                  // users control their display name
echo wp_unslash( $_SERVER['REQUEST_URI'] );                // reflected via the URL
add_query_arg( 'x', 'y' );                                 // returns the current URL unescaped → esc_url( add_query_arg(...) )
echo $wpdb->get_var( ... );                                // stored data
```

Stored-XSS sources to trace: form submissions, comments, user profile fields, post meta, WooCommerce order notes/addresses/product reviews, log viewers (user agents, referers, IPs from headers), imported data, and REST-writable meta (`show_in_rest`).

**Severity:** stored XSS that executes in an administrator's session leads to full site takeover (create admin user, edit plugin files). Rate it **High** (Critical if unauthenticated users can inject it, e.g. via a form or a logged user agent). Reflected XSS needing admin interaction is typically **Medium**.

## Shortcodes and blocks (contributor-controlled)

Contributors can't use `unfiltered_html`, but they **can** write shortcodes and block attributes. Plugins that output attributes unescaped give contributors stored XSS against editors and admins who preview posts:

```php
add_shortcode( 'btn', fn ( $atts ) => '<a href="' . $atts['url'] . '" class="' . $atts['class'] . '">Go</a>' );  // XSS
// fixed
add_shortcode( 'btn', function ( $atts ) {
    $atts = shortcode_atts( [ 'url' => '', 'class' => '' ], $atts, 'btn' );
    return sprintf( '<a href="%s" class="%s">Go</a>', esc_url( $atts['url'] ), esc_attr( $atts['class'] ) );
} );
```

Same for `register_block_type( …, [ 'render_callback' => … ] )` dynamic blocks: escape every attribute. In JS `save()`/`edit()` functions, avoid `dangerouslySetInnerHTML`/`RawHTML` with attribute values.

## Translations

`__()`, `_e()`, `_x()` and `_n()` return **unescaped** strings. Translations are third-party content. Use `esc_html__()`, `esc_html_e()`, `esc_attr__()`. For strings with placeholders: `printf( esc_html__( 'Hello %s', 'td' ), esc_html( $name ) );`. For strings that must contain HTML: `wp_kses( __( 'Read <a href="%s">docs</a>', 'td' ), [ 'a' => [ 'href' => [] ] ] )`.

## JavaScript data

- `wp_localize_script()` and `wp_add_inline_script( 'h', 'var cfg = ' . wp_json_encode( $data ) . ';' )` are the safe ways to pass data to JS.
- Unsafe: `echo "<script>var name = '$name';</script>";`, or `esc_attr`/`esc_html` used inside `<script>` (wrong context).
- Front-end JS sinks: `innerHTML`, jQuery `.html()`, `.append( userString )`, `$( userString )`, `document.write`, `location = …` with values from REST responses or `location.hash`.

## `wp_kses` and `unfiltered_html`

- `wp_kses_post()` allows post-content HTML (no `<script>`, no event handlers). Fine for user HTML in most cases.
- Custom `$allowed` arrays that permit `style`, `on*` attributes, `<iframe>`, `<object>`, `<embed>` or `<svg>` with event handlers, or `javascript:` via an allowed-protocols filter (`kses_allowed_protocols`) → XSS.
- `html_entity_decode()` / `wp_specialchars_decode()` **after** escaping undoes it.
- Users with `unfiltered_html` (single-site admins and editors; only super admins on multisite) can post any HTML by design. Not a vulnerability. Report only when lower roles can reach it, or when plugin code lets data from users without `unfiltered_html` bypass kses (e.g. saving post content via a custom AJAX handler without `wp_kses_post`).

## Admin-side XSS

- Admin pages echoing `$_GET['page']`, `$_GET['tab']`, `$_REQUEST['s']`, or `$_SERVER['PHP_SELF']`.
- Admin notices built from options or request parameters.
- `WP_List_Table` columns echoing stored data without escaping (`column_default()` returning raw values).
- Settings fields whose saved values (written by admins) are echoed unescaped. That's low impact on single site, higher on multisite (site admin → super admin).

## Verification

- PHPCS: `WordPress.Security.EscapeOutput` (verify hits; some are false positives with already-escaped variables).
- Inject `"><img src=x onerror=alert(document.domain)>` into each stored field on a local/staging site as a low-privilege user, and view the pages as admin. Expect escaped output.
- For shortcodes: create a contributor draft with `[btn url="javascript:alert(1)" class='"onmouseover="alert(1)']` and preview as admin.
- PHPUnit: assert rendered output contains `&lt;img` and not `<img src=x`.

References: Plugin Handbook → Escaping Data; Common APIs → Escaping; `wp_kses()` reference; CWE-79, CWE-80, CWE-83.
