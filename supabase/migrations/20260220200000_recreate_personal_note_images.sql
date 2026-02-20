-- Recreate personal note image storage after rollback/removal.
-- Images are stored as:
--   {page_id}/{uploader_user_id}/{timestamp}-{random}-{filename}

insert into storage.buckets (id, name, public)
values ('personal-note-images', 'personal-note-images', true)
on conflict (id) do update
set public = excluded.public;

grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

drop policy if exists personal_note_images_insert on storage.objects;
create policy personal_note_images_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'personal-note-images'
    and auth.uid() is not null
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.personal_pages p
      where p.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null::uuid
        end
      )
        and (
          p.owner_id = auth.uid()
          or (
            p.share_mode = 'inherit'
            and (
              exists (
                select 1
                from public.personal_section_members sm
                where sm.section_id = p.section_id
                  and sm.user_id = auth.uid()
                  and sm.role = 'edit'
              )
              or exists (
                select 1
                from public.personal_page_members pm
                where pm.page_id = p.id
                  and pm.user_id = auth.uid()
                  and pm.role = 'edit'
              )
            )
          )
          or (
            p.share_mode = 'custom'
            and exists (
              select 1
              from public.personal_page_members pm
              where pm.page_id = p.id
                and pm.user_id = auth.uid()
                and pm.role = 'edit'
            )
          )
        )
    )
  );

drop policy if exists personal_note_images_update on storage.objects;
create policy personal_note_images_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'personal-note-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  )
  with check (
    bucket_id = 'personal-note-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  );

drop policy if exists personal_note_images_delete on storage.objects;
create policy personal_note_images_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'personal-note-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  );
