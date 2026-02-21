-- Add user avatar support for Settings + Chat + Social.

alter table public.users
  add column if not exists avatar_url text;

alter table public.users
  add column if not exists avatar_storage_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_avatar_url_not_blank'
  ) then
    alter table public.users
      add constraint users_avatar_url_not_blank
      check (avatar_url is null or length(trim(avatar_url)) > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_avatar_storage_path_not_blank'
  ) then
    alter table public.users
      add constraint users_avatar_storage_path_not_blank
      check (avatar_storage_path is null or length(trim(avatar_storage_path)) > 0);
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do update
set public = excluded.public;

grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

drop policy if exists user_avatars_select on storage.objects;
create policy user_avatars_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'user-avatars');

drop policy if exists user_avatars_insert on storage.objects;
create policy user_avatars_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-avatars'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists user_avatars_update on storage.objects;
create policy user_avatars_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'user-avatars'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists user_avatars_delete on storage.objects;
create policy user_avatars_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  );
