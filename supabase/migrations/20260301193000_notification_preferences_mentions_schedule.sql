-- Expand notification preferences to support mentions + schedule controls.
-- Also patch schedule_notify_users to respect schedule_updates.

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  task_assigned boolean not null default true,
  task_updated boolean not null default true,
  task_due_today boolean not null default true,
  task_overdue boolean not null default true,
  feature_suggestion_comment boolean not null default true,
  feature_suggestion_status boolean not null default true,
  mentions_enabled boolean not null default true,
  mention_task boolean not null default true,
  mention_notes boolean not null default true,
  mention_chat boolean not null default true,
  mention_social boolean not null default true,
  mention_feature_suggestion boolean not null default true,
  mention_form_submission boolean not null default true,
  mention_quiz boolean not null default true,
  schedule_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_notification_preferences
  add column if not exists mentions_enabled boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_task boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_notes boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_chat boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_social boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_feature_suggestion boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_form_submission boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists mention_quiz boolean not null default true;
alter table public.user_notification_preferences
  add column if not exists schedule_updates boolean not null default true;

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

create or replace function public.schedule_notify_users(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key_suffix text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  recipient_id uuid;
  dedupe_key text;
  normalized_type text := coalesce(nullif(trim(p_type), ''), 'schedule_update');
  allow_schedule boolean := true;
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  foreach recipient_id in array p_user_ids loop
    if recipient_id is null then
      continue;
    end if;

    allow_schedule := true;
    if to_regclass('public.user_notification_preferences') is not null then
      select coalesce(p.schedule_updates, true)
        into allow_schedule
      from public.user_notification_preferences p
      where p.user_id = recipient_id;
    end if;

    if not coalesce(allow_schedule, true) then
      continue;
    end if;

    dedupe_key := null;
    if p_dedupe_key_suffix is not null and length(trim(p_dedupe_key_suffix)) > 0 then
      dedupe_key := normalized_type || ':' || recipient_id::text || ':' || trim(p_dedupe_key_suffix);
    end if;

    insert into public.notifications (
      user_id,
      actor_user_id,
      type,
      title,
      body,
      metadata,
      dedupe_key
    )
    values (
      recipient_id,
      auth.uid(),
      normalized_type,
      coalesce(nullif(trim(p_title), ''), 'Schedule updated'),
      nullif(trim(coalesce(p_body, '')), ''),
      coalesce(p_metadata, '{}'::jsonb),
      dedupe_key
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end;
$$;
