-- Add Schedules to page-level permissions catalog.
insert into public.page_permissions (key, label, nav_href, sort_order)
values ('schedules', 'Schedules', '/schedules', 57)
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
  'schedules',
  'edit',
  null::uuid
from public.users u
where u.role::text = 'member'
on conflict (user_id, page_key) do nothing;
