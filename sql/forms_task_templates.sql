-- Form task-template automations.
-- Run after sql/forms.sql and sql/templates.sql.

create table if not exists public.form_submission_task_templates (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (form_id, task_template_id)
);

create index if not exists idx_form_submission_task_templates_form_id
  on public.form_submission_task_templates(form_id, position, created_at);

create table if not exists public.form_submission_template_tasks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_form_submission_template_tasks_submission_id
  on public.form_submission_template_tasks(submission_id, created_at);

drop trigger if exists trg_form_submission_task_templates_updated_at on public.form_submission_task_templates;
create trigger trg_form_submission_task_templates_updated_at
before update on public.form_submission_task_templates
for each row execute function public.set_updated_at();

alter table public.form_submission_task_templates enable row level security;
alter table public.form_submission_template_tasks enable row level security;

drop policy if exists form_submission_task_templates_select on public.form_submission_task_templates;
create policy form_submission_task_templates_select
  on public.form_submission_task_templates
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_task_templates_insert on public.form_submission_task_templates;
create policy form_submission_task_templates_insert
  on public.form_submission_task_templates
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submission_task_templates_update on public.form_submission_task_templates;
create policy form_submission_task_templates_update
  on public.form_submission_task_templates
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists form_submission_task_templates_delete on public.form_submission_task_templates;
create policy form_submission_task_templates_delete
  on public.form_submission_task_templates
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_template_tasks_select on public.form_submission_template_tasks;
create policy form_submission_template_tasks_select
  on public.form_submission_template_tasks
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_template_tasks_insert on public.form_submission_template_tasks;
create policy form_submission_template_tasks_insert
  on public.form_submission_template_tasks
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submission_template_tasks_delete on public.form_submission_template_tasks;
create policy form_submission_template_tasks_delete
  on public.form_submission_template_tasks
  for delete
  to authenticated
  using (auth.uid() is not null);

