-- Patch notification triggers to respect user_notification_preferences.
-- Apply after `sql/user_notification_preferences.sql`.

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
  allow_assigned boolean := true;
  allow_updated boolean := true;
begin
  if tg_op = 'INSERT' then
    recipient_id := new.assignee_user_id;
    if recipient_id is null then
      return new;
    end if;

    select coalesce(p.task_assigned, true)
      into allow_assigned
    from public.user_notification_preferences p
    where p.user_id = recipient_id;

    if allow_assigned then
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
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    recipient_id := new.assignee_user_id;
    if recipient_id is null then
      return new;
    end if;

    -- Assignee changed: notify only the new assignee.
    if new.assignee_user_id is distinct from old.assignee_user_id then
      select coalesce(p.task_assigned, true)
        into allow_assigned
      from public.user_notification_preferences p
      where p.user_id = recipient_id;

      if allow_assigned then
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
      end if;

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
      select coalesce(p.task_updated, true)
        into allow_updated
      from public.user_notification_preferences p
      where p.user_id = recipient_id;

      if allow_updated then
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
    end if;

    return new;
  end if;

  return new;
end;
$$;

create or replace function public.handle_feature_suggestion_comment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  recipient_id uuid;
  suggestion_title text;
  allow_comment boolean := true;
begin
  select fs.created_by, fs.title
    into recipient_id, suggestion_title
  from public.feature_suggestions fs
  where fs.id = new.suggestion_id;

  if recipient_id is null then
    return new;
  end if;

  if actor_id is null or actor_id = recipient_id then
    return new;
  end if;

  select coalesce(p.feature_suggestion_comment, true)
    into allow_comment
  from public.user_notification_preferences p
  where p.user_id = recipient_id;

  if not allow_comment then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    metadata
  ) values (
    recipient_id,
    actor_id,
    'feature_suggestion_comment',
    'New comment on your idea',
    left(coalesce(new.body, ''), 240),
    jsonb_build_object(
      'feature_suggestion_id', new.suggestion_id,
      'feature_suggestion_title', suggestion_title,
      'comment_id', new.id
    )
  );

  return new;
end;
$$;

create or replace function public.handle_feature_suggestion_status_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  recipient_id uuid := new.created_by;
  allow_status boolean := true;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if recipient_id is null then
    return new;
  end if;

  if actor_id is null or actor_id = recipient_id then
    return new;
  end if;

  select coalesce(p.feature_suggestion_status, true)
    into allow_status
  from public.user_notification_preferences p
  where p.user_id = recipient_id;

  if not allow_status then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    metadata
  ) values (
    recipient_id,
    actor_id,
    'feature_suggestion_status',
    'Idea status updated',
    coalesce(new.title, 'Idea'),
    jsonb_build_object(
      'feature_suggestion_id', new.id,
      'feature_suggestion_title', new.title,
      'previous_status', old.status,
      'status', new.status
    )
  );

  return new;
end;
$$;

