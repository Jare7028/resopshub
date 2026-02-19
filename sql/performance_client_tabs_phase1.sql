-- Performance optimizations for client tab navigation and list rendering.
-- Run after:
--   sql/performance_clients_employee_info.sql
--   sql/performance_indexes_notes_tasks_personal.sql

-- 1) Speed up common client project list sort.
create index if not exists idx_projects_client_created_at
  on public.projects(client_id, created_at desc);

-- 2) Speed up legacy/fallback notes ordering.
create index if not exists idx_notes_client_created_at
  on public.notes(client_id, created_at desc);

-- 3) Rewrite tab access list to compute access context once.
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
  with pages(page_key) as (
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
  ),
  ctx as (
    select
      auth.uid() as auth_uid,
      public.current_app_user_id() as app_user_id,
      public.is_admin() as is_admin
  ),
  base as (
    select
      case
        when ctx.auth_uid is null then 'none'
        when ctx.is_admin then 'edit'
        when not public.can_access_client(client_uuid) then 'none'
        else 'edit'
      end as base_access,
      ctx.app_user_id
    from ctx
  ),
  overrides as (
    select cpp.page_key, cpp.access_level
    from public.client_page_permissions cpp
    cross join base b
    where cpp.client_id = client_uuid
      and cpp.user_id = b.app_user_id
  )
  select
    p.page_key,
    case
      when b.base_access = 'none' then 'none'
      else coalesce(o.access_level, b.base_access)
    end as access_level
  from pages p
  cross join base b
  left join overrides o on o.page_key = p.page_key;
$$;

grant execute on function public.client_page_access_list(uuid) to anon, authenticated;
