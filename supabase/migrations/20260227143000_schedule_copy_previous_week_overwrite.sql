-- Copying previous week should replace current week shifts instead of merging.

create or replace function public.schedule_copy_previous_week(p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_week public.schedule_weeks%rowtype;
  previous_week public.schedule_weeks%rowtype;
  day_offset integer;
  inserted_count integer := 0;
  overwritten_count integer := 0;
  warning_messages text[] := '{}'::text[];
  row_shift record;
begin
  select *
  into target_week
  from public.schedule_weeks
  where id = p_week_id
  limit 1;

  if target_week.id is null then
    raise exception 'Week not found';
  end if;

  if not public.schedule_can_edit_client(target_week.client_id) then
    raise exception 'Not authorized to copy shifts';
  end if;

  select *
  into previous_week
  from public.schedule_weeks
  where client_id = target_week.client_id
    and week_start_date = target_week.week_start_date - 7
  limit 1;

  if previous_week.id is null then
    return jsonb_build_object('inserted', 0, 'overwritten', 0, 'warnings', jsonb_build_array('No previous week found'));
  end if;

  select count(*)
  into overwritten_count
  from public.schedule_shifts s
  where s.week_id = target_week.id;

  delete from public.schedule_shifts
  where week_id = target_week.id;

  day_offset := target_week.week_start_date - previous_week.week_start_date;

  for row_shift in
    select
      s.*,
      r.active as roster_active,
      r.display_name as roster_name
    from public.schedule_shifts s
    left join public.schedule_roster_entries r on r.id = s.roster_entry_id
    where s.week_id = previous_week.id
    order by s.local_date, s.start_local_time, s.created_at
  loop
    begin
      if row_shift.is_open then
        insert into public.schedule_shifts (
          week_id, client_id, roster_entry_id, assignee_user_id, is_open,
          local_date, start_local_time, end_local_time, ends_next_day,
          break_minutes, job_code_id, notes, start_at, end_at
        ) values (
          target_week.id, target_week.client_id, null, null, true,
          row_shift.local_date + day_offset,
          row_shift.start_local_time,
          row_shift.end_local_time,
          row_shift.ends_next_day,
          row_shift.break_minutes,
          row_shift.job_code_id,
          row_shift.notes,
          now(),
          now() + interval '1 minute'
        );
        inserted_count := inserted_count + 1;
      else
        if row_shift.roster_entry_id is null then
          warning_messages := array_append(warning_messages, 'Skipped shift with missing assignee on ' || row_shift.local_date::text);
          continue;
        end if;
        if row_shift.roster_active is not true then
          warning_messages := array_append(warning_messages, 'Skipped shift for inactive employee ' || coalesce(row_shift.roster_name, '(unknown)'));
          continue;
        end if;

        insert into public.schedule_shifts (
          week_id, client_id, roster_entry_id, is_open,
          local_date, start_local_time, end_local_time, ends_next_day,
          break_minutes, job_code_id, notes, start_at, end_at
        ) values (
          target_week.id,
          target_week.client_id,
          row_shift.roster_entry_id,
          false,
          row_shift.local_date + day_offset,
          row_shift.start_local_time,
          row_shift.end_local_time,
          row_shift.ends_next_day,
          row_shift.break_minutes,
          row_shift.job_code_id,
          row_shift.notes,
          now(),
          now() + interval '1 minute'
        );
        inserted_count := inserted_count + 1;
      end if;
    exception
      when exclusion_violation then
        warning_messages := array_append(
          warning_messages,
          'Skipped overlapping shift for ' || coalesce(row_shift.roster_name, '(employee)')
        );
      when others then
        warning_messages := array_append(
          warning_messages,
          'Skipped shift: ' || SQLERRM
        );
    end;
  end loop;

  perform public.schedule_log_audit_event(
    target_week.client_id,
    target_week.id,
    null,
    'week.copied_previous',
    jsonb_build_object('overwritten', overwritten_count),
    jsonb_build_object(
      'inserted',
      inserted_count,
      'overwritten',
      overwritten_count,
      'warning_count',
      coalesce(array_length(warning_messages, 1), 0)
    ),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'inserted', inserted_count,
    'overwritten', overwritten_count,
    'warnings', to_jsonb(coalesce(warning_messages, '{}'::text[]))
  );
end;
$$;
