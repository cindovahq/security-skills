# WordPress — SQL Injection

## Contents
- `$wpdb` sinks
- Using `prepare()` correctly
- Misuse patterns
- Identifiers, ORDER BY, LIMIT, IN lists
- Indirect sources
- Core query APIs
- Verification

## `$wpdb` sinks

Every `$wpdb` method that runs SQL: `query`, `get_results`, `get_row`, `get_col`, `get_var`. Plus raw `mysqli` usage. `$wpdb->insert`, `update`, `delete` and `replace` build prepared statements from arrays and are safe for **values** (not for table or column names taken from input).

## Using `prepare()` correctly

```php
$rows = $wpdb->get_results( $wpdb->prepare(
    "SELECT * FROM {$wpdb->prefix}myplugin_items WHERE user_id = %d AND status = %s",
    get_current_user_id(),
    $status
) );

// LIKE
$like = '%' . $wpdb->esc_like( $search ) . '%';
$wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_title LIKE %s", $like );

// Identifiers (WordPress 6.2+)
$wpdb->prepare( 'SELECT * FROM %i WHERE %i = %s', $table, $column, $value );
```

- Placeholders: `%d` (int), `%f` (float), `%s` (string, quoted), `%i` (identifier, backtick-quoted; **6.2+**). Use `%%` for a literal percent.
- Interpolating `{$wpdb->prefix}`, `{$wpdb->posts}` and other `$wpdb` table properties is fine: they aren't user input.

## Misuse patterns

```php
$wpdb->get_results( "SELECT * FROM {$wpdb->prefix}t WHERE id = " . $_GET['id'] );          // classic SQLi
$wpdb->get_results( $wpdb->prepare( "SELECT * FROM t WHERE name = '$name'" ) );            // prepare without args: no protection (and a _doing_it_wrong notice)
$wpdb->prepare( "SELECT * FROM t WHERE id = %d AND name = '$name'", $id );                  // mixed: $name interpolated
$wpdb->query( "DELETE FROM t WHERE id = " . esc_sql( $_POST['id'] ) );                      // esc_sql on an UNQUOTED value: 1 OR 1=1 passes
$wpdb->prepare( "SELECT * FROM t WHERE id = '%d'", $id );                                   // quoted placeholders: unnecessary, flagged by sniffs
$sql = $wpdb->prepare( "... %s", $a ); $sql .= " AND x = $b";                               // concatenation after prepare
$wpdb->prepare( "SELECT * FROM t WHERE title LIKE '%$s%'" );                                // LIKE without esc_like and placeholders
$wpdb->query( $wpdb->prepare( $_POST['sql'] ) );                                            // user-controlled query text
```

- `esc_sql()` escapes characters for use **inside quotes** only. It doesn't make a value safe in numeric context, `ORDER BY`, `LIMIT` or identifiers.
- `sanitize_text_field()` is not SQL escaping. Quotes survive it.
- `like_escape()` is deprecated (use `$wpdb->esc_like()`) and never escaped quotes.
- `intval()`/`absint()`/`(int)` before interpolation **is** safe for numeric context.

## Identifiers, ORDER BY, LIMIT, IN lists

```php
$orderby = $_GET['orderby']; $order = $_GET['order'];
$wpdb->get_results( "SELECT * FROM t ORDER BY $orderby $order" );          // SQLi
```

Fix with allow-lists:

```php
$allowed = [ 'date' => 'created_at', 'title' => 'title' ];
$col     = $allowed[ sanitize_key( $_GET['orderby'] ?? '' ) ] ?? 'created_at';
$dir     = ( 'asc' === strtolower( $_GET['order'] ?? '' ) ) ? 'ASC' : 'DESC';
$wpdb->get_results( "SELECT * FROM {$wpdb->prefix}t ORDER BY {$col} {$dir}" );
```

- `LIMIT`/`OFFSET`: use `%d` placeholders, or cast with `absint()`.
- `IN` lists: `implode( ',', array_map( 'absint', $ids ) )` for integers, or build `%s` placeholders: `implode( ',', array_fill( 0, count( $vals ), '%s' ) )` passed to `prepare()` with `...$vals`.
- Table/column names from input: allow-list, or `%i` (6.2+) **plus** an allow-list, because `%i` prevents injection but not access to arbitrary tables.

## Indirect sources

Trace data that **eventually** reaches SQL, not just superglobals:
- Shortcode/block attributes (`$atts['id']`, `$atts['orderby']`), controlled by contributors.
- REST `$request['param']`, `get_query_var()`, `$_COOKIE`, `$_SERVER['HTTP_*']` (e.g. IP-logging plugins writing `X-Forwarded-For` into SQL).
- Option, post-meta and user-meta values that lower-privilege users can set ("second-order" SQLi).
- WooCommerce order/cart item data, form-builder submissions, imported CSV files.

## Core query APIs

`WP_Query`, `get_posts`, `WP_User_Query`, `WP_Meta_Query`, `WP_Term_Query` parameterize most inputs, but:
- Passing raw request arrays into them (`new WP_Query( $_GET )`) lets attackers set any query var: `post_status=private`, `author__not_in`, `meta_query` with arbitrary compares. That's an access-control issue and a historical SQLi surface (e.g. WordPress core's 2026 "WP2Shell" chain used a `WP_Query` `author__not_in` string-vs-array handling flaw, fixed in 7.0.2 / 6.9.5 / 6.8.6). Pass only allow-listed, typed parameters.
- `posts_where`, `posts_join`, `posts_orderby`, `posts_clauses` filters that append request data → raw SQL sinks.

## Verification

- PHPCS with WordPress-Coding-Standards: `WordPress.DB.PreparedSQL`, `WordPress.DB.PreparedSQLPlaceholders`, `WordPress.DB.DirectDatabaseQuery`. Treat hits as leads.
- Test with benign payloads on a local/staging copy: `id=1 AND 1=2` (numeric context; response should match an invalid ID, not a modified query), `orderby=title,(SELECT 1)` → rejected or ignored. Check `$wpdb->last_query` / Query Monitor to confirm placeholders were applied.
- Never run destructive or time-based payloads against shared environments.

References: `wpdb::prepare()` reference; Plugin Handbook → Securing Input / Database; WordPress Coding Standards; CWE-89.
