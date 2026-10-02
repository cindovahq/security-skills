-- Storage buckets and object policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']),
  ('attachments', 'attachments', false, 26214400, null),
  ('invoices', 'invoices', true, 10485760, array['application/pdf']);

-- avatars: files live under "<user_id>/..."
create policy "Users upload their own avatar" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users replace their own avatar" on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- attachments: files live under "<org_id>/<document_id>/..."
create policy "Members can read attachments" on storage.objects
for select to authenticated
using ( bucket_id = 'attachments' );

create policy "Members can upload attachments" on storage.objects
for insert to authenticated
with check ( bucket_id = 'attachments' );

create policy "Members can replace attachments" on storage.objects
for update to authenticated
using ( bucket_id = 'attachments' );

create policy "Members can delete attachments" on storage.objects
for delete to authenticated
using ( bucket_id = 'attachments' );

-- invoices: PDFs are written by the billing worker as "<org_id>/<invoice_number>.pdf"
