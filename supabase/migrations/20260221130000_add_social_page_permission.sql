-- Add Social to left-nav page permissions catalog.
insert into public.page_permissions (key, label, nav_href, sort_order)
values ('social', 'Social', '/social', 75)
on conflict (key) do update
set
  label = excluded.label,
  nav_href = excluded.nav_href,
  sort_order = excluded.sort_order,
  updated_at = now();
