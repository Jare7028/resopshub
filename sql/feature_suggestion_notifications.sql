-- Feature suggestion notifications:
-- Notify the suggestion author when:
-- 1) someone comments on their idea
-- 2) the idea status changes

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

drop trigger if exists feature_suggestion_comments_notify_insert on public.feature_suggestion_comments;
create trigger feature_suggestion_comments_notify_insert
after insert on public.feature_suggestion_comments
for each row
execute function public.handle_feature_suggestion_comment_notifications();

create or replace function public.handle_feature_suggestion_status_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  recipient_id uuid := new.created_by;
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

drop trigger if exists feature_suggestions_notify_status_update on public.feature_suggestions;
create trigger feature_suggestions_notify_status_update
after update of status on public.feature_suggestions
for each row
execute function public.handle_feature_suggestion_status_notifications();

