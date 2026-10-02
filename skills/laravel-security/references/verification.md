# Laravel — Verifying Findings and Fixes

## Contents
- Principles
- Static confirmation
- Artisan commands for evidence
- Automated tests (Pest / PHPUnit)
- Safe dynamic checks
- Tooling
- Fix-verification checklist

## Principles

- Prefer **read-only evidence** (code, config, `artisan` output) over live exploitation.
- Dynamic checks only on environments the user owns and authorizes (local or staging), with test accounts, benign payloads, and no destructive or high-volume requests.
- Never exfiltrate real data or secrets while proving a finding. Demonstrate access with a harmless marker (e.g. read your own second test account's record).
- When you can't run anything, say so and classify as **Likely** with the missing runtime condition.

## Static confirmation

For each finding, record:
1. **Source:** where attacker input enters (route param, request field, header, uploaded file, stored data).
2. **Path:** the call chain, with file:line for each hop. Note every validation, cast, policy or middleware the data passes.
3. **Sink:** the sensitive operation.
4. **Missing control:** what should have been there, and confirmation that it isn't applied elsewhere (route group middleware, controller middleware, Form Request, global scope, policy, model event).

Search for siblings: once one instance is confirmed, search the codebase for the same pattern. Fixes must cover all of them.

## Artisan commands for evidence

These read state without modifying data. Run them only if the environment allows; don't run anything that migrates, seeds or deletes.

```bash
php artisan --version
php artisan about                       # env, debug, cache/config state, drivers
php artisan route:list -v               # routes with middleware (filter: --path=, --method=, --except-vendor)
php artisan config:show session         # effective config values (recent versions)
php artisan model:show User             # attributes, casts, fillable/guarded, hidden, policy
composer audit --locked
```

## Automated tests (Pest / PHPUnit)

Each fixed finding should have a regression test that **fails before the fix and passes after**. Patterns:

| Finding type | Test idea |
|---|---|
| IDOR / BOLA | Two users. B requests A's resource on every verb → `403`/`404`, and the data is unchanged |
| Missing admin check | Regular user hits admin route → `403` |
| Mass assignment | Submit privileged fields → stored values unchanged |
| Session fixation (custom auth) | Session ID differs before and after login |
| Logout invalidation | Session data cleared and guest after logout |
| SQL injection | Benign payload treated as data; `DB::enableQueryLog()` shows bindings |
| XSS | Stored payload appears escaped (`assertSee` vs `assertDontSee(..., false)`) |
| Upload | `.php`/`.svg`/oversized upload → validation error, nothing stored |
| SSRF | Internal addresses rejected (with `Http::fake()` / `Http::preventStrayRequests()`) |
| Open redirect | `//evil.example` → redirected to default |
| `env()` auth bypass | Missing header → `401` with config set |
| Webhook signature | Unsigned payload → `403`/`400` |
| Rate limiting | N+1 attempts → `429` / throttle message |

Note: **CSRF is disabled in tests**, so verify CSRF on a running environment (see `csrf.md`).

Use `RefreshDatabase` / factories. Never point tests at production databases.

## Safe dynamic checks

```bash
# Cookie flags
curl -sI https://staging.example.com/login | grep -i '^set-cookie'

# Exposed files and tools (expect 403/404)
for p in .env storage/logs/laravel.log telescope horizon pulse _debugbar/open log-viewer phpinfo.php; do
  printf "%-28s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://staging.example.com/$p)"; done

# Security headers
curl -sI https://staging.example.com/ | grep -iE 'strict-transport|content-security|x-content-type|x-frame|referrer-policy'

# CORS with credentials
curl -sI -H 'Origin: https://evil.example' https://staging.example.com/api/user | grep -i '^access-control-'

# Host header poisoning (inspect the generated reset link in the mail log / Mailpit, not a real inbox)
curl -s -X POST https://staging.example.com/forgot-password -H 'Host: evil.example' --data 'email=test-user@example.test'
```

## Tooling

- **Larastan/PHPStan** for type errors that hide security bugs (e.g. nullable `env()` values).
- **Psalm taint analysis** (`--taint-analysis`) for source→sink flows (SQL, shell, HTML, file paths).
- **Semgrep** PHP/Laravel rules for pattern sweeps; treat results as leads, not findings.
- **composer audit**, **npm audit** for dependencies.
- Secret scanners (gitleaks, trufflehog) over the repository history.

## Fix-verification checklist

After each fix, confirm and state in the report:

1. The original attack path no longer works (test or reasoning with file:line).
2. Legitimate behavior still works (existing tests pass, plus a positive test).
3. The fix uses Laravel's mechanism (policy, validated(), bindings, `store()`, config) rather than a one-off filter.
4. All sibling occurrences were found and fixed, or listed as remaining.
5. No equivalent bypass via another entry point (API vs web vs Livewire vs admin panel vs queued job).
6. Secrets exposed by the finding have been **rotated**, not just removed.
7. Config fixes include the deployment-side change (env vars, web server config), with a note that the agent couldn't verify production if that's the case.
