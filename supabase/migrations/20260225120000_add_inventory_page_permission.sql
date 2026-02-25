-- Add Inventory to page-level permissions and give it dedicated access helpers.
insert into public.page_permissions (key, label, nav_href, sort_order)
values ('inventory', 'Inventory', '/inventory', 55)
on conflict (key) do update
set
  label = excluded.label,
  nav_href = excluded.nav_href,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Backfill explicit defaults for existing members (effective default is already edit).
insert into public.user_page_permissions (
  user_id,
  page_key,
  access_level,
  updated_by_user_id
)
select
  u.id,
  'inventory',
  'edit',
  null::uuid
from public.users u
where u.role::text = 'member'
on conflict (user_id, page_key) do nothing;

create or replace function public.can_access_inventory()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_view_page('inventory');
$$;

grant execute on function public.can_access_inventory() to anon, authenticated;

create or replace function public.can_manage_inventory_columns()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_edit_page('inventory');
$$;

grant execute on function public.can_manage_inventory_columns() to anon, authenticated;
