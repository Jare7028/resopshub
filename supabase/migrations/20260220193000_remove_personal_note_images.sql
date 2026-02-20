-- Remove personal note image storage bucket and policies.
-- Safe to run multiple times.

drop policy if exists personal_note_images_insert on storage.objects;
drop policy if exists personal_note_images_update on storage.objects;
drop policy if exists personal_note_images_delete on storage.objects;

update storage.buckets
set public = false
where id = 'personal-note-images';

do $$
begin
  delete from storage.buckets
  where id = 'personal-note-images';
exception
  when others then
    null;
end
$$;
