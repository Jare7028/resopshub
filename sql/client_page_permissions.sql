-- Per-client page access overrides for client members.
-- Default behavior remains permissive: if no override exists, members can access all client pages.
-- Run after:
--   sql/rls_identity_fix.sql
--   sql/client_users.sql
--   sql/permissions_admin_member.sql

create table if not exists public.client_page_permissions (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  page_key text not null,
  access_level text not null default 'none',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, user_id, page_key),
  constraint client_page_permissions_page_key_check
    check (page_key in ('overview', 'contacts', 'billing', 'projects', 'tasks', 'notes', 'documents', 'requirements', 'kpis')),
  constraint client_page_permissions_access_level_check
    check (access_level in ('none', 'view', 'edit'))
);

drop trigger if exists trg_client_page_permissions_updated_at on public.client_page_permissions;
create trigger trg_client_page_permissions_updated_at
before update on public.client_page_permissions
for each row execute function public.set_updated_at();

create index if not exists idx_client_page_permissions_user_client_page
  on public.client_page_permissions(user_id, client_id, page_key);

create index if not exists idx_client_page_permissions_client_page_access
  on public.client_page_permissions(client_id, page_key, access_level);

create or replace function public.client_page_access_level(client_uuid uuid, p_page_key text)
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  with normalized as (
    select lower(trim(coalesce(p_page_key, ''))) as page_key
  )
  select case
    when auth.uid() is null then 'none'
    when not exists (
      select 1
      from normalized n
      where n.page_key in ('overview', 'contacts', 'billing', 'projects', 'tasks', 'notes', 'documents', 'requirements', 'kpis')
    ) then 'none'
    when public.is_admin() then 'edit'
    when not public.can_access_client(client_uuid) then 'none'
    else coalesce(
      (
        select cpp.access_level
        from public.client_page_permissions cpp
        cross join normalized n
        where cpp.client_id = client_uuid
          and cpp.user_id = public.current_app_user_id()
          and cpp.page_key = n.page_key
        limit 1
      ),
      'edit'
    )
  end;
$$;

create or replace function public.can_view_client_page(client_uuid uuid, p_page_key text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select public.client_page_access_level(client_uuid, p_page_key) in ('view', 'edit');
$$;

create or replace function public.can_edit_client_page(client_uuid uuid, p_page_key text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select public.client_page_access_level(client_uuid, p_page_key) = 'edit';
$$;

create or replace function public.client_page_access_list(client_uuid uuid)
returns table (
  page_key text,
  access_level text
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select pages.page_key, public.client_page_access_level(client_uuid, pages.page_key) as access_level
  from (
    values
      ('overview'),
      ('contacts'),
      ('billing'),
      ('projects'),
      ('tasks'),
      ('notes'),
      ('documents'),
      ('requirements'),
      ('kpis')
  ) as pages(page_key);
$$;

grant execute on function public.client_page_access_level(uuid, text) to anon, authenticated;
grant execute on function public.can_view_client_page(uuid, text) to anon, authenticated;
grant execute on function public.can_edit_client_page(uuid, text) to anon, authenticated;
grant execute on function public.client_page_access_list(uuid) to anon, authenticated;

-- Hook billing helpers into per-client page access.
create or replace function public.can_view_client_billing(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_view_client_page(client_uuid, 'billing');
$$;

create or replace function public.can_edit_client_billing(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_client_page(client_uuid, 'billing');
$$;

grant execute on function public.can_view_client_billing(uuid) to anon, authenticated;
grant execute on function public.can_edit_client_billing(uuid) to anon, authenticated;

alter table public.client_page_permissions enable row level security;

drop policy if exists client_page_permissions_select on public.client_page_permissions;
create policy client_page_permissions_select
  on public.client_page_permissions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or (
        user_id = public.current_app_user_id()
        and public.can_access_client(client_id)
      )
    )
  );

drop policy if exists client_page_permissions_insert on public.client_page_permissions;
create policy client_page_permissions_insert
  on public.client_page_permissions
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists client_page_permissions_update on public.client_page_permissions;
create policy client_page_permissions_update
  on public.client_page_permissions
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists client_page_permissions_delete on public.client_page_permissions;
create policy client_page_permissions_delete
  on public.client_page_permissions
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on table public.client_page_permissions to authenticated;
