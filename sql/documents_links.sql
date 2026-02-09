-- Client documents: support display names and external links (OneDrive, Google Docs, etc.)
-- Also tighten RLS to require client access (via can_access_client).

alter table public.documents
  add column if not exists title text,
  add column if not exists source text not null default 'upload',
  add column if not exists external_url text;

-- Link documents don't have a stored file.
alter table public.documents
  alter column filename drop not null;

alter table public.documents
  alter column storage_path drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_source_check'
  ) then
    alter table public.documents
      add constraint documents_source_check
      check (source in ('upload', 'link'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_source_fields_check'
  ) then
    alter table public.documents
      add constraint documents_source_fields_check
      check (
        (source = 'upload' and filename is not null and storage_path is not null and external_url is null)
        or (source = 'link' and external_url is not null)
      );
  end if;
end $$;

update public.documents
set title = filename
where title is null
  and filename is not null;

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select
  on public.documents
  for select
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists documents_insert on public.documents;
create policy documents_insert
  on public.documents
  for insert
  to authenticated
  with check (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists documents_update on public.documents;
create policy documents_update
  on public.documents
  for update
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)))
  with check (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists documents_delete on public.documents;
create policy documents_delete
  on public.documents
  for delete
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

