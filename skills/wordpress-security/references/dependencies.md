# WordPress — Core, Plugin and Theme Dependencies

## Contents
- Core version and support
- Recent core security releases
- Plugins and themes
- Vulnerability sources
- Supply chain risks
- Verification

## Core version and support

- Only the **latest major branch** is actively supported (7.1 as of 2026-10). Security fixes are backported to older branches back to **4.7** on a best-effort basis, with no guarantee. Anything below 4.7 gets nothing.
- Read the version from `wp-includes/version.php` (`$wp_version`) or `wp core version`. Check that the site runs the **latest minor of its branch** at least.
- Minor (security) auto-updates are on by default. Check `WP_AUTO_UPDATE_CORE`, `automatic_updater_disabled` and `auto_update_core_minor` filters for code that disables them.
- PHP version: WordPress supports old PHP versions for compatibility, but the server's PHP must itself be in security support (https://www.php.net/supported-versions.php).

## Recent core security releases

Verify against https://wordpress.org/news/category/security/:

| Release | Fix | Affected |
|---|---|---|
| 7.1.2 (Sep 2026) | Unauthenticated page-template resolution could include a readable local PHP file outside theme directories (possible RCE under conditions) | Backported to all branches through 4.7 |
| 7.0.2 / 6.9.5 / 6.8.6 (Jul 2026) | "WP2Shell": REST API batch-route confusion + SQL injection (`WP_Query` `author__not_in`) chained to unauthenticated RCE | 6.9.0–6.9.4 and 7.0.0–7.0.1 (both bugs); 6.8.x got the SQL-injection fix; versions before 6.8 unaffected |

Running an affected version is **Critical** when the advisory is unauthenticated and the site is internet-facing.

## Plugins and themes

For each installed plugin/theme (site review) or bundled library (plugin review):
1. Version: plugin header / `readme.txt` `Stable tag` / `wp plugin list`.
2. Known vulnerabilities for that version (sources below). Check that the vulnerable feature is reachable (some advisories need a specific setting or role).
3. Maintenance: last update date, "closed" status on WordPress.org (plugins are closed for security issues as well as other reasons; a closed plugin with an open security issue is **High**).
4. Source: WordPress.org, a reputable vendor, or **nulled/pirated** copies (frequently backdoored: Critical).
5. Bundled libraries in `vendor/`, `lib/`, `assets/js/`: outdated jQuery plugins, PHPMailer, TCPDF, dompdf, PHPExcel, Guzzle versions with known CVEs.

Inactive plugins still on disk can be exploitable when their PHP files are directly accessible or hooks load anyway. Recommend removal.

## Vulnerability sources

- WordPress.org plugin pages (security notes, closures), the WordPress core security news category
- Wordfence Intelligence, Patchstack, WPScan vulnerability databases
- GitHub Advisory Database / OSV for Composer packages
- WooCommerce developer advisories (developer.woocommerce.com)

If you can't query these, list plugins and versions, and mark "known vulnerabilities not checked" as a limitation instead of guessing.

## Supply chain risks

- Plugins loading remote code or config at runtime (`eval( wp_remote_retrieve_body( … ) )`, remote JS from vendor CDNs without SRI, auto-updaters pointing to vendor servers). Note them as supply-chain risk. Remote PHP execution is **Critical**.
- Plugins with ownership changes (sold to new vendors) have historically shipped backdoors and spam injections.
- Composer-managed sites (Bedrock): `composer audit`, lock file committed, `wpackagist` sources.
- Must-use plugins (`wp-content/mu-plugins/`) and drop-ins (`object-cache.php`, `advanced-cache.php`, `db.php`) run before regular plugins and are often overlooked. Review them, and check for unknown files (a common backdoor location).
- Look for backdoor indicators: unknown admin users, `eval(base64_decode(`, `gzinflate(`, `str_rot13(`, `$_POST` executed via `assert`/`create_function`, PHP files in `uploads/`, modified core files (`wp core verify-checksums`).

## Verification

```bash
wp core version && wp core check-update
wp core verify-checksums                       # detects modified core files
wp plugin list --fields=name,status,version,update_version,auto_update
wp plugin verify-checksums --all               # for WordPress.org plugins
wp theme list --fields=name,status,version,update_version
wp user list --role=administrator --fields=ID,user_login,user_email,user_registered
composer audit --locked                        # Composer-managed installs
```

References: WordPress Security Team / releases; Advanced Administration Handbook → Hardening, Updating; Plugin Handbook → Plugin Security; OWASP A03:2025 Software Supply Chain Failures; CWE-1104, CWE-506, CWE-829.
