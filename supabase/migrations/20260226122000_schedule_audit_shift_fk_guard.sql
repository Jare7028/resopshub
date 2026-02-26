create or replace function public.schedule_log_audit_event(
  p_client_id uuid,
  p_week_id uuid,
  p_shift_id uuid,
  p_action text,
  p_before_json jsonb default '{}'::jsonb,
  p_after_json jsonb default '{}'::jsonb,
  p_metadata_json jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = 'public'
as $$
  insert into public.schedule_audit_events (
    client_id,
    week_id,
    shift_id,
    actor_user_id,
    action,
    before_json,
    after_json,
    metadata_json
  )
  values (
    p_client_id,
    p_week_id,
    (
      select s.id
      from public.schedule_shifts s
      where s.id = p_shift_id
    ),
    public.current_app_user_id(),
    coalesce(nullif(trim(p_action), ''), 'schedule.event'),
    coalesce(p_before_json, '{}'::jsonb),
    coalesce(p_after_json, '{}'::jsonb),
    coalesce(p_metadata_json, '{}'::jsonb)
  );
$$;
