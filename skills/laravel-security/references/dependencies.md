# Laravel — Dependencies and Supply Chain

## Contents
- Framework support status
- Vulnerable packages
- Notable advisories
- Production dependency hygiene
- Front-end dependencies
- Verification

## Framework support status

Read the installed version from `composer.lock`. Laravel's policy: bug fixes for 18 months, security fixes for 2 years per major version.

| Version | Security fixes until |
|---|---|
| 10.x | Feb 2025 (ended) |
| 11.x | Mar 2026 (ended) |
| 12.x | Feb 2027 |
| 13.x | Mar 2028 |

Check https://laravel.com/docs/releases for the authoritative table. An app on a version without security fixes → **Medium** finding ("unsupported framework"), raised if a known advisory affects the installed version. Also check the PHP version: PHP itself has an EOL schedule (https://www.php.net/supported-versions.php).

## Vulnerable packages

1. Run `composer audit` (Composer ≥ 2.4) against the lock file. It reports advisories from the Packagist/GitHub advisory databases. Recent Composer versions also flag abandoned packages.
   - No Composer available? Read `composer.lock` and check versions against https://github.com/advisories (ecosystem: Composer) or https://osv.dev.
2. For each advisory, check **reachability** before rating severity: is the vulnerable feature used? Is the precondition present (e.g. debug mode, a specific config)? An advisory in an unused code path is Low/Informational. In a used, exposed feature, use the advisory severity.
3. Don't report a package as vulnerable just because it's old. Report "outdated" only as Hardening, and only when it blocks security updates.

## Notable advisories

Verify against the installed versions:

| Package | Advisory | Affected | Fixed |
|---|---|---|---|
| livewire/livewire | CVE-2025-54068: unauthenticated RCE via property update hydration | 3.0.0-beta.1 – 3.6.3 | 3.6.4 |
| laravel/framework | CVE-2024-52301: environment manipulation via query string when `register_argc_argv=On` | < 10.48.23, 11.0 – < 11.31.0 (also older majors) | 10.48.23, 11.31.0 |
| facade/ignition | CVE-2021-3129: RCE when debug mode is enabled | < 2.5.2 | 2.5.2 |
| laravel/framework | CVE-2018-15133: RCE via unserialize of the decrypted `X-XSRF-TOKEN`/cookie with known `APP_KEY` | ≤ 5.5.40, 5.6.x ≤ 5.6.29 | 5.5.42, 5.6.30 |

This table is not exhaustive. `composer audit` is the source of truth.

## Production dependency hygiene

- Debug and dev tools in `require` instead of `require-dev`: `barryvdh/laravel-debugbar`, `laravel/telescope` (fine in `require` if gated), `spatie/laravel-ignition`, `fakerphp/faker`, `laravel/pail`. Combined with `APP_DEBUG`/`APP_ENV` misconfig, they expose data.
- Production installs should use `composer install --no-dev --optimize-autoloader`. Check Dockerfiles and deploy scripts.
- `composer.lock` should be committed for applications, otherwise builds aren't reproducible.
- `config.allow-plugins` in `composer.json`: Composer plugins execute code at install time. `"allow-plugins": true` (all) → Hardening.
- Custom repositories (`"repositories": [{"type": "vcs", ...}]`) and `dev-main` branches: supply-chain risk. Prefer tagged releases.
- `roave/security-advisories` (`dev-latest`) in `require-dev` blocks installation of packages with known advisories. Recommend as Hardening.
- Abandoned packages that handle security-sensitive functions (auth, JWT, uploads, sanitization) → Medium/Hardening with a migration suggestion.

## Front-end dependencies

Laravel apps also ship JS (`package.json`, `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`). Run `npm audit --omit=dev` (or the pnpm/yarn equivalent). Build-only dev dependencies (Vite plugins) rarely affect production. Runtime front-end libraries (sanitizers, markdown renderers, rich-text editors) matter most.

## Verification

```bash
composer audit --locked          # exit code non-zero when advisories exist
composer show laravel/framework livewire/livewire --locked
composer check-platform-reqs --lock
npm audit --omit=dev
```

After upgrading, re-run `composer audit`, the test suite, and the specific checks for the advisory (e.g. Livewire version ≥ 3.6.4).

References: OWASP A06:2021 / A03:2025 Software Supply Chain Failures; CWE-1104, CWE-1395; https://getcomposer.org/doc/03-cli.md#audit, https://laravel.com/docs/releases#support-policy.
