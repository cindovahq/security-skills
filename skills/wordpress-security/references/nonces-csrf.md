# WordPress — Nonces and CSRF

## Contents
- How WordPress nonces work
- Correct verification
- Broken verification patterns
- Where nonces are needed
- Nonce exposure
- Verification

## How WordPress nonces work

- Created with `wp_create_nonce( $action )`, `wp_nonce_field( $action, $name )`, `wp_nonce_url( $url, $action )`.
- Tied to the **action string**, the **user ID**, the **session token**, and a time tick. The default lifetime is 24 hours (`nonce_life` filter), split into two 12-hour ticks.
- `wp_verify_nonce( $nonce, $action )` returns `1` (generated in the current 12h tick), `2` (previous tick), or **`false`**.
- They're **not single-use** and **not authorization**. They prevent CSRF. Every state-changing handler needs a nonce check **and** a capability check.
- For logged-out users the user ID is 0, so nonces for `nopriv` actions are shared among all visitors with the same session state and offer little protection. Don't rely on them as a secret.

## Correct verification

| Context | API | Behavior on failure |
|---|---|---|
| Admin form POST | `check_admin_referer( 'myplugin_save_' . $id, '_wpnonce' )` | Dies (`wp_nonce_ays`) |
| AJAX | `check_ajax_referer( 'myplugin_ajax', 'nonce' )` | Dies with `-1` / 403 |
| Generic | `if ( ! wp_verify_nonce( $nonce, 'action' ) ) { wp_die( '', 403 ); }` | Your code decides |
| REST (cookie auth) | Core checks `X-WP-Nonce` / `_wpnonce` against `wp_rest` | Request treated as unauthenticated |

Use specific action strings that include the object ID where relevant (`'delete_item_' . $item_id`), so a nonce for one object can't be replayed against another.

## Broken verification patterns

```php
wp_verify_nonce( $_POST['nonce'], 'save' );                        // return value ignored
if ( isset( $_POST['nonce'] ) && ! wp_verify_nonce( … ) ) die();   // omit the field → check skipped
if ( wp_verify_nonce( … ) === 1 ) { … }                             // fails for tick 2 (functional), fine for security
check_ajax_referer( 'save', 'nonce', false );                       // $stop=false and result unused
if ( ! wp_verify_nonce( $nonce, -1 ) )                              // default action -1: any -1 nonce works
check_admin_referer();                                              // no action: deprecated/weak
$nonce = sanitize_text_field( $_GET['_wpnonce'] ?? '' ); /* never verified */
```

- Verification placed **after** the state change, or only in one branch of the handler.
- Nonce checked in the form-rendering function but not in the save handler.
- Same generic action string (`'myplugin'`) for every operation across the plugin, so a nonce leaked on a low-privilege page works for admin actions (see exposure below).

## Where nonces are needed

Every request that changes state for a logged-in user: admin forms, `admin-post.php` handlers, AJAX actions, settings saves, bulk actions, `GET` links that delete/approve/activate (`wp_nonce_url`), and REST routes using cookie auth (core handles these).

**`GET` with side effects:** delete/approve links via `admin.php?page=x&action=delete&id=5` must have `wp_nonce_url()` + `check_admin_referer()`. Without them: CSRF (Medium/High depending on the action).

**Not needed:** read-only endpoints, endpoints authenticated by non-cookie credentials (Application Passwords, API keys, signed webhooks).

## Nonce exposure

A nonce is only useful if attackers can't obtain it:
- `wp_localize_script( 'myplugin', 'MyPlugin', [ 'nonce' => wp_create_nonce( 'myplugin_admin' ) ] )` enqueued on the **front end** or for all logged-in users gives every subscriber the admin-action nonce. Combined with a missing capability check, that's privilege escalation (the nonce check "passes").
- Nonces printed in public cached pages: page caches serve one user's nonce to others, and stale nonces cause 403s.
- When reporting, note where the nonce is exposed. That determines who can exploit a missing capability check.

## Verification

- Replay the request without `_wpnonce`/`nonce` and with a nonce for a different action → `403`/`-1` and no state change.
- PHPUnit: `$_POST['_wpnonce'] = 'invalid'; $this->expectException( 'WPDieException' );` then call the handler.
- PHPCS: `WordPress.Security.NonceVerification` flags superglobal reads without nonce verification in the same scope (verify each hit; it can't see nonces checked in a calling function).

References: Plugin Handbook → Nonces; `wp_verify_nonce()`, `check_admin_referer()`, `check_ajax_referer()` reference pages; CWE-352.
