# WordPress — Verifying Findings and Fixes

## Contents
- Principles
- Static analysis
- WP-CLI evidence
- Automated tests
- Safe dynamic checks
- Fix-verification checklist

## Principles

- Prefer reading code, WP-CLI read-only output and configuration over live exploitation.
- Dynamic testing only on local/staging copies the user owns. Use test users per role, benign payloads, few requests, and never against production data or third-party sites.
- For distributed plugins, verify against the plugin as shipped (the release zip / `trunk`), not only the developer's working copy.
- State clearly when a finding depends on site configuration (open registration, roles, server config) that you couldn't check.

## Static analysis

```bash
# WordPress Coding Standards security sniffs
composer require --dev wp-coding-standards/wpcs dealerdirect/phpcodesniffer-composer-installer
vendor/bin/phpcs --standard=WordPress --sniffs=WordPress.Security.EscapeOutput,WordPress.Security.NonceVerification,WordPress.Security.ValidatedSanitizedInput,WordPress.Security.SafeRedirect,WordPress.DB.PreparedSQL,WordPress.DB.PreparedSQLPlaceholders,WordPress.PHP.DontExtract path/to/plugin
```

- **Plugin Check** (the official plugin, also `wp plugin check <slug>` with WP-CLI) runs the WordPress.org review checks, including security sniffs.
- Semgrep PHP rules and Psalm taint analysis help trace flows. Treat all tool output as leads, and confirm each by tracing entry point → sink.
- Search for siblings: once one handler is vulnerable, check every handler the plugin registers. Bugs usually repeat.

## WP-CLI evidence

```bash
wp core version; wp plugin list; wp theme list
wp option get users_can_register; wp option get default_role
wp user list --role=administrator
wp config get WP_DEBUG; wp config get DISALLOW_FILE_EDIT
wp core verify-checksums; wp plugin verify-checksums --all
wp eval 'var_dump( has_action( "wp_ajax_nopriv_myplugin_export" ) );'      # confirm a hook is registered
wp cap list subscriber                                                         # capabilities of a role
```

`wp eval` executes PHP. Use it only for read-only inspection on non-production copies.

## Automated tests

Use the WordPress PHPUnit test suite (`wp scaffold plugin-tests`), or `wp-env` for an isolated environment:

```php
class Test_Myplugin_Security extends WP_Ajax_UnitTestCase {
    public function test_subscriber_cannot_save_settings() {
        $this->_setRole( 'subscriber' );
        $_POST['_ajax_nonce'] = wp_create_nonce( 'myplugin_save' );
        $_POST['value']       = 'x';
        try {
            $this->_handleAjax( 'myplugin_save' );
        } catch ( WPAjaxDieContinueException $e ) {}
        $this->assertNotSame( 'x', get_option( 'myplugin_value' ) );
    }

    public function test_rest_route_requires_capability() {
        wp_set_current_user( self::factory()->user->create( [ 'role' => 'subscriber' ] ) );
        $response = rest_do_request( new WP_REST_Request( 'POST', '/myplugin/v1/settings' ) );
        $this->assertSame( 403, $response->get_status() );
    }
}
```

| Finding | Test idea |
|---|---|
| Missing capability check | Subscriber/unauthenticated call → failure, no state change |
| Missing nonce | Request without/with wrong nonce → `-1`/403 |
| SQLi | Payload treated as data; inspect `$wpdb->last_query` |
| XSS | Rendered output contains the escaped form |
| Upload | Disallowed types rejected; stored names safe |
| Order IDOR | Customer B can't read customer A's order |
| Gateway callback | Unsigned callback leaves the order pending |

## Safe dynamic checks

```bash
# Unauthenticated access to AJAX/REST handlers (expect 0, -1, 400, 401 or 403 and no side effects)
curl -s https://staging.test/wp-admin/admin-ajax.php -d 'action=myplugin_save&value=test'
curl -s -X POST https://staging.test/wp-json/myplugin/v1/settings

# Exposed files
for p in wp-content/debug.log .git/HEAD wp-config.php.bak wp-content/uploads/wc-logs/; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://staging.test/$p)"; done
```

For authenticated checks, log in as the test role in a browser or reuse its cookies with curl. Remove test users and data afterwards.

## Fix-verification checklist

1. The original request path now fails for the unauthorized role (test or request evidence).
2. The legitimate role still succeeds.
3. Every sibling handler (same plugin, same pattern) was checked.
4. Capability **and** nonce **and** sanitization/escaping/preparation are present where each applies.
5. Leaked secrets (salts, DB passwords, API keys) were **rotated**, not just removed. `wp config shuffle-salts` for salts.
6. For distributed plugins: a version bump and changelog entry so sites update. For serious issues, coordinate disclosure (WordPress.org plugin team / Patchstack / Wordfence).
