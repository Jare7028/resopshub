-- Custom task/project statuses for Settings.
-- Apply in Supabase SQL editor.

create table if not exists public.status_options (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('task', 'project')),
  value text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_options_value_not_blank check (length(trim(value)) > 0)
);

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
