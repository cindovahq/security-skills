-- Realtime authorization for org chat and presence (channels named "org:<org_id>")

create policy "Members receive org broadcasts" on realtime.messages
for select to authenticated
using (
  (select realtime.topic()) like 'org:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "Members send org broadcasts" on realtime.messages
for insert to authenticated
with check (
  (select realtime.topic()) like 'org:%'
  and realtime.messages.extension in ('broadcast', 'presence')
);
