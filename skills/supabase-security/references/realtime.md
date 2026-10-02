# Supabase — Realtime (Broadcast, Presence, Postgres Changes)

## Contents
- Authorization model
- What to investigate
- Fix pattern
- Postgres Changes
- Self-hosted Realtime advisories
- Severity
- False positives
- Verification

## Authorization model

| Feature | What is authorized | How |
|---|---|---|
| Broadcast, Presence on **public** channels | Nothing | Anyone with the publishable/anon key can join, listen and send on any topic name |
| Broadcast, Presence on **private** channels (`config: { private: true }`) | Join, receive, send | RLS policies on `realtime.messages`: `select` = receive, `insert` = send; `extension` is `'broadcast'` or `'presence'`; `realtime.topic()` returns the channel topic |
| Postgres Changes | Each change event per subscriber | RLS `select` policies on the source table (and the table must be in the `supabase_realtime` publication) |

- Private channels are only enforced when **"Allow public access"** is disabled in Realtime Settings. While enabled, clients that omit `private: true` join public channels with no policy check.
- RLS is already enabled on `realtime.messages`. Do not `alter table realtime.messages enable row level security` in migrations (on hosted projects the migration role doesn't own the table, so the statement can fail and abort the rest of the migration).
- Permissions are computed when the client joins (from the JWT, headers and topic) and cached per connection.

## What to investigate

```text
.channel(   private: true   .on('broadcast'   .on('presence'   .track(   .send({ type: 'broadcast'
.on('postgres_changes'   on realtime.messages   realtime.topic()   extension   alter publication supabase_realtime   replica identity full
```

1. **Sensitive data on public channels.** Chat messages, cursors with user IDs, notifications, order status or anything per-user/per-tenant sent with `.send()` on a channel without `private: true` (or with public access still allowed) → anyone can subscribe by guessing the topic.
2. **`realtime.messages` policies that check only the topic shape**, for example `realtime.topic() like 'org:%'` or `using (true)` for `authenticated`. Any signed-up user then reads or injects messages on every org's channel.
3. **Send vs receive.** An `insert` policy lets clients broadcast; forged messages (fake "payment received", fake system events) are an integrity issue. Restrict `insert` separately from `select`.
4. **Presence metadata** (`track({ user_id, email, location })`) is visible to everyone allowed to receive presence on the topic.
5. **Server-side broadcasts** (REST `realtime/v1/api/broadcast` with a secret key, or `realtime.send(payload, event, topic, is_private)` / `realtime.broadcast_changes()` from triggers). Check that triggers send only to the affected tenant's topic and that `is_private` is `true` for sensitive payloads: a public broadcast reaches public channels.

## Fix pattern

```sql
create policy "Org members receive org broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and (select realtime.topic()) like 'org:%'
  and (select private.is_org_member(split_part((select realtime.topic()), ':', 2)::uuid))
);

create policy "Org members send org broadcasts"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) like 'org:%'
  and (select private.is_org_member(split_part((select realtime.topic()), ':', 2)::uuid))
);
```

```ts
const channel = supabase.channel(`org:${orgId}`, { config: { private: true } })
```

Then disable "Allow public access" in Realtime Settings so clients cannot fall back to public channels. Keep the policies cheap and indexed: they run on every join.

## Postgres Changes

- Events are filtered per subscriber by the table's RLS `select` policies, so table RLS bugs leak in real time as well.
- **`DELETE` events are not filtered by RLS** (Postgres cannot check access to a deleted row). With `replica identity full`, old-record values are included for updates and deletes. Avoid `replica identity full` on sensitive tables, or use Broadcast from a trigger with per-tenant topics instead.
- Tables in non-public schemas need `grant select ... to authenticated` to stream; enable RLS on them first.
- The `select` column option limits payload columns but requires the role to be able to select those columns. It is a payload filter, not access control.

## Self-hosted Realtime advisories

Hosted Realtime is managed by Supabase. For self-hosted `supabase/realtime`, check the image version against https://github.com/supabase/realtime/security/advisories, including: CVE-2026-62247 (presence read policies not honored, ≤ 2.111.1, fixed in 2.111.2), CVE-2026-54238 (expired JWTs with string `exp` accepted by REST broadcast authorization), and GHSA-9vjf-j9f7-j42c (published 2026-09-24: broadcasters could forge protocol events, including `postgres_changes`, to other subscribers using the V1 serializer (V2 subscribers aren't affected); affects ≤ 2.137.14; check the advisory for the fixed release).

## Severity

- Per-user or per-tenant sensitive data on public channels, or `realtime.messages` policies without membership checks: **High** (Medium for low-sensitivity data such as typing indicators).
- Clients can inject messages other users trust (system events, statuses): **Medium/High** by what the UI does with them.
- DELETE event leakage of identifiers only: **Low**; with full old records of sensitive tables: **Medium/High**.

## False positives

- Public channels used for genuinely public data (live scores, public cursors in a demo).
- `using (true)` receive policies on topics that only carry public data, with a stricter `insert` policy.
- Postgres Changes on tables whose RLS is correct.

## Verification

On a local stack, sign in as user B and subscribe to `org:<org-A-id>` with `private: true`: the subscription must fail or receive nothing; `send()` must be rejected. Subscribe **without** `private: true` and confirm the project rejects public channels (or that no sensitive data is sent on them).

```sql
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'realtime' and tablename = 'messages';
select * from pg_publication_tables where pubname = 'supabase_realtime';
```

References: https://supabase.com/docs/guides/realtime/authorization, https://supabase.com/docs/guides/realtime/settings, https://supabase.com/docs/guides/realtime/postgres-changes, https://github.com/supabase/realtime/security/advisories; CWE-284, CWE-639, CWE-345.
