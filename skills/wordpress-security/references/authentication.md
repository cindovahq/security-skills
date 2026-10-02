# WordPress — Authentication and Accounts

## Contents
- Core authentication facts
- Custom login, magic links and SSO
- Registration
- Password reset and account changes
- Brute force and 2FA
- Sessions and cookies
- Verification

## Core authentication facts

- Passwords: `wp_hash_password()` uses **bcrypt** (with SHA-384 pre-hashing) since **6.8**. Earlier versions used phpass portable hashes, which are rehashed on next login. Application Passwords, reset keys, and personal-data request keys use BLAKE2b (`wp_fast_hash`) since 6.8.
- Auth cookies (`wordpress_logged_in_*`, `wordpress_sec_*`) are HMACs keyed by the salts in `wp-config.php` and tied to a session token stored in user meta (`session_tokens`). Changing the salts logs everyone out.
- `wp_check_password()`, `wp_authenticate()`, `wp_signon()`: use these. Never compare password hashes yourself.
- Plugins can replace pluggable functions (`wp_hash_password`, `wp_check_password`, `wp_set_auth_cookie`). Review any override carefully.

## Custom login, magic links and SSO

**Critical patterns:**

```php
// Auth bypass: logs in any user by ID or email from the request
$user = get_user_by( 'email', $_POST['email'] );
wp_set_current_user( $user->ID ); wp_set_auth_cookie( $user->ID );

// Token check that fails open
if ( $token == get_user_meta( $uid, 'login_token', true ) ) { … }   // '' == '' when no token was ever set
```

- **Magic links / OTP login:** the token must be random (`wp_generate_password( 32, false )` or `random_bytes`), stored hashed (`wp_hash()` / `wp_fast_hash()`), single-use, expiring, bound to one user, and compared with `hash_equals()`. Also check what happens when the stored token is empty.
- **SSO / OAuth / social login plugins:** state validation, ID-token verification, and **account linking by email only if the provider asserts `email_verified`**. Otherwise an attacker registers the victim's email at the IdP and logs in as the victim.
- **"Login as user" / impersonation features:** capability-restricted (`edit_users`, and not usable on higher-privileged users), nonce-protected, logged.
- **Custom REST/JWT auth plugins** (`determine_current_user` filter): signature verification, algorithm pinning, secret strength (`JWT_AUTH_SECRET_KEY` not default or committed), expiry.

## Registration

- `users_can_register` + `default_role`: the default role must be `subscriber` (or `customer` for Woo). `default_role` set to `administrator`/`editor` → anyone becomes admin. That's a configuration finding (Critical), or a code finding if a plugin sets it.
- Custom registration forms/endpoints (form builders, membership plugins): check they don't accept `role` or `wp_capabilities` from input, they enforce the "registration enabled" setting, they don't auto-verify email ownership if the site relies on it, and they're rate-limited or protected against bots.
- Multisite: `wpmu_signup_*`, `wpmu_activate_signup`. Check activation keys.

## Password reset and account changes

- Core reset keys are hashed and expire (`password_reset_expiration` filter, default 1 day).
- Custom reset flows: random keys, hashed storage, expiry, single use, lookup by key **and** user, no user ID taken from the request in the final step, and generic responses (no user enumeration where it matters).
- **Host-header poisoning:** core builds reset links with `network_site_url()` (from `siteurl`, not the request host). Plugins building links from `$_SERVER['HTTP_HOST']` are vulnerable.
- Email change: core sends a confirmation to the new address (`new_user_email` meta) for profile edits. Custom profile handlers updating `user_email` directly bypass that → account takeover via later password reset.
- Password changes made by plugin code should end the user's other sessions: `WP_Session_Tokens::get_instance( $uid )->destroy_others( wp_get_session_token() )`, or `destroy_all()` when an admin resets someone else's password. Check whether custom password-change and reset handlers do this.

## Brute force and 2FA

- Core has no login rate limiting. Sites rely on plugins, the host or a WAF. For a site review: no protection on `wp-login.php` and `xmlrpc.php` is Hardening/Medium depending on password policy and exposure.
- Plugins with their own login endpoints (AJAX/REST login, OTP verification) must rate-limit, and must not bypass the site's 2FA plugin (e.g. a custom login that calls `wp_set_auth_cookie` directly skips 2FA hooks).
- OTP/2FA codes without attempt limits → brute-forceable (6 digits) → **High**.

## Sessions and cookies

- Plugins storing auth or authorization state in their own cookies (`myplugin_user=5`, `is_admin=1`) → trivially forged. Use core auth.
- Custom session handling (`$_SESSION`) for authorization: session fixation and missing regeneration.
- `FORCE_SSL_ADMIN` and an HTTPS `siteurl` ensure secure cookies. See `secrets-config.md`.

## Verification

- Try each custom auth path with a missing token, an empty token, another user's token, and an expired token. All must fail.
- Confirm `wp option get default_role` returns `subscriber`/`customer`, and `wp option get users_can_register` matches intent.
- Registration endpoints: submit `role=administrator`, `wp_capabilities[administrator]=1` → the created user is still the default role.
- PHPUnit: `wp_set_current_user( 0 )`, call the login handler with forged parameters, assert `get_current_user_id() === 0` and no auth cookie was set.

References: Plugin Handbook → Security; WordPress 6.8 bcrypt announcement (make.wordpress.org/core/2025/02/17); `wp_set_auth_cookie()` reference; CWE-287, CWE-288, CWE-640, CWE-307, CWE-269.
