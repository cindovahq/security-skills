# Supabase — Database Webhooks, pg_net, Cron and Vault

## Contents
- How the database makes outbound calls
- What to investigate
- Fix pattern
- Severity
- False positives
- Verification

## How the database makes outbound calls

- **`pg_net`** provides asynchronous HTTP from SQL: `net.http_get(url, ...)`, `net.http_post(url, body, params, headers, ...)`. Requests run after the transaction commits; responses land in `net._http_response`. The functions are `SECURITY DEFINER`. Install the extension in the `extensions` schema (the `net` schema is created automatically).
- **Database Webhooks** (Dashboard: Integrations > Webhooks) are triggers that call `supabase_functions.http_request(url, method, headers, params, timeout_ms)`, which uses `pg_net`. They fire **after** `INSERT`, `UPDATE` or `DELETE` and send the row (`record`, `old_record`) as JSON.
- **`pg_cron`** (`cron.schedule(name, schedule, command)`) runs SQL on a schedule, often a `net.http_post` to an Edge Function.
- **Vault** stores secrets encrypted at rest (`vault.create_secret(value, name, description)`) and decrypts them through the `vault.decrypted_secrets` view. The encryption key is held outside the database by Supabase.
- By default the `net` schema grants `USAGE` to `PUBLIC`, so `anon`/`authenticated` hold object privileges on `net.http_request_queue` and `net._http_response`. Supabase notes this is not reachable by clients because `net` is not exposed via the Data API and those roles cannot log in. It **becomes** reachable if `net` is added to exposed schemas, or through any exposed function or view that reads those tables or calls `net.http_*`.

## What to investigate

```text
net.http_post(   net.http_get(   supabase_functions.http_request(   cron.schedule(   create extension pg_net
'Authorization', 'Bearer   'apikey',   service_role   sb_secret_   vault.create_secret(   vault.decrypted_secrets
```

1. **Secrets in SQL text.** Migrations, `seed.sql`, webhook trigger definitions and `cron.schedule` commands with literal keys (`'Authorization', 'Bearer <service role or secret key>'`, third-party API keys). Migration files are in VCS, and cron commands and trigger arguments are stored in catalog tables (`cron.job.command`, `pg_trigger.tgargs`) where anyone with database access, backups or dumps can read them.
2. **Which key the job sends.** Jobs calling Edge Functions should send a dedicated named secret key (or a webhook signature), not the general `service_role` key. A job only needs to authenticate to its own function.
3. **SSRF through the database.** Exposed functions (RPC) or triggers that build the URL for `net.http_*` from user-controlled columns or arguments send requests from Supabase infrastructure to arbitrary hosts, including headers you attach (which may carry secrets).
4. **Data leaving the database.** Webhooks post entire rows, including sensitive columns, to the URL. Check the destination is HTTPS, owned by you, and authenticates the sender (shared secret header from Vault, or a signature).
5. **Vault exposure.** Views, `SECURITY DEFINER` functions or RPCs that select from `vault.decrypted_secrets` and are executable by `anon`/`authenticated`. Grants on the `vault` schema to client roles.
6. **Receivers.** Edge Functions or servers that accept webhook calls must authenticate them (see `edge-functions.md`); `verify_jwt = false` plus no secret check means anyone can post fake row events.

## Fix pattern

```sql
-- Store secrets once (run manually or from a secure deploy step, not in a committed migration)
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<named secret key for the digest job>', 'digest_job_key');

-- Reference them by name at run time
select cron.schedule('nightly-digest', '0 3 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_job_key')
    ),
    body := jsonb_build_object('run_at', now())
  );
$$);
```

The receiving function accepts only that key (`withSupabase({ auth: 'secret:digest_job_key' }, ...)` when the key is named `digest_job_key` in Settings > API Keys).

For SSRF-prone features, keep the URL server-defined (allow-listed table of destinations readable only by admins) and pass user data in the body, never in the URL or headers.

## Severity

- Secret/`service_role` key committed in a migration or webhook definition: **High** (Critical if the repository is public); rotate the key.
- Exposed function letting clients choose `net.http_*` URLs: **High** (Medium if responses are not readable and headers carry no secrets).
- `vault.decrypted_secrets` reachable by client roles: **Critical**.
- Webhook receivers without sender authentication that change state: **High**.

## False positives

- Publishable key in a cron job header calling a function that then authenticates differently (the publishable key is public anyway); verify the function does not trust it as proof of origin.
- `pg_net` in `extensions` with `net` not exposed and no exposed wrappers.
- Vault secrets read only inside cron commands or functions not executable by client roles.

## Verification

```sql
select jobid, jobname, schedule, left(command, 120) from cron.job;     -- look for literal keys (redact in reports)
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal;
select has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select');   -- expect false
select p.oid::regprocedure from pg_proc p
where pg_get_functiondef(p.oid) ilike '%net.http_%' and p.pronamespace = 'public'::regnamespace;
```

References: https://supabase.com/docs/guides/database/extensions/pg_net, https://supabase.com/docs/guides/database/webhooks, https://supabase.com/docs/guides/functions/schedule-functions, https://supabase.com/docs/guides/database/vault, https://supabase.com/docs/guides/cron; CWE-798, CWE-918, CWE-312.
