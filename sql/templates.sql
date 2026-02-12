-- Task/Project templates (company-wide).
-- Apply in Supabase SQL editor.

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null,
  description text,
  status text not null default 'to_do',
  priority text not null default 'medium',
  due_time time,
  recurrence_frequency text,
  recurrence_lead_days int not null default 7,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_templates_status_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_status_check
      check (status in ('to_do','in_progress','blocked','completed','cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_templates_priority_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_priority_check
      check (priority in ('low','medium','high','critical'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_templates_recurrence_frequency_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_recurrence_frequency_check
      check (
        recurrence_frequency is null
        or recurrence_frequency in ('daily','weekly','monthly','yearly')
      );
  end if;
end $$;

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'planned',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_templates_status_check'
  ) then
    alter table public.project_templates
      add constraint project_templates_status_check
      check (status in ('planned','active','on_hold','completed','cancelled'));
  end if;
end $$;

-- Subtasks that belong to a task template.
create table if not exists public.task_template_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  position int not null default 1,
  title text not null,
  description text,
  status text not null default 'to_do',
  priority text not null default 'medium',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_template_subtasks_position_check'
  ) then
    alter table public.task_template_subtasks
      add constraint task_template_subtasks_position_check
      check (position > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_template_subtasks_status_check'
  ) then
    alter table public.task_template_subtasks
      add constraint task_template_subtasks_status_check
      check (status in ('to_do','in_progress','blocked','completed','cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_template_subtasks_priority_check'
  ) then
    alter table public.task_template_subtasks
      add constraint task_template_subtasks_priority_check
      check (priority in ('low','medium','high','critical'));
  end if;
end $$;

create index if not exists task_template_subtasks_template_id_position_idx
  on public.task_template_subtasks (task_template_id, position);

-- Default assignees for a task template.
create table if not exists public.task_template_assignees (
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_template_id, user_id)
);

create index if not exists task_template_assignees_user_id_idx
  on public.task_template_assignees (user_id);

-- Default assignees for task template subtasks.
create table if not exists public.task_template_subtask_assignees (
  task_template_subtask_id uuid not null references public.task_template_subtasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_template_subtask_id, user_id)
);

create index if not exists task_template_subtask_assignees_user_id_idx
  on public.task_template_subtask_assignees (user_id);

-- Task templates included in a project template (ordered).
create table if not exists public.project_template_tasks (
  id uuid primary key default gen_random_uuid(),
  project_template_id uuid not null references public.project_templates(id) on delete cascade,
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  position int not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_template_id, task_template_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_template_tasks_position_check'
  ) then
    alter table public.project_template_tasks
      add constraint project_template_tasks_position_check
      check (position > 0);
  end if;
end $$;

create index if not exists project_template_tasks_project_id_position_idx
  on public.project_template_tasks (project_template_id, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists task_templates_set_updated_at on public.task_templates;
create trigger task_templates_set_updated_at
before update on public.task_templates
for each row execute function public.set_updated_at();

drop trigger if exists project_templates_set_updated_at on public.project_templates;
create trigger project_templates_set_updated_at
before update on public.project_templates
for each row execute function public.set_updated_at();

drop trigger if exists task_template_subtasks_set_updated_at on public.task_template_subtasks;
create trigger task_template_subtasks_set_updated_at
before update on public.task_template_subtasks
for each row execute function public.set_updated_at();

drop trigger if exists project_template_tasks_set_updated_at on public.project_template_tasks;
create trigger project_template_tasks_set_updated_at
before update on public.project_template_tasks
for each row execute function public.set_updated_at();

-- Ensure authenticated role has privileges (RLS still applies).
grant select, insert, update, delete on table public.task_templates to authenticated;
grant select, insert, update, delete on table public.project_templates to authenticated;
grant select, insert, update, delete on table public.task_template_subtasks to authenticated;
grant select, insert, update, delete on table public.task_template_assignees to authenticated;
grant select, insert, update, delete on table public.task_template_subtask_assignees to authenticated;
grant select, insert, update, delete on table public.project_template_tasks to authenticated;

alter table public.task_templates enable row level security;
alter table public.project_templates enable row level security;
alter table public.task_template_subtasks enable row level security;
alter table public.task_template_assignees enable row level security;
alter table public.task_template_subtask_assignees enable row level security;
alter table public.project_template_tasks enable row level security;

-- Company-wide templates; any authenticated user can manage them.
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select
  on public.task_templates
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_templates_insert on public.task_templates;
create policy task_templates_insert
  on public.task_templates
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists task_templates_update on public.task_templates;
create policy task_templates_update
  on public.task_templates
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists task_templates_delete on public.task_templates;
create policy task_templates_delete
  on public.task_templates
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select
  on public.project_templates
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists project_templates_insert on public.project_templates;
create policy project_templates_insert
  on public.project_templates
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists project_templates_update on public.project_templates;
create policy project_templates_update
  on public.project_templates
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists project_templates_delete on public.project_templates;
create policy project_templates_delete
  on public.project_templates
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_subtasks_select on public.task_template_subtasks;
create policy task_template_subtasks_select
  on public.task_template_subtasks
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_subtasks_insert on public.task_template_subtasks;
create policy task_template_subtasks_insert
  on public.task_template_subtasks
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists task_template_subtasks_update on public.task_template_subtasks;
create policy task_template_subtasks_update
  on public.task_template_subtasks
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists task_template_subtasks_delete on public.task_template_subtasks;
create policy task_template_subtasks_delete
  on public.task_template_subtasks
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_assignees_select on public.task_template_assignees;
create policy task_template_assignees_select
  on public.task_template_assignees
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_assignees_insert on public.task_template_assignees;
create policy task_template_assignees_insert
  on public.task_template_assignees
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists task_template_assignees_update on public.task_template_assignees;
create policy task_template_assignees_update
  on public.task_template_assignees
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists task_template_assignees_delete on public.task_template_assignees;
create policy task_template_assignees_delete
  on public.task_template_assignees
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_subtask_assignees_select on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_select
  on public.task_template_subtask_assignees
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists task_template_subtask_assignees_insert on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_insert
  on public.task_template_subtask_assignees
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists task_template_subtask_assignees_update on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_update
  on public.task_template_subtask_assignees
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists task_template_subtask_assignees_delete on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_delete
  on public.task_template_subtask_assignees
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists project_template_tasks_select on public.project_template_tasks;
create policy project_template_tasks_select
  on public.project_template_tasks
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists project_template_tasks_insert on public.project_template_tasks;
create policy project_template_tasks_insert
  on public.project_template_tasks
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists project_template_tasks_update on public.project_template_tasks;
create policy project_template_tasks_update
  on public.project_template_tasks
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists project_template_tasks_delete on public.project_template_tasks;
create policy project_template_tasks_delete
  on public.project_template_tasks
  for delete
  to authenticated
  using (auth.uid() is not null);
