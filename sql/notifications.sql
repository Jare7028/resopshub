-- In-app notifications for task assignees + due/overdue reminders.
-- Apply this in Supabase SQL editor.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  type text not null,
  task_id uuid references public.tasks (id) on delete set null,
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  -- Optional idempotency key (used for scheduled reminders).
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

create unique index if not exists notifications_user_dedupe_key_unique
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, update on public.notifications to authenticated;

create or replace function public.handle_task_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  recipient_id uuid;
  meaningful_change boolean := false;
begin
  if tg_op = 'INSERT' then
    recipient_id := new.assignee_user_id;
    if recipient_id is null then
      return new;
    end if;

    insert into public.notifications (
      user_id,
      actor_user_id,
      type,
      task_id,
      title,
      body,
      metadata
    ) values (
      recipient_id,
      actor_id,
      'task_assigned',
      new.id,
      'New task assigned',
      new.title,
      jsonb_build_object(
        'status', new.status,
        'priority', new.priority,
        'due_date', new.due_date
      )
    );

    return new;
  end if;

  if tg_op = 'UPDATE' then
    recipient_id := new.assignee_user_id;
    if recipient_id is null then
      return new;
    end if;

    -- Assignee changed: notify only the new assignee.
    if new.assignee_user_id is distinct from old.assignee_user_id then
      insert into public.notifications (
        user_id,
        actor_user_id,
        type,
        task_id,
        title,
        body,
        metadata
      ) values (
        recipient_id,
        actor_id,
        'task_assigned',
        new.id,
        'Task assigned to you',
        new.title,
        jsonb_build_object(
          'previous_assignee_user_id', old.assignee_user_id,
          'status', new.status,
          'priority', new.priority,
          'due_date', new.due_date
        )
      );

      return new;
    end if;

    -- Avoid spam: ignore editor autosaves and other non-meaningful updates.
    meaningful_change :=
      (new.title is distinct from old.title)
      or (new.description is distinct from old.description)
      or (new.status is distinct from old.status)
      or (new.priority is distinct from old.priority)
      or (new.start_date is distinct from old.start_date)
      or (new.due_date is distinct from old.due_date)
      or (new.client_id is distinct from old.client_id)
      or (new.project_id is distinct from old.project_id);

    if meaningful_change then
      insert into public.notifications (
        user_id,
        actor_user_id,
        type,
        task_id,
        title,
        body,
        metadata
      ) values (
        recipient_id,
        actor_id,
        'task_updated',
        new.id,
        'Task updated',
        new.title,
        jsonb_build_object(
          'status', new.status,
          'priority', new.priority,
          'due_date', new.due_date
        )
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_notify_insert on public.tasks;
create trigger tasks_notify_insert
after insert on public.tasks
for each row
execute function public.handle_task_notifications();

drop trigger if exists tasks_notify_update on public.tasks;
create trigger tasks_notify_update
after update on public.tasks
for each row
execute function public.handle_task_notifications();

