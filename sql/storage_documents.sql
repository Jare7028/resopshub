-- Supabase Storage policies for the "documents" bucket.
-- Files are stored under `${client_id}/...` so we can enforce access via can_access_client().

-- Ensure the bucket exists (run in Supabase SQL editor as an admin).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Ensure authenticated role has privileges (RLS still applies).
grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

-- Allow members of the client (or admins) to view/download documents for that client.
drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select
  on storage.objects
  for select
  to authenticated
  using (
    auth.uid() is not null
    and bucket_id = 'documents'
    and public.can_access_client(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null::uuid
      end
    )
  );

-- Allow members of the client (or admins) to upload into that client's folder.
drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and bucket_id = 'documents'
    and public.can_access_client(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null::uuid
      end
    )
  );

-- Allow deleting/updating only for admins or the original uploader, and only within clients they can access.
drop policy if exists documents_bucket_update on storage.objects;
create policy documents_bucket_update
  on storage.objects
  for update
  to authenticated
  using (
    auth.uid() is not null
    and bucket_id = 'documents'
    and public.can_access_client(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null::uuid
      end
    )
    and (public.is_admin() or owner = auth.uid())
  )
  with check (
    auth.uid() is not null
    and bucket_id = 'documents'
    and public.can_access_client(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null::uuid
      end
    )
    and (public.is_admin() or owner = auth.uid())
  );

drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete
  on storage.objects
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and bucket_id = 'documents'
    and public.can_access_client(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null::uuid
      end
    )
    and (public.is_admin() or owner = auth.uid())
  );
