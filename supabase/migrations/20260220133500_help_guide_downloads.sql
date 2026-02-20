-- Public storage bucket for help guide downloadable files (manifest, zip, etc.).
insert into storage.buckets (id, name, public)
values ('help-guide-downloads', 'help-guide-downloads', true)
on conflict (id) do update
set public = excluded.public;

grant select on table storage.objects to anon, authenticated;
grant select on table storage.buckets to anon, authenticated;
