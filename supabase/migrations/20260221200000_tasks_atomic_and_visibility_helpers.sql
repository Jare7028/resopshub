-- Task helper functions for safer writes and lower query overhead.
-- Safe to re-run.

create or replace function public.replace_task_assignees(
  p_task_id uuid,
  p_assignee_user_ids uuid[] default '{}'::uuid[]
)
returns uuid[]
language plpgsql
set search_path = 'public'
as $$
declare
  v_assignee_ids uuid[];
begin
  if p_task_id is null then
    raise exception 'task_id is required' using errcode = '22023';
  end if;

  v_assignee_ids := coalesce(
    array(
      select distinct assignee_id
      from unnest(coalesce(p_assignee_user_ids, '{}'::uuid[])) as assignee_id
      where assignee_id is not null
    ),
    '{}'::uuid[]
  );

  delete from public.task_assignees ta
  where ta.task_id = p_task_id
    and (
      cardinality(v_assignee_ids) = 0
      or ta.user_id <> all(v_assignee_ids)
    );

  if cardinality(v_assignee_ids) > 0 then
    insert into public.task_assignees (task_id, user_id)
    select p_task_id, assignee_id
    from unnest(v_assignee_ids) as assignee_id
    on conflict (task_id, user_id) do nothing;
  end if;

  update public.tasks
  set assignee_user_id = case
    when cardinality(v_assignee_ids) > 0 then v_assignee_ids[1]
    else null
  end
  where id = p_task_id;

  return v_assignee_ids;
end;
$$;

grant execute on function public.replace_task_assignees(uuid, uuid[]) to authenticated;

create or replace function public.create_subtask_with_assignees(
  p_parent_task_id uuid,
  p_client_id uuid,
  p_project_id uuid,
  p_title text,
  p_status text,
  p_priority text,
  p_start_date date,
  p_due_date date,
  p_due_time time,
  p_created_by_user_id uuid,
  p_content jsonb,
  p_content_text text,
  p_assignee_user_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
set search_path = 'public'
as $$
declare
  v_assignee_ids uuid[];
  v_subtask_id uuid;
  v_status public.task_status;
  v_priority public.task_priority;
begin
  if p_parent_task_id is null then
    raise exception 'parent_task_id is required' using errcode = '22023';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;

  v_assignee_ids := coalesce(
    array(
      select distinct assignee_id
      from unnest(coalesce(p_assignee_user_ids, '{}'::uuid[])) as assignee_id
      where assignee_id is not null
    ),
    '{}'::uuid[]
  );

  v_status := coalesce(
    (
      select enum_value
      from unnest(enum_range(null::public.task_status)) as enum_value
      where enum_value::text = nullif(trim(p_status), '')
      limit 1
    ),
    'to_do'::public.task_status
  );

  v_priority := coalesce(
    (
      select enum_value
      from unnest(enum_range(null::public.task_priority)) as enum_value
      where enum_value::text = nullif(trim(p_priority), '')
      limit 1
    ),
    'medium'::public.task_priority
  );

  insert into public.tasks (
    client_id,
    project_id,
    parent_task_id,
    title,
    status,
    priority,
    start_date,
    due_date,
    due_time,
    assignee_user_id,
    created_by_user_id,
    content,
    content_text
  ) values (
    p_client_id,
    p_project_id,
    p_parent_task_id,
    p_title,
    v_status,
    v_priority,
    p_start_date,
    p_due_date,
    p_due_time,
    case
      when cardinality(v_assignee_ids) > 0 then v_assignee_ids[1]
      else null
    end,
    p_created_by_user_id,
    p_content,
    p_content_text
  )
  returning id into v_subtask_id;

  if cardinality(v_assignee_ids) > 0 then
    insert into public.task_assignees (task_id, user_id)
    select v_subtask_id, assignee_id
    from unnest(v_assignee_ids) as assignee_id
    on conflict (task_id, user_id) do nothing;
  end if;

  return v_subtask_id;
end;
$$;

grant execute on function public.create_subtask_with_assignees(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  time,
  uuid,
  jsonb,
  text,
  uuid[]
) to authenticated;

create or replace function public.task_accessible_root_ids_for(
  p_user_ids uuid[] default '{}'::uuid[],
  p_include_watching boolean default false
)
returns table (task_id uuid)
language sql
stable
set search_path = 'public'
as $$
  with me as (
    select distinct uid
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as uid
    where uid is not null
  ),
  direct as (
    select t.id as task_id
    from public.tasks t
    where t.parent_task_id is null
      and (
        t.assignee_user_id in (select uid from me)
        or t.created_by_user_id in (select uid from me)
      )
  ),
  assigned as (
    select distinct ta.task_id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    where t.parent_task_id is null
      and ta.user_id in (select uid from me)
  ),
  watched as (
    select distinct tw.task_id
    from public.task_watchers tw
    join public.tasks t on t.id = tw.task_id
    where p_include_watching
      and t.parent_task_id is null
      and tw.user_id in (select uid from me)
  )
  select task_id from direct
  union
  select task_id from assigned
  union
  select task_id from watched;
$$;

grant execute on function public.task_accessible_root_ids_for(uuid[], boolean) to authenticated;
