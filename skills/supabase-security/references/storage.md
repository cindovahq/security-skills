# Supabase — Storage Buckets and Object Policies

## Contents
- How Storage authorizes
- What to investigate
- Fix pattern
- Signed URLs
- Upload restrictions
- Severity
- False positives
- Verification

## How Storage authorizes

- Buckets live in `storage.buckets` (`id`, `public`, `file_size_limit` in bytes, `allowed_mime_types`), objects in `storage.objects` (`bucket_id`, `name` = path, `owner_id` = uploader's `sub` as text, `metadata`). The older `owner` column is deprecated.
- Every operation is checked against **RLS policies on `storage.objects`** for the caller's role. Without policies, nothing is allowed (except via the secret key, which bypasses RLS).
- Policies needed per operation (storage-js reference): `upload` needs `insert` (with `upsert: true`, also `select` and `update`); `createSignedUploadUrl` needs `insert`; `update`/`move` need `update` + `select`; `copy` needs `insert` + `select`; `createSignedUrl`, `list` and authenticated downloads need `select`; `remove` needs `delete` + `select`.
- **Public buckets** (`public = true`) skip access control for **downloads**: anyone with the URL `.../storage/v1/object/public/<bucket>/<path>` can read the file. Uploads, deletes, moves and copies are still checked. Buckets are private by default.
- Objects created with the secret key, or from the Dashboard, have no owner.

## What to investigate

```text
insert into storage.buckets   createBucket(   public: true   'public', true   [storage.buckets.*] public = true
on storage.objects   bucket_id =   storage.foldername(   storage.filename(   storage.extension(   owner_id
createSignedUrl(   createSignedUrls(   expiresIn   getPublicUrl(   upload(   upsert: true   allowedMimeTypes   fileSizeLimit
```

1. **Bucket visibility vs content.** Public buckets holding invoices, contracts, IDs, exports, private attachments or anything per-user → finding. Object paths are usually guessable (`{user_id}/avatar.png`, `{org_id}/invoice-1042.pdf`) or leak via the app.
2. **Policies that only check the bucket.** `using (bucket_id = 'attachments')` to `authenticated` lets every signed-up user read, overwrite or delete every file in the bucket.
3. **Ownership checks.** Path-based: `(storage.foldername(name))[1] = (select auth.uid()::text)`; owner-based: `owner_id = (select auth.uid()::text)`. For tenant buckets, check membership of the org in the path: `(select private.is_org_member(((storage.foldername(name))[1])::uuid))`. Watch for casts that throw on non-UUID paths (error, not bypass) and for checks on the wrong path segment.
4. **Insert without matching path rules.** If `insert` checks the folder but `update` doesn't, users can overwrite others' files with `upsert`.
5. **Listing on public buckets.** A broad `select` policy on a public bucket makes its contents enumerable via the list API, although public URLs work without any policy (advisor `0025_public_bucket_allows_listing`).
6. **Server-side uploads with the secret key** using a path from the request (`${body.orgId}/${file.name}`) without verifying the caller's org.
7. **Serving user uploads.** HTML/SVG uploaded to a bucket are served from the Storage domain. Consider content-type restrictions and how your app embeds them (see `nextjs-security` or `nodejs-security` for app-side XSS).

## Fix pattern

```sql
-- Private per-user bucket, files under "<user_id>/..."
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf']);

create policy "Users read own documents" on storage.objects for select to authenticated
using ( bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text) );

create policy "Users upload own documents" on storage.objects for insert to authenticated
with check ( bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text) );

create policy "Users replace own documents" on storage.objects for update to authenticated
using ( bucket_id = 'documents' and owner_id = (select auth.uid()::text) )
with check ( bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text) );

create policy "Users delete own documents" on storage.objects for delete to authenticated
using ( bucket_id = 'documents' and owner_id = (select auth.uid()::text) );

-- Make an over-exposed bucket private (existing public URLs stop working)
update storage.buckets set public = false where id = 'invoices';
```

Use `storage.allow_only_operation('object.list')` / `storage.allow_any_operation(array[...])` when one `select` policy must distinguish listing from downloading.

## Signed URLs

- `createSignedUrl(path, expiresIn)` takes seconds. Anyone holding the URL can download until it expires. Treat it as a bearer token: do not log it, put it in analytics, or email it with a long lifetime.
- Expiries of days to years on sensitive files make the bucket effectively public for those objects. Issue short-lived URLs on demand after an authorization check.
- Creating a signed URL requires `select` on the object for the caller (or the secret key on the server). A server route that signs any path from the request with the secret key is an IDOR.

## Upload restrictions

- Set `file_size_limit` and `allowed_mime_types` per bucket (`createBucket(..., { fileSizeLimit, allowedMimeTypes })`, `insert into storage.buckets`, or `[storage.buckets.<name>]` in `config.toml` for the local stack). The global limit is set in Storage settings and caps per-bucket limits (Free plan max 50 MB).
- `allowed_mime_types` is compared against the **Content-Type the client declares** (per the Storage server source); it does not inspect file bytes. `image/*` also admits `image/svg+xml`. Restrict to the exact types you need and validate content server-side when it matters.
- `storage.extension(name)` in a policy checks the name only.

## Severity

- Public bucket with sensitive per-user or per-tenant files: **High** (Critical for regulated data such as IDs or medical records at scale).
- Bucket-only policies letting any user read others' private files: **High**; write/delete/overwrite of others' files: **High**.
- Long-lived signed URLs for sensitive files: **Medium**.
- Missing MIME/size limits: **Low/Medium** (abuse, stored content risks), higher if uploads are rendered inline by the app.

## False positives

- Public buckets for intentionally public assets (avatars, product images, blog media) with uploads restricted to the owner's folder.
- No `select` policy on a public bucket: downloads by URL still work, and listing is blocked, which is usually desired.
- Server-side code using the secret key for uploads after verifying the caller and deriving the path itself.

## Verification

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'storage' and tablename = 'objects' order by policyname;
```

As user B (test accounts on a local stack): `supabase.storage.from('attachments').download('<user-A-path>')` must fail, `upload('<user-A-path>', file, { upsert: true })` must fail, and `list('<user-A-folder>')` must return nothing. For public buckets, confirm `curl -I "$SUPABASE_URL/storage/v1/object/public/<bucket>/<known-path>"` returns 200 only for content meant to be public.

References: https://supabase.com/docs/guides/storage/security/access-control, https://supabase.com/docs/reference/javascript/storage-from-upload, https://supabase.com/docs/guides/storage/buckets/fundamentals, https://supabase.com/docs/guides/storage/security/ownership, https://supabase.com/docs/guides/storage/schema/helper-functions, https://supabase.com/docs/guides/storage/uploads/file-limits, https://github.com/supabase/storage; CWE-284, CWE-639, CWE-434.
