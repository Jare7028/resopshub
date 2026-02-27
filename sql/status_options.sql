-- Custom task/project statuses for Settings.
-- Apply in Supabase SQL editor.

create table if not exists public.status_options (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('task', 'project')),
  value text not null,
  position integer not null default 0,
  is_visible boolean not null default true,
  counts_as_completed boolean not null default false,
  color_hex text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_options_value_not_blank check (length(trim(value)) > 0),
  constraint status_options_color_hex_check check (
    color_hex is null
    or color_hex ~ '^#[0-9A-Fa-f]{6}$'
  )
);

alter table public.status_options
  drop constraint if exists status_options_entity_type_check;

alter table public.status_options
  add constraint status_options_entity_type_check
  check (entity_type in ('task', 'project', 'feature_suggestion'));

create unique index if not exists status_options_entity_value_uidx
  on public.status_options (entity_type, lower(value));

create index if not exists status_options_entity_position_idx
  on public.status_options (entity_type, position, value);

alter table public.status_options enable row level security;

drop policy if exists status_options_select on public.status_options;
create policy status_options_select
  on public.status_options
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists status_options_insert on public.status_options;
create policy status_options_insert
  on public.status_options
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists status_options_update on public.status_options;
create policy status_options_update
  on public.status_options
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists status_options_delete on public.status_options;
create policy status_options_delete
  on public.status_options
  for delete
  to authenticated
  using (auth.uid() is not null);

grant select, insert, update, delete on public.status_options to authenticated;

-- Allow template statuses to follow the configurable status lists.
alter table public.task_templates
  drop constraint if exists task_templates_status_check;

alter table public.task_template_subtasks
  drop constraint if exists task_template_subtasks_status_check;

alter table public.project_templates
  drop constraint if exists project_templates_status_check;

-- Seed default statuses for feature suggestions.
insert into public.status_options (
  entity_type,
  value,
  position,
  is_visible,
  counts_as_completed,
  color_hex
)
values
  ('feature_suggestion', 'idea', 1, true, false, '#64748b'),
  ('feature_suggestion', 'needs_checking', 2, true, false, '#f59e0b'),
  ('feature_suggestion', 'planned', 3, true, false, '#3b82f6'),
  ('feature_suggestion', 'completed', 4, false, true, '#10b981'),
  ('feature_suggestion', 'rejected', 5, false, true, '#f43f5e')
on conflict (entity_type, lower(value)) do nothing;

update public.status_options s
set
  is_visible = v.is_visible,
  counts_as_completed = v.counts_as_completed,
  color_hex = v.color_hex
from (
  values
    ('feature_suggestion', 'idea', true, false, '#64748b'),
    ('feature_suggestion', 'needs_checking', true, false, '#f59e0b'),
    ('feature_suggestion', 'planned', true, false, '#3b82f6'),
    ('feature_suggestion', 'completed', false, true, '#10b981'),
    ('feature_suggestion', 'rejected', false, true, '#f43f5e')
) as v(entity_type, value, is_visible, counts_as_completed, color_hex)
where s.entity_type = v.entity_type
  and lower(s.value) = lower(v.value);
