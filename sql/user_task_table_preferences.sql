-- Persist /tasks table/view preferences per user.
-- Run this after sql/users.sql.

create table if not exists public.user_task_table_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text[] not null default '{}'::text[],
  priority text[] not null default '{}'::text[],
  assignee text[] not null default '{}'::text[],
  due text not null default 'all',
  client text[] not null default '{}'::text[],
  project text[] not null default '{}'::text[],
  hide_completed boolean not null default true,
  include_watching boolean not null default false,
  sort_key text not null default 'created',
  sort_dir text not null default 'desc',
  view_mode text not null default 'table',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_task_table_preferences_due_check
    check (due in ('all', 'overdue', 'next_7', 'none')),
  constraint user_task_table_preferences_sort_dir_check
    check (sort_dir in ('asc', 'desc')),
  constraint user_task_table_preferences_view_mode_check
    check (view_mode in ('table', 'gantt', 'board'))
);

alter table public.user_task_table_preferences enable row level security;

drop policy if exists user_task_table_preferences_select_own on public.user_task_table_preferences;
create policy user_task_table_preferences_select_own
  on public.user_task_table_preferences
  for select
  to authenticated
  using (
    auth.uid() is not null
    and user_id = public.current_app_user_id()
  );

drop policy if exists user_task_table_preferences_insert_own on public.user_task_table_preferences;
create policy user_task_table_preferences_insert_own
  on public.user_task_table_preferences
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and user_id = public.current_app_user_id()
  );

drop policy if exists user_task_table_preferences_update_own on public.user_task_table_preferences;
create policy user_task_table_preferences_update_own
  on public.user_task_table_preferences
  for update
  to authenticated
  using (
    auth.uid() is not null
    and user_id = public.current_app_user_id()
  )
  with check (
    auth.uid() is not null
    and user_id = public.current_app_user_id()
  );

grant select, insert, update on public.user_task_table_preferences to authenticated;

drop trigger if exists set_user_task_table_preferences_updated_at on public.user_task_table_preferences;
create trigger set_user_task_table_preferences_updated_at
before update on public.user_task_table_preferences
for each row execute function public.set_updated_at();
