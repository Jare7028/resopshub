-- Forms, submissions, and post-submission task actions.

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  fields jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_forms_status on public.forms(status);
create index if not exists idx_forms_updated_at on public.forms(updated_at desc);

create table if not exists public.form_submission_actions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  label text not null,
  task_title_template text not null,
  task_description_template text,
  assignee_user_id uuid references public.users(id) on delete set null,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_form_submission_actions_form_id
  on public.form_submission_actions(form_id, position, created_at);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'rejected')),
  values_json jsonb not null default '{}'::jsonb,
  submitted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_form_submissions_form_id
  on public.form_submissions(form_id, created_at desc);
create index if not exists idx_form_submissions_status
  on public.form_submissions(status);

create table if not exists public.form_submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_form_submission_comments_submission_id
  on public.form_submission_comments(submission_id, created_at);

create table if not exists public.form_submission_action_tasks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  action_id uuid not null references public.form_submission_actions(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (submission_id, action_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_forms_updated_at on public.forms;
create trigger trg_forms_updated_at
before update on public.forms
for each row execute function public.set_updated_at();

drop trigger if exists trg_form_submission_actions_updated_at on public.form_submission_actions;
create trigger trg_form_submission_actions_updated_at
before update on public.form_submission_actions
for each row execute function public.set_updated_at();

drop trigger if exists trg_form_submissions_updated_at on public.form_submissions;
create trigger trg_form_submissions_updated_at
before update on public.form_submissions
for each row execute function public.set_updated_at();

alter table public.forms enable row level security;
alter table public.form_submission_actions enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_submission_comments enable row level security;
alter table public.form_submission_action_tasks enable row level security;

drop policy if exists forms_select on public.forms;
create policy forms_select
  on public.forms
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists forms_insert on public.forms;
create policy forms_insert
  on public.forms
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists forms_update on public.forms;
create policy forms_update
  on public.forms
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists forms_delete on public.forms;
create policy forms_delete
  on public.forms
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_actions_select on public.form_submission_actions;
create policy form_submission_actions_select
  on public.form_submission_actions
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_actions_insert on public.form_submission_actions;
create policy form_submission_actions_insert
  on public.form_submission_actions
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submission_actions_update on public.form_submission_actions;
create policy form_submission_actions_update
  on public.form_submission_actions
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists form_submission_actions_delete on public.form_submission_actions;
create policy form_submission_actions_delete
  on public.form_submission_actions
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select
  on public.form_submissions
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert
  on public.form_submissions
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submissions_update on public.form_submissions;
create policy form_submissions_update
  on public.form_submissions
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists form_submissions_delete on public.form_submissions;
create policy form_submissions_delete
  on public.form_submissions
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_comments_select on public.form_submission_comments;
create policy form_submission_comments_select
  on public.form_submission_comments
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_comments_insert on public.form_submission_comments;
create policy form_submission_comments_insert
  on public.form_submission_comments
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submission_comments_update on public.form_submission_comments;
create policy form_submission_comments_update
  on public.form_submission_comments
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists form_submission_comments_delete on public.form_submission_comments;
create policy form_submission_comments_delete
  on public.form_submission_comments
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_action_tasks_select on public.form_submission_action_tasks;
create policy form_submission_action_tasks_select
  on public.form_submission_action_tasks
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists form_submission_action_tasks_insert on public.form_submission_action_tasks;
create policy form_submission_action_tasks_insert
  on public.form_submission_action_tasks
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists form_submission_action_tasks_delete on public.form_submission_action_tasks;
create policy form_submission_action_tasks_delete
  on public.form_submission_action_tasks
  for delete
  to authenticated
  using (auth.uid() is not null);
