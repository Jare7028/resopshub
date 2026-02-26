create or replace function public.schedule_delete_shift(p_shift_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  shift_row public.schedule_shifts%rowtype;
  week_row public.schedule_weeks%rowtype;
  route_path text;
  deleted_rows jsonb := '[]'::jsonb;
  deleted_assignees uuid[] := '{}'::uuid[];
begin
  select *
  into shift_row
  from public.schedule_shifts
  where id = p_shift_id
  for update;

  if shift_row.id is null then
    return false;
  end if;

  select *
  into week_row
  from public.schedule_weeks
  where id = shift_row.week_id
  limit 1;

  if week_row.id is null then
    return false;
  end if;

  if not public.schedule_can_edit_client(week_row.client_id) then
    raise exception 'Not authorized to delete shifts';
  end if;

  if shift_row.split_group_id is not null then
    select
      coalesce(jsonb_agg(to_jsonb(s) order by s.split_part, s.local_date, s.start_local_time), '[]'::jsonb),
      coalesce(array_agg(distinct s.assignee_user_id) filter (where s.assignee_user_id is not null), '{}'::uuid[])
    into deleted_rows, deleted_assignees
    from public.schedule_shifts s
    where s.split_group_id = shift_row.split_group_id;
  else
    deleted_rows := jsonb_build_array(to_jsonb(shift_row));
    if shift_row.assignee_user_id is not null then
      deleted_assignees := array[shift_row.assignee_user_id];
    end if;
  end if;

  -- Log before delete so older audit helper versions cannot violate shift FK.
  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    shift_row.id,
    'shift.deleted',
    jsonb_build_object('deleted', deleted_rows),
    '{}'::jsonb,
    jsonb_build_object('split_group_id', shift_row.split_group_id)
  );

  if shift_row.split_group_id is not null then
    delete from public.schedule_shifts
    where split_group_id = shift_row.split_group_id;
  else
    delete from public.schedule_shifts
    where id = shift_row.id;
  end if;

  if week_row.status = 'published' and array_length(deleted_assignees, 1) is not null then
    route_path := '/schedules/' || week_row.client_id::text || '?week=' || week_row.week_start_date::text;
    perform public.schedule_notify_users(
      deleted_assignees,
      'schedule_shift_deleted',
      'Published shift removed',
      'A published shift was removed from your schedule.',
      jsonb_build_object('source_url', route_path, 'schedule_shift_id', shift_row.id),
      coalesce(shift_row.split_group_id::text, shift_row.id::text) || ':deleted:' || week_row.published_version::text
    );
  end if;

  return true;
end;
$$;
