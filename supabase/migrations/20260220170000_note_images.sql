-- Shared note images bucket and policies.
-- Images are stored as:
--   {auth_user_id}/{scope}/{entity_id}/{timestamp-random.ext}

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do update
set public = excluded.public;

grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

drop policy if exists note_images_insert on storage.objects;
create policy note_images_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'note-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists note_images_update on storage.objects;
create policy note_images_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'note-images'
    and auth.uid() is not null
    and (owner = auth.uid() or public.is_admin())
  )
  with check (
    bucket_id = 'note-images'
    and auth.uid() is not null
    and (owner = auth.uid() or public.is_admin())
  );

drop policy if exists note_images_delete on storage.objects;
create policy note_images_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'note-images'
    and auth.uid() is not null
    and (owner = auth.uid() or public.is_admin())
  );

