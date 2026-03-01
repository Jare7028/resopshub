-- User notification preferences (in-app only for now).
-- Apply in Supabase SQL editor.

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,

  -- Task notifications (for the assignee, today).
  task_assigned boolean not null default true,
  task_updated boolean not null default true,
  task_due_today boolean not null default true,
  task_overdue boolean not null default true,

  -- Feature suggestions (author).
  feature_suggestion_comment boolean not null default true,
  feature_suggestion_status boolean not null default true,

  -- Mention notifications (recipient).
  mentions_enabled boolean not null default true,
  mention_task boolean not null default true,
  mention_notes boolean not null default true,
  mention_chat boolean not null default true,
  mention_social boolean not null default true,
  mention_feature_suggestion boolean not null default true,
  mention_form_submission boolean not null default true,
  mention_quiz boolean not null default true,

  -- Schedule updates.
  schedule_updates boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_notification_preferences enable row level security;

drop policy if exists user_notification_preferences_select_own on public.user_notification_preferences;
create policy user_notification_preferences_select_own
  on public.user_notification_preferences
  for select
  using (auth.uid() = user_id);

drop policy if exists user_notification_preferences_insert_own on public.user_notification_preferences;
create policy user_notification_preferences_insert_own
  on public.user_notification_preferences
  for insert
  with check (auth.uid() = user_id);

drop policy if exists user_notification_preferences_update_own on public.user_notification_preferences;
create policy user_notification_preferences_update_own
  on public.user_notification_preferences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_notification_preferences to authenticated;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_user_notification_preferences_updated_at on public.user_notification_preferences;
create trigger set_user_notification_preferences_updated_at
before update on public.user_notification_preferences
for each row
execute function public.set_updated_at();
