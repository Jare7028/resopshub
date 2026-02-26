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
  v_dedupe_key text;
  normalized_type text := coalesce(nullif(trim(p_type), ''), 'schedule_update');
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

    v_dedupe_key := null;
    if p_dedupe_key_suffix is not null and length(trim(p_dedupe_key_suffix)) > 0 then
      v_dedupe_key := normalized_type || ':' || recipient_id::text || ':' || trim(p_dedupe_key_suffix);
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
      v_dedupe_key
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end;
$$;
