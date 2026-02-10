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

alter table public.task_templates enable row level security;
alter table public.project_templates enable row level security;

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

