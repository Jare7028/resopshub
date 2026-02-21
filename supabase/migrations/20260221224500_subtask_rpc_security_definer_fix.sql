-- Make subtask creation deterministic across mixed RLS environments.
-- 1) Broaden parent-access helper to include direct membership table checks.
-- 2) Run create_subtask_with_assignees as SECURITY DEFINER and gate via helper.
-- Safe to re-run.

create or replace function public.can_create_subtask_under(
  parent_uuid uuid,
  new_created_by uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and parent_uuid is not null
    and coalesce(new_created_by, (select auth_uid from me)) in ((select auth_uid from me), (select app_uid from me))
    and exists (
      select 1
      from public.tasks parent
      where parent.id = parent_uuid
        and (
          public.is_admin()
          or parent.status::text = 'template'
          or parent.created_by_user_id in ((select auth_uid from me), (select app_uid from me))
          or parent.assignee_user_id in ((select auth_uid from me), (select app_uid from me))
          or exists (
            select 1
            from public.task_assignees pta
            where pta.task_id = parent.id
              and pta.user_id in ((select auth_uid from me), (select app_uid from me))
          )
          or (
            parent.project_id is not null
            and (
              public.is_project_member(parent.project_id)
              or public.is_project_creator(parent.project_id)
              or exists (
                select 1
                from public.project_users pu
                where pu.project_id = parent.project_id
                  and pu.user_id in ((select auth_uid from me), (select app_uid from me))
              )
            )
          )
          or (
            parent.client_id is not null
            and (
              public.can_access_client(parent.client_id)
              or exists (
                select 1
                from public.client_users cu
                where cu.client_id = parent.client_id
                  and cu.user_id in ((select auth_uid from me), (select app_uid from me))
              )
              or exists (
                select 1
                from public.clients c
                where c.id = parent.client_id
                  and c.created_by_user_id in ((select auth_uid from me), (select app_uid from me))
              )
            )
          )
        )
    );
$$;

grant execute on function public.can_create_subtask_under(uuid, uuid) to authenticated;

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
security definer
set search_path = 'public'
as $$
declare
  v_assignee_ids uuid[];
  v_subtask_id uuid;
  v_status public.task_status;
  v_priority public.task_priority;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_parent_task_id is null then
    raise exception 'parent_task_id is required' using errcode = '22023';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if not public.can_create_subtask_under(p_parent_task_id, p_created_by_user_id) then
    raise exception 'not allowed to create subtasks under this parent task'
      using errcode = '42501';
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
