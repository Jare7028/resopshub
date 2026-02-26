-- Auto-split overnight shifts into two records:
--   Day 1: start -> 00:00 (ends_next_day=true)
--   Day 2: 00:00 -> end (ends_next_day=false)
-- Also keep split parts linked so updates/deletes can manage both rows.

alter table if exists public.schedule_shifts
  add column if not exists split_group_id uuid,
  add column if not exists split_part smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_shifts_split_part_check'
      and conrelid = 'public.schedule_shifts'::regclass
  ) then
    alter table public.schedule_shifts
      add constraint schedule_shifts_split_part_check
      check (split_part in (1, 2));
  end if;
end
$$;

create index if not exists schedule_shifts_split_group_idx
  on public.schedule_shifts(split_group_id)
  where split_group_id is not null;

create unique index if not exists schedule_shifts_split_group_part_unique
  on public.schedule_shifts(split_group_id, split_part)
  where split_group_id is not null;

create or replace function public.schedule_upsert_shift(
  p_week_id uuid,
  p_shift_id uuid default null,
  p_roster_entry_id uuid default null,
  p_is_open boolean default false,
  p_local_date date default null,
  p_start_local_time time default null,
  p_end_local_time time default null,
  p_ends_next_day boolean default false,
  p_break_minutes integer default 0,
  p_job_code_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  old_shift public.schedule_shifts%rowtype;
  part1_old public.schedule_shifts%rowtype;
  part2_old public.schedule_shifts%rowtype;
  part1_new public.schedule_shifts%rowtype;
  part2_new public.schedule_shifts%rowtype;
  shift_id uuid;
  split_group uuid;
  route_path text;
  total_break integer := coalesce(p_break_minutes, 0);
  break_first integer := 0;
  break_second integer := 0;
  first_duration_minutes integer := 0;
  second_duration_minutes integer := 0;
  is_overnight boolean := false;
  end_is_midnight boolean := false;
begin
  select *
  into week_row
  from public.schedule_weeks
  where id = p_week_id
  limit 1;

  if week_row.id is null then
    raise exception 'Schedule week not found';
  end if;

  if not public.schedule_can_edit_client(week_row.client_id) then
    raise exception 'Not authorized to edit this schedule';
  end if;

  if p_local_date is null then
    raise exception 'Shift date is required';
  end if;
  if p_start_local_time is null then
    raise exception 'Shift start time is required';
  end if;
  if p_end_local_time is null then
    raise exception 'Shift end time is required';
  end if;
  if total_break < 0 then
    raise exception 'Break minutes cannot be negative';
  end if;

  is_overnight := coalesce(p_ends_next_day, false) or p_end_local_time <= p_start_local_time;
  end_is_midnight := (p_end_local_time = time '00:00');

  if is_overnight then
    first_duration_minutes := floor(
      extract(
        epoch
        from (((p_local_date + 1)::text || ' 00:00:00')::timestamp - ((p_local_date::text || ' ' || p_start_local_time::text)::timestamp))
      ) / 60.0
    );
    if first_duration_minutes <= 0 then
      raise exception 'Overnight shift must start before midnight';
    end if;

    if end_is_midnight then
      second_duration_minutes := 0;
      if total_break >= first_duration_minutes then
        raise exception 'Break minutes must be less than shift duration';
      end if;
      break_first := total_break;
      break_second := 0;
    else
      second_duration_minutes := floor(extract(epoch from p_end_local_time) / 60.0);
      if second_duration_minutes <= 0 then
        raise exception 'Overnight split requires a valid next-day end time';
      end if;

      break_first := least(total_break, greatest(first_duration_minutes - 1, 0));
      break_second := total_break - break_first;

      if break_second >= second_duration_minutes then
        raise exception 'Break minutes too large to split overnight shift';
      end if;
    end if;
  else
    break_first := total_break;
    break_second := 0;
  end if;

  part1_old.id := null;
  part2_old.id := null;

  if p_shift_id is null then
    if is_overnight and not end_is_midnight then
      split_group := gen_random_uuid();

      insert into public.schedule_shifts (
        week_id,
        client_id,
        roster_entry_id,
        is_open,
        local_date,
        start_local_time,
        end_local_time,
        ends_next_day,
        break_minutes,
        job_code_id,
        notes,
        start_at,
        end_at,
        split_group_id,
        split_part
      )
      values (
        week_row.id,
        week_row.client_id,
        case when p_is_open then null else p_roster_entry_id end,
        coalesce(p_is_open, false),
        p_local_date,
        p_start_local_time,
        time '00:00',
        true,
        break_first,
        p_job_code_id,
        nullif(trim(coalesce(p_notes, '')), ''),
        now(),
        now() + interval '1 minute',
        split_group,
        1
      )
      returning id into shift_id;

      insert into public.schedule_shifts (
        week_id,
        client_id,
        roster_entry_id,
        is_open,
        local_date,
        start_local_time,
        end_local_time,
        ends_next_day,
        break_minutes,
        job_code_id,
        notes,
        start_at,
        end_at,
        split_group_id,
        split_part
      )
      values (
        week_row.id,
        week_row.client_id,
        case when p_is_open then null else p_roster_entry_id end,
        coalesce(p_is_open, false),
        p_local_date + 1,
        time '00:00',
        p_end_local_time,
        false,
        break_second,
        p_job_code_id,
        nullif(trim(coalesce(p_notes, '')), ''),
        now(),
        now() + interval '1 minute',
        split_group,
        2
      );
    else
      insert into public.schedule_shifts (
        week_id,
        client_id,
        roster_entry_id,
        is_open,
        local_date,
        start_local_time,
        end_local_time,
        ends_next_day,
        break_minutes,
        job_code_id,
        notes,
        start_at,
        end_at,
        split_group_id,
        split_part
      )
      values (
        week_row.id,
        week_row.client_id,
        case when p_is_open then null else p_roster_entry_id end,
        coalesce(p_is_open, false),
        p_local_date,
        p_start_local_time,
        p_end_local_time,
        coalesce(p_ends_next_day, false),
        break_first,
        p_job_code_id,
        nullif(trim(coalesce(p_notes, '')), ''),
        now(),
        now() + interval '1 minute',
        null,
        1
      )
      returning id into shift_id;
    end if;
  else
    select *
    into old_shift
    from public.schedule_shifts
    where id = p_shift_id
      and week_id = week_row.id
    for update;

    if old_shift.id is null then
      raise exception 'Shift not found for this week';
    end if;

    if old_shift.split_group_id is not null then
      select *
      into part1_old
      from public.schedule_shifts
      where split_group_id = old_shift.split_group_id
        and split_part = 1
      for update;

      if part1_old.id is null then
        part1_old := old_shift;
      end if;

      select *
      into part2_old
      from public.schedule_shifts
      where split_group_id = old_shift.split_group_id
        and split_part = 2
      for update;
    else
      part1_old := old_shift;
    end if;

    if is_overnight and not end_is_midnight then
      split_group := coalesce(part1_old.split_group_id, gen_random_uuid());

      update public.schedule_shifts s
      set
        roster_entry_id = case when p_is_open then null else p_roster_entry_id end,
        is_open = coalesce(p_is_open, false),
        local_date = p_local_date,
        start_local_time = p_start_local_time,
        end_local_time = time '00:00',
        ends_next_day = true,
        break_minutes = break_first,
        job_code_id = p_job_code_id,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        split_group_id = split_group,
        split_part = 1,
        updated_at = now()
      where s.id = part1_old.id;

      if part2_old.id is null then
        insert into public.schedule_shifts (
          week_id,
          client_id,
          roster_entry_id,
          is_open,
          local_date,
          start_local_time,
          end_local_time,
          ends_next_day,
          break_minutes,
          job_code_id,
          notes,
          start_at,
          end_at,
          split_group_id,
          split_part
        )
        values (
          week_row.id,
          week_row.client_id,
          case when p_is_open then null else p_roster_entry_id end,
          coalesce(p_is_open, false),
          p_local_date + 1,
          time '00:00',
          p_end_local_time,
          false,
          break_second,
          p_job_code_id,
          nullif(trim(coalesce(p_notes, '')), ''),
          now(),
          now() + interval '1 minute',
          split_group,
          2
        );
      else
        update public.schedule_shifts s
        set
          roster_entry_id = case when p_is_open then null else p_roster_entry_id end,
          is_open = coalesce(p_is_open, false),
          local_date = p_local_date + 1,
          start_local_time = time '00:00',
          end_local_time = p_end_local_time,
          ends_next_day = false,
          break_minutes = break_second,
          job_code_id = p_job_code_id,
          notes = nullif(trim(coalesce(p_notes, '')), ''),
          split_group_id = split_group,
          split_part = 2,
          updated_at = now()
        where s.id = part2_old.id;
      end if;

      shift_id := part1_old.id;
    else
      update public.schedule_shifts s
      set
        roster_entry_id = case when p_is_open then null else p_roster_entry_id end,
        is_open = coalesce(p_is_open, false),
        local_date = p_local_date,
        start_local_time = p_start_local_time,
        end_local_time = p_end_local_time,
        ends_next_day = coalesce(p_ends_next_day, false),
        break_minutes = break_first,
        job_code_id = p_job_code_id,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        split_group_id = null,
        split_part = 1,
        updated_at = now()
      where s.id = part1_old.id;

      if part2_old.id is not null then
        delete from public.schedule_shifts
        where id = part2_old.id;
      end if;

      shift_id := part1_old.id;
    end if;
  end if;

  select *
  into part1_new
  from public.schedule_shifts
  where id = shift_id
  limit 1;

  if part1_new.split_group_id is not null then
    select *
    into part2_new
    from public.schedule_shifts
    where split_group_id = part1_new.split_group_id
      and split_part = 2
    limit 1;
  end if;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    part1_new.id,
    case when p_shift_id is null then 'shift.created' else 'shift.updated' end,
    jsonb_build_object(
      'part1', case when part1_old.id is null then null else to_jsonb(part1_old) end,
      'part2', case when part2_old.id is null then null else to_jsonb(part2_old) end
    ),
    jsonb_build_object(
      'part1', to_jsonb(part1_new),
      'part2', case when part2_new.id is null then null else to_jsonb(part2_new) end
    ),
    '{}'::jsonb
  );

  if week_row.status = 'published' and part1_new.assignee_user_id is not null then
    route_path := '/schedules/' || week_row.client_id::text || '?week=' || week_row.week_start_date::text;
    perform public.schedule_notify_users(
      array[part1_new.assignee_user_id],
      case when p_shift_id is null then 'schedule_shift_created' else 'schedule_shift_updated' end,
      case when p_shift_id is null then 'New published shift assigned' else 'Published shift updated' end,
      'A published shift in your schedule was updated.',
      jsonb_build_object('source_url', route_path, 'schedule_shift_id', part1_new.id),
      coalesce(part1_new.split_group_id::text, part1_new.id::text) || ':' || week_row.published_version::text || ':' || coalesce(p_shift_id::text, 'new')
    );
  end if;

  return shift_id;
exception
  when exclusion_violation then
    raise exception 'Shift overlaps with an existing shift for this employee';
end;
$$;

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

    delete from public.schedule_shifts
    where split_group_id = shift_row.split_group_id;
  else
    deleted_rows := jsonb_build_array(to_jsonb(shift_row));
    if shift_row.assignee_user_id is not null then
      deleted_assignees := array[shift_row.assignee_user_id];
    end if;

    delete from public.schedule_shifts
    where id = shift_row.id;
  end if;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    shift_row.id,
    'shift.deleted',
    jsonb_build_object('deleted', deleted_rows),
    '{}'::jsonb,
    jsonb_build_object('split_group_id', shift_row.split_group_id)
  );

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
