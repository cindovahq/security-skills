# WordPress — Authorization and Capabilities

## Contents
- Roles and capabilities
- Checks that are not authorization
- Entry points that bypass expectations
- Privilege escalation sinks
- Object-level access (IDOR)
- REST permission callbacks
- Abilities API (6.9+)
- Multisite
- Fix patterns
- Verification

## Roles and capabilities

Default single-site roles (most → least privileged): **Administrator** (`manage_options`, `install_plugins`, `edit_users`, `unfiltered_html`, ...), **Editor** (`edit_others_posts`, `publish_pages`, `unfiltered_html`), **Author** (`publish_posts`, `upload_files`), **Contributor** (`edit_posts`), **Subscriber** (`read`). WooCommerce adds **Shop Manager** (`manage_woocommerce`) and **Customer**.

If the site has open registration (`users_can_register` option = 1, `default_role`), **anyone can become a subscriber or customer**. Treat "logged-in" as "anyone" in that case.

Authorization is `current_user_can( $capability [, $object_id ] )`. Meta capabilities (`edit_post`, `delete_post`, `edit_user`, `read_post`, `edit_comment`) map to primitive capabilities through `map_meta_cap` and check ownership/status for a specific object.

## Checks that are not authorization

| Check | Why it's insufficient |
|---|---|
| `is_admin()` | True when the request targets an admin screen, **including `admin-ajax.php` and `admin-post.php` for unauthenticated users**. It says nothing about the user. |
| `is_user_logged_in()` | Any role, including subscribers/customers. |
| Nonce check alone (`check_ajax_referer`, `wp_verify_nonce`) | A nonce proves the request came from a page the user loaded. If that page (or a nonce localized to the front end) is visible to subscribers, subscribers have valid nonces. |
| Hiding a menu item / admin page | The handler that saves data must check again. `add_menu_page( …, 'manage_options', … )` protects only the page render, not separate AJAX/POST handlers. |
| `current_user_can( 'read' )` | Every logged-in role has it. |
| Checking a role name (`in_array( 'administrator', $user->roles )`) | Brittle, and breaks with custom roles and multisite super admins. Prefer capabilities. |
| Referer checks (`wp_get_referer()`, `$_SERVER['HTTP_REFERER']`) | Client-controlled. |

## Entry points that bypass expectations

- **`wp_ajax_{action}`**: any logged-in user can call `admin-ajax.php?action={action}`, including subscribers. **`wp_ajax_nopriv_{action}`**: unauthenticated users.
- **`admin_post_{action}` / `admin_post_nopriv_{action}`**: same model via `admin-post.php`.
- **`admin_init`**: fires on `admin-ajax.php` and `admin-post.php` requests **even for unauthenticated users**. Settings-saving or import/export logic hooked to `admin_init` that reads `$_POST`/`$_GET` without capability checks is a classic critical bug.
- **`init`, `wp_loaded`, `plugins_loaded`, `template_redirect`, `wp`, `parse_request`**: run on every front-end request. Any handler there reading request parameters must check capabilities itself.
- **Shortcodes and blocks** render attacker-controlled attributes from contributors and authors.
- **Cron hooks** (`wp_schedule_event`) don't run with a user. Don't trust data they read from user-writable places.
- **`register_setting` + `options.php`**: core checks the page capability (default `manage_options`, filterable via `option_page_capability_{$option_group}`). Custom save handlers must do their own checks.

## Privilege escalation sinks

Reachable by an unauthenticated user or a subscriber, these are **Critical**:

- **Arbitrary option update:** `update_option( $_POST['key'], $_POST['value'] )` or similar with attacker-chosen names. Setting `users_can_register=1` + `default_role=administrator` gives admin registration. Also `siteurl`/`home` (site takeover), `active_plugins`.
- **User meta / roles:** `update_user_meta( $user_id, $_POST['meta_key'], ... )` (`wp_capabilities` → admin), `wp_update_user( $_POST )` (includes `role`), `$user->set_role( $_POST['role'] )`, `add_cap()`.
- **User creation:** `wp_insert_user()` / `wp_create_user()` with a request-supplied role, or registration handlers that accept `role`.
- **Authentication as another user:** `wp_set_auth_cookie( $_GET['user_id'] )`, `wp_set_current_user()` with input, "login as user" or magic-link features without strong, single-use, expiring tokens. See `authentication.md`.
- **Plugin/theme management:** `activate_plugin()`, `Plugin_Upgrader`, `Theme_Upgrader`, `wp_install_plugin` reachable by low-privilege users.
- **Arbitrary file write/upload/delete:** see `file-uploads.md`.
- **Arbitrary post edit/delete:** `wp_update_post( $_POST )` or `wp_delete_post( $_GET['id'] )` without `current_user_can( 'edit_post' | 'delete_post', $id )`.

## Object-level access (IDOR)

- Handlers that take a post, order, user, comment, form-entry or file ID and act on it without a meta-capability check or an ownership comparison (`$post->post_author === get_current_user_id()`).
- Private or draft content returned by custom endpoints (`get_post( $id )` doesn't check status or permissions). Use `current_user_can( 'read_post', $id )`.
- Form-builder and membership plugins: entries, submissions, invoices and downloads keyed by ID or guessable tokens.
- WooCommerce orders: see `woocommerce.md`.

## REST permission callbacks

```php
register_rest_route( 'myplugin/v1', '/settings', [
    'methods'             => 'POST',
    'callback'            => 'myplugin_save_settings',
    'permission_callback' => '__return_true',          // ← anyone, unauthenticated
] );
```

- A missing `permission_callback` triggers a `_doing_it_wrong` notice (since 5.5) and the route is **public**.
- `permission_callback` that only checks `is_user_logged_in()` → any subscriber.
- The callback must check the **specific object** where relevant: `current_user_can( 'edit_post', $request['id'] )`.
- REST cookie authentication requires the `wp_rest` nonce (`X-WP-Nonce`). Without it, the request is treated as **unauthenticated** (current user 0), which blocks CSRF for cookie-auth calls. Application Passwords and other auth methods don't need the nonce.

## Abilities API (6.9+)

`wp_register_ability( 'myplugin/do-thing', [ 'permission_callback' => …, 'execute_callback' => … ] )` exposes functionality to AI agents (via the MCP Adapter) and other clients. The `permission_callback` **is the entire access control**. Review abilities exactly like REST routes: no `__return_true` on abilities that read private data or change state, object-level checks on inputs, and input schemas that constrain values. Abilities that run destructive actions should require high capabilities.

## Multisite

- **Super Admin** (`is_super_admin()`) differs from per-site Administrator. Site administrators **don't** have `unfiltered_html`, `install_plugins` or `edit_users` network-wide.
- Network-activated plugins: handlers must check network capabilities (`manage_network_options`) for network-level settings.
- `switch_to_blog()` in handlers: check the user is a member with appropriate capabilities on the target blog.

## Fix patterns

```php
add_action( 'wp_ajax_myplugin_save', function () {
    check_ajax_referer( 'myplugin_save' );
    if ( ! current_user_can( 'manage_options' ) ) {
        wp_send_json_error( null, 403 );
    }
    $value = sanitize_text_field( wp_unslash( $_POST['value'] ?? '' ) );
    update_option( 'myplugin_value', $value );   // fixed option name, never from input
    wp_send_json_success();
} );

register_rest_route( 'myplugin/v1', '/items/(?P<id>\d+)', [
    'methods'             => WP_REST_Server::EDITABLE,
    'callback'            => 'myplugin_update_item',
    'permission_callback' => fn ( WP_REST_Request $r ) => current_user_can( 'edit_post', (int) $r['id'] ),
    'args'                => [ 'id' => [ 'type' => 'integer', 'required' => true ] ],
] );
```

## Verification

- Create users for each role (`wp user create sub sub@example.test --role=subscriber`) and call each handler as unauthenticated → subscriber → contributor. Expect `403`/`-1`/`0` responses and no state change.
- `curl -s -X POST 'https://staging.example.test/wp-admin/admin-ajax.php' -d 'action=myplugin_save&value=x'` (no cookies) → must not change data.
- REST: `curl -s -X POST https://staging.example.test/wp-json/myplugin/v1/settings` → `401 rest_forbidden`.
- PHPUnit (WP test suite): `wp_set_current_user( self::factory()->user->create( [ 'role' => 'subscriber' ] ) );` then call the handler and assert failure.

References: Plugin Handbook → Checking User Capabilities; Roles and Capabilities; REST API Handbook → Permissions Callback; CWE-862, CWE-863, CWE-269, CWE-639.
