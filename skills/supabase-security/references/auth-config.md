# Supabase — Auth Configuration and Flows

## Contents
- Where auth settings live
- Sign-up and email confirmation
- Redirect URLs and Site URL
- Passwords, OTPs and rate limits
- MFA and assurance levels
- Anonymous sign-ins
- Auth hooks, custom claims and SSO
- Sessions
- Self-hosted Auth advisories
- Severity
- False positives
- Verification

## Where auth settings live

Hosted settings are in the Dashboard (Authentication > Sign In / Providers, URL Configuration, Rate Limits, Attack Protection, Multi-Factor, Sessions, Auth Hooks). `supabase/config.toml` configures the **local stack** and is applied to a hosted project only via `supabase config push` (or branching). When a risky value appears only in `config.toml`, report it as **Likely** and name the unverified condition ("hosted project uses the same setting"); `supabase config diff` shows drift.

Key `config.toml` settings: `[auth] site_url`, `additional_redirect_urls`, `enable_signup`, `enable_anonymous_sign_ins`, `minimum_password_length`, `password_requirements`, `jwt_expiry`, `enable_refresh_token_rotation`; `[auth.email] enable_confirmations`, `double_confirm_changes`, `secure_password_change`, `otp_expiry`, `max_frequency`; `[auth.rate_limit]`; `[auth.captcha]`; `[auth.mfa.*]`; `[auth.sessions] timebox`, `inactivity_timeout`; `[auth.hook.*]`.

## Sign-up and email confirmation

- **`enable_signup`**: with sign-ups open (the default), "any authenticated user" means "anyone on the internet". Rate `to authenticated using (true)` policies accordingly.
- **Confirm Email** (`[auth.email] enable_confirmations`): when disabled, users sign in without proving they own the address, and the email is **implicitly marked confirmed**. Anyone can register `ceo@yourcompany.com`. This turns any trust in the email claim into a bypass:
  - RLS like `(auth.jwt() ->> 'email') like '%@yourcompany.com'` (staff access by domain)
  - domain-based org auto-join, invite acceptance matched only by email, "admin emails" allow-lists in code
  - The local template ships `enable_confirmations = false`; check the hosted setting before rating.
- `double_confirm_changes = true` requires confirming both old and new addresses on email change. Disabling it eases account takeover after session theft.

## Redirect URLs and Site URL

- `redirectTo` / `emailRedirectTo` must match the **Redirect URLs** allow-list; otherwise Auth falls back to the **Site URL**. Leaving Site URL at `http://localhost:3000` in production breaks or misdirects confirmation and reset links.
- Wildcards: `*` matches non-separator characters (separators are `.` and `/`), `**` matches anything. Supabase recommends exact paths in production.
- **Token or code theft:** a pattern that matches hosts an attacker can control sends the auth code or tokens there. `https://*.vercel.app/**` or `https://*.netlify.app/**` match **any** customer's deployment; scope previews to your team (`https://*-<team-slug>.vercel.app/**`). `https://**.example.com` style patterns also match attacker subdomains if any subdomain is takeover-prone.
- With the implicit flow, tokens arrive in the URL fragment; with PKCE (the default in `@supabase/ssr`), a code arrives that still needs the verifier. Treat both as sensitive.
- The app's own callback (`/auth/callback`, `/auth/confirm`) often reads a `next` parameter and redirects after `exchangeCodeForSession` / `verifyOtp`. Allow only relative paths starting with a single `/` (framework open-redirect details: `nextjs-security`, `nodejs-security`).
- Email templates that use `{{ .SiteURL }}` vs `{{ .RedirectTo }}`: custom templates with hand-built links should use `token_hash` links to your own confirm endpoint.

## Passwords, OTPs and rate limits

- `minimum_password_length` (local default 6; Supabase recommends 8+) and `password_requirements`. **Leaked password protection** (HaveIBeenPwned) is available on Pro and above.
- `secure_password_change` (reauthentication or recent login to change password) and "require current password" reduce the impact of stolen sessions.
- Magic links / email OTPs expire after 1 hour by default (`otp_expiry = 3600`) and can be requested once per 60 seconds per user. Long expiries widen the window for leaked links.
- Built-in rate limits (per IP unless noted): sign-up/sign-in 30 per 5 min, token verification 30 per 5 min, token refresh 150 per 5 min, anonymous sign-ins 30 per hour, MFA challenge/verify 15 per minute (not customizable), built-in email provider 2 emails per hour per project. Server-side apps that proxy Auth calls see all traffic from one IP; forward the client IP with `Sb-Forwarded-For` and a secret key after enabling IP forwarding, rather than raising limits.
- **CAPTCHA** (hCaptcha or Turnstile) protects sign-up, sign-in, reset and anonymous sign-ins from automation.

## MFA and assurance levels

- MFA in the UI changes nothing for direct API calls. Enforce it with **restrictive** RLS policies on `(select auth.jwt() ->> 'aal') = 'aal2'`, and in server code by checking the `aal` claim from `getClaims()`.
- Unenrolling a factor downgrades the session from `aal2` to `aal1` only after refresh. Sensitive actions (factor removal, email/password change) should require `aal2` at that moment.
- TOTP and phone MFA are configured under `[auth.mfa.totp]` / `[auth.mfa.phone]`; MFA challenge/verify endpoints are rate limited at 15/min per IP.

## Anonymous sign-ins

- Anonymous users get the `authenticated` role with `is_anonymous: true`. Every `to authenticated` policy and every server check of "is logged in" admits them. Check policies with restrictive `is_anonymous is false` where needed (see `rls-policies.md`).
- Enable CAPTCHA; the default limit is 30 anonymous sign-ins per hour per IP. There is no automatic cleanup.
- Supabase reports cases of user metadata cached across anonymous users with Next.js static rendering. Use dynamic rendering for user-specific pages.
- The Security Advisor flags enabled anonymous sign-ins (`0012_auth_allow_anonymous_sign_ins`, INFO): a prompt to review policies, not a vulnerability by itself.

## Auth hooks, custom claims and SSO

- **Custom access token hook** adds claims at token issue. Claims are trusted only if the hook reads trusted data (a roles table users cannot write, `app_metadata`). Grant the hook function `execute` to `supabase_auth_admin` and revoke it from `authenticated`, `anon`, `public`; grant the tables it reads to `supabase_auth_admin` only. HTTP hooks must verify the Standard Webhooks signature.
- `app_metadata` is writable only with the secret key (admin API). Server routes that set `app_metadata` from request input recreate the `user_metadata` problem.
- **SAML SSO / third-party auth (Clerk, Auth0, Cognito, Firebase):** policies should check the provider or issuer when access depends on it (for example, internal apps that must require SSO).
- **Self-hosted OAuth providers:** keep provider secrets in env substitution (`env(...)`) in `config.toml`, not literal values.

## Sessions

- Access tokens live `jwt_expiry` seconds (default 3600). Refresh tokens are single-use with a short reuse interval; reuse outside the allowed cases revokes the session.
- `[auth.sessions] timebox` / `inactivity_timeout` force re-login (Pro plan and up on hosted).
- `signOut()` defaults to `scope: 'global'` (all sessions). An unexpired access token stays valid until expiry even after sign-out; `getUser()` detects revoked sessions, `getClaims()` does not (see `server-ssr-clients.md`).

## Self-hosted Auth advisories

Hosted projects are patched by Supabase. For self-hosted `supabase/gotrue` (Auth) images, check the version against: CVE-2026-31813 (session issuance with crafted Apple/Azure ID tokens, fixed in 2.185.0) and GHSA-3529-5m8x-rpv3 (email link poisoning, v2.67.1 to v2.163.0, fixed in v2.163.1). Source: https://github.com/supabase/auth/security/advisories.

## Severity

- Email confirmation disabled **and** authorization trusts email or domain: **High/Critical** (staff or tenant access by registering an address).
- Redirect allow-list matching attacker-controllable hosts: **High** (token/code theft enabling account takeover), **Medium** if only PKCE and the code is useless without the verifier in your flow (state the assumption).
- MFA offered but not enforced server-side for data that requires it: **Medium/High** by data.
- Anonymous sign-ins enabled while policies grant `authenticated` users sensitive writes: rate by what anonymous users can do.
- Weak password policy, no leaked-password protection, no CAPTCHA: **Low/Medium (hardening)**.

## False positives

- `enable_confirmations = false` in `config.toml` for the local stack when the hosted project enforces confirmation and nothing trusts email claims.
- `http://localhost:3000/**` in `additional_redirect_urls` of the local config only.
- Anonymous sign-ins enabled with policies that distinguish `is_anonymous`.
- Rate limits left at defaults.

## Verification

```bash
supabase config diff                       # local config.toml vs hosted settings (read-only)
# Redirect allow-list check on a local stack: request a magic link with a foreign redirect
curl -s -X POST "http://127.0.0.1:54321/auth/v1/otp?redirect_to=https://attacker.example/cb" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{"email":"test-user@example.test"}'
# Inspect the link in the local email testing UI (port 54324): it must not point to attacker.example
```

References: https://supabase.com/docs/guides/auth/general-configuration, https://supabase.com/docs/guides/auth/redirect-urls, https://supabase.com/docs/guides/auth/password-security, https://supabase.com/docs/guides/auth/rate-limits, https://supabase.com/docs/guides/auth/auth-mfa, https://supabase.com/docs/guides/auth/auth-anonymous, https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook, https://supabase.com/docs/guides/local-development/cli/config; CWE-601, CWE-287, CWE-307, CWE-308.
