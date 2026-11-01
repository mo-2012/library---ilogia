-- iLogia Library — 002: private Storage bucket + object policies.
-- FOR REVIEW. Creates a NEW private bucket. Does not touch the existing 'library' bucket or any file in it.
-- The per-file size limit below must not exceed your Supabase plan's global limit (Dashboard → Storage → Settings).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-resources', 'library-resources', false, 52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/epub+zip',
    'text/plain',
    'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4',
    'image/png', 'image/jpeg', 'image/webp'
  ])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Path convention (enforced by the policies):  u/<uploader uuid>/<resource uuid>/file.<ext>   and   .../cover.<ext>

-- True when the object belongs to a published resource (its file or its cover).
create or replace function public.library_object_is_published(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.library_resources r
    where r.status = 'published' and (r.storage_path = p_name or r.cover_path = p_name)
  );
$$;
revoke all on function public.library_object_is_published(text) from public, anon;
grant execute on function public.library_object_is_published(text) to authenticated;

drop policy if exists library_objects_read   on storage.objects;
drop policy if exists library_objects_insert on storage.objects;
drop policy if exists library_objects_delete on storage.objects;

-- Read (also needed to mint Signed URLs): admins, the uploader, or anyone signed-in for PUBLISHED resources.
create policy library_objects_read on storage.objects for select to authenticated
using (
  bucket_id = 'library-resources' and (
    public.is_admin()
    or ((storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text)
    or public.library_object_is_published(name)
  )
);

-- Upload: only people allowed to upload, only into their own folder.
create policy library_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'library-resources'
  and (storage.foldername(name))[1] = 'u'
  and (storage.foldername(name))[2] = auth.uid()::text
  and array_length(storage.foldername(name), 1) = 3
  and public.library_can_upload()
);

-- Delete: admins, or the uploader as long as the object is not part of a published resource.
create policy library_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'library-resources' and (
    public.is_admin()
    or ((storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text
        and not public.library_object_is_published(name))
  )
);
