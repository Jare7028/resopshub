-- Personal page templates + manual page ordering.
-- Run after sql/personal.sql.

alter table public.personal_pages
  add column if not exists sort_order int not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by section_id
      order by created_at asc, id asc
    ) as next_sort_order
  from public.personal_pages
)
update public.personal_pages p
set sort_order = ranked.next_sort_order
from ranked
where ranked.id = p.id
  and (p.sort_order is null or p.sort_order = 0);

create index if not exists personal_pages_section_sort_order_idx
  on public.personal_pages(section_id, sort_order, created_at);

create table if not exists public.personal_page_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  content jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);

create index if not exists personal_page_templates_owner_id_idx
  on public.personal_page_templates(owner_id, created_at desc);

grant select, insert, update, delete on table public.personal_page_templates to authenticated;

alter table public.personal_page_templates enable row level security;

drop policy if exists personal_page_templates_select on public.personal_page_templates;
create policy personal_page_templates_select
  on public.personal_page_templates
  for select
  using (owner_id = auth.uid());

drop policy if exists personal_page_templates_insert on public.personal_page_templates;
create policy personal_page_templates_insert
  on public.personal_page_templates
  for insert
  with check (owner_id = auth.uid());

drop policy if exists personal_page_templates_update on public.personal_page_templates;
create policy personal_page_templates_update
  on public.personal_page_templates
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists personal_page_templates_delete on public.personal_page_templates;
create policy personal_page_templates_delete
  on public.personal_page_templates
  for delete
  using (owner_id = auth.uid());
