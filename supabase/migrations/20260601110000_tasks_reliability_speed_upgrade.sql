drop function if exists public.task_list_page(
  uuid[],
  boolean,
  boolean,
  text[],
  text[],
  uuid[],
  boolean,
  uuid[],
  uuid[],
  text[],
  text[],
  boolean,
  text,
  date,
  text,
  text,
  text[],
  integer
);

drop function if exists public.task_list_page(
  uuid[],
  boolean,
  boolean,
  text[],
  text[],
  uuid[],
  boolean,
  uuid[],
  uuid[],
  text[],
  text[],
  boolean,
  text,
  date,
  text,
  text,
  text[],
  integer,
  integer,
  text
);

create or replace function public.task_list_page(
  p_user_ids uuid[] default '{}'::uuid[],
  p_is_admin boolean default false,
  p_include_watching boolean default false,
  p_statuses text[] default '{}'::text[],
  p_priorities text[] default '{}'::text[],
  p_assignee_user_ids uuid[] default '{}'::uuid[],
  p_include_unassigned boolean default false,
  p_client_ids uuid[] default '{}'::uuid[],
  p_project_ids uuid[] default '{}'::uuid[],
  p_hidden_statuses text[] default '{}'::text[],
  p_hidden_subtask_statuses text[] default '{}'::text[],
  p_exclude_template boolean default true,
  p_due_filter text default 'all',
  p_today date default current_date,
  p_sort_key text default 'created',
  p_sort_dir text default 'desc',
  p_status_order text[] default '{}'::text[],
  p_limit integer default 50,
  p_offset integer default 0,
  p_query text default ''
)
returns table(
  id uuid,
  title text,
  status text,
  priority text,
  start_date date,
  due_date date,
  due_time text,
  created_at timestamptz,
  assignee_user_id uuid,
  client_id uuid,
  project_id uuid,
  client_name text,
  project_name text,
  assignee_user_ids uuid[],
  open_subtask_count bigint,
  next_subtask_due_date date,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select
      case
        when lower(coalesce(p_sort_key, '')) in (
          'created',
          'title',
          'client',
          'project',
          'status',
          'priority',
          'assignees',
          'start',
          'due',
          'queue'
        )
          then lower(p_sort_key)
        else 'created'
      end as sort_key,
      case when lower(coalesce(p_sort_dir, '')) = 'asc' then 'asc' else 'desc' end as sort_dir,
      coalesce(p_is_admin, false) as is_admin,
      least(greatest(coalesce(p_limit, 50), 1), 100) as row_limit,
      greatest(coalesce(p_offset, 0), 0) as row_offset,
      nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'), '') as query_text,
      case
        when nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'), '') is null
          then null::tsquery
        else websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'))
      end as query_ts
  ),
  visible_root_ids as (
    select t.id as task_id
    from public.tasks t
    cross join settings s
    where s.is_admin
      and t.parent_task_id is null
    union
    select task_id
    from public.task_accessible_root_ids_for(
      coalesce(p_user_ids, '{}'::uuid[]),
      coalesce(p_include_watching, false)
    )
    cross join settings s
    where not s.is_admin
  ),
  filtered as (
    select
      t.id,
      t.title,
      t.status,
      t.priority,
      t.start_date,
      t.due_date,
      t.due_time,
      t.created_at,
      t.assignee_user_id,
      t.client_id,
      t.project_id,
      t.content_text,
      c.name as client_name,
      p.name as project_name,
      coalesce(nullif(primary_user.full_name, ''), primary_user.email, '') as primary_assignee_label,
      case
        when s.sort_key = 'assignees' then coalesce(assignee_labels.first_assignee_label, '')
        else ''
      end as first_assignee_label,
      case
        when s.sort_key = 'queue' then
          (case when t.due_date is not null and t.due_date < p_today then 100000 else 0 end) +
          (case lower(coalesce(t.priority::text, ''))
            when 'critical' then 40000
            when 'high' then 25000
            when 'medium' then 10000
            when 'low' then 1000
            else 0
          end) +
          (case
            when t.due_date is null then 0
            when t.due_date <= (p_today + 1) then 8000
            when t.due_date <= (p_today + 7) then 4000
            else 0
          end) +
          (case
            when exists (
              select 1
              from public.tasks st
              where st.parent_task_id = t.id
                and (
                  coalesce(array_length(p_hidden_subtask_statuses, 1), 0) = 0
                  or not (st.status::text = any(coalesce(p_hidden_subtask_statuses, '{}'::text[])))
                )
            )
              then 500
            else 0
          end)
        else 0
      end as queue_rank
    from public.tasks t
    join visible_root_ids v on v.task_id = t.id
    cross join settings s
    left join public.clients c on c.id = t.client_id
    left join public.projects p on p.id = t.project_id
    left join public.users primary_user on primary_user.id = t.assignee_user_id
    left join lateral (
      select min(coalesce(nullif(u.full_name, ''), u.email, 'Unnamed user')) as first_assignee_label
      from public.task_assignees ta
      left join public.users u on u.id = ta.user_id
      where s.sort_key = 'assignees'
        and ta.task_id = t.id
    ) assignee_labels on true
    where t.parent_task_id is null
      and (
        coalesce(array_length(p_statuses, 1), 0) = 0
        or t.status::text = any(coalesce(p_statuses, '{}'::text[]))
      )
      and (
        coalesce(array_length(p_priorities, 1), 0) = 0
        or t.priority::text = any(coalesce(p_priorities, '{}'::text[]))
      )
      and (
        (
          not coalesce(p_include_unassigned, false)
          and coalesce(array_length(p_assignee_user_ids, 1), 0) = 0
        )
        or (
          coalesce(p_include_unassigned, false)
          and t.assignee_user_id is null
          and not exists (
            select 1
            from public.task_assignees ta_unassigned
            where ta_unassigned.task_id = t.id
          )
        )
        or (
          coalesce(array_length(p_assignee_user_ids, 1), 0) > 0
          and (
            t.assignee_user_id = any(coalesce(p_assignee_user_ids, '{}'::uuid[]))
            or exists (
              select 1
              from public.task_assignees ta
              where ta.task_id = t.id
                and ta.user_id = any(coalesce(p_assignee_user_ids, '{}'::uuid[]))
            )
          )
        )
      )
      and (
        coalesce(array_length(p_client_ids, 1), 0) = 0
        or t.client_id = any(coalesce(p_client_ids, '{}'::uuid[]))
      )
      and (
        coalesce(array_length(p_project_ids, 1), 0) = 0
        or t.project_id = any(coalesce(p_project_ids, '{}'::uuid[]))
      )
      and (
        not coalesce(p_exclude_template, true)
        or t.status::text <> 'template'
      )
      and (
        coalesce(array_length(p_hidden_statuses, 1), 0) = 0
        or not (t.status::text = any(coalesce(p_hidden_statuses, '{}'::text[])))
      )
      and (
        coalesce(p_due_filter, 'all') = 'all'
        or (p_due_filter = 'overdue' and t.due_date < p_today)
        or (p_due_filter = 'next_7' and t.due_date >= p_today and t.due_date <= (p_today + 7))
        or (p_due_filter = 'none' and t.due_date is null)
      )
      and (
        s.query_text is null
        or to_tsvector(
          'english',
          coalesce(t.title, '') || ' ' || coalesce(t.content_text, '')
        ) @@ s.query_ts
        or t.title ilike ('%' || s.query_text || '%')
        or coalesce(t.content_text, '') ilike ('%' || s.query_text || '%')
        or coalesce(c.name, '') ilike ('%' || s.query_text || '%')
        or coalesce(p.name, '') ilike ('%' || s.query_text || '%')
      )
  ),
  counted as (
    select count(*)::bigint as total_count
    from filtered
  ),
  paged as (
    select f.*
    from filtered f
    cross join settings s
    order by
      case when s.sort_key = 'queue' and s.sort_dir = 'asc' then f.queue_rank end asc nulls last,
      case when s.sort_key = 'queue' and s.sort_dir = 'desc' then f.queue_rank end desc nulls last,
      case when s.sort_key = 'title' and s.sort_dir = 'asc' then lower(coalesce(f.title, '')) end asc nulls last,
      case when s.sort_key = 'title' and s.sort_dir = 'desc' then lower(coalesce(f.title, '')) end desc nulls last,
      case when s.sort_key = 'client' and s.sort_dir = 'asc' then lower(coalesce(f.client_name, '')) end asc nulls last,
      case when s.sort_key = 'client' and s.sort_dir = 'desc' then lower(coalesce(f.client_name, '')) end desc nulls last,
      case when s.sort_key = 'project' and s.sort_dir = 'asc' then lower(coalesce(f.project_name, '')) end asc nulls last,
      case when s.sort_key = 'project' and s.sort_dir = 'desc' then lower(coalesce(f.project_name, '')) end desc nulls last,
      case when s.sort_key = 'status' and s.sort_dir = 'asc' then coalesce(array_position(p_status_order, f.status::text), 2147483647) end asc nulls last,
      case when s.sort_key = 'status' and s.sort_dir = 'desc' then coalesce(array_position(p_status_order, f.status::text), 2147483647) end desc nulls last,
      case when s.sort_key = 'priority' and s.sort_dir = 'asc' then
        case lower(coalesce(f.priority::text, ''))
          when 'low' then 0
          when 'medium' then 1
          when 'high' then 2
          when 'critical' then 3
          else 2147483647
        end
      end asc nulls last,
      case when s.sort_key = 'priority' and s.sort_dir = 'desc' then
        case lower(coalesce(f.priority::text, ''))
          when 'low' then 0
          when 'medium' then 1
          when 'high' then 2
          when 'critical' then 3
          else 2147483647
        end
      end desc nulls last,
      case when s.sort_key = 'assignees' and s.sort_dir = 'asc' then lower(coalesce(nullif(f.first_assignee_label, ''), f.primary_assignee_label, '')) end asc nulls last,
      case when s.sort_key = 'assignees' and s.sort_dir = 'desc' then lower(coalesce(nullif(f.first_assignee_label, ''), f.primary_assignee_label, '')) end desc nulls last,
      case when s.sort_key = 'start' and s.sort_dir = 'asc' then f.start_date end asc nulls last,
      case when s.sort_key = 'start' and s.sort_dir = 'desc' then f.start_date end desc nulls last,
      case when s.sort_key = 'due' and s.sort_dir = 'asc' then f.due_date end asc nulls last,
      case when s.sort_key = 'due' and s.sort_dir = 'desc' then f.due_date end desc nulls last,
      case when s.sort_key = 'created' and s.sort_dir = 'asc' then f.created_at end asc nulls last,
      case when s.sort_key = 'created' and s.sort_dir = 'desc' then f.created_at end desc nulls last,
      f.id asc
    limit (select row_limit from settings)
    offset (select row_offset from settings)
  ),
  enriched as (
    select
      p.*,
      case
        when p.assignee_user_id is null then coalesce(task_assignees.assignee_user_ids, '{}'::uuid[])
        when p.assignee_user_id = any(coalesce(task_assignees.assignee_user_ids, '{}'::uuid[]))
          then coalesce(task_assignees.assignee_user_ids, '{}'::uuid[])
        else coalesce(task_assignees.assignee_user_ids, '{}'::uuid[]) || p.assignee_user_id
      end as all_assignee_user_ids,
      coalesce(subtasks.open_subtask_count, 0)::bigint as open_subtask_count,
      subtasks.next_subtask_due_date
    from paged p
    left join lateral (
      select array_agg(ta.user_id order by ta.created_at, ta.user_id::text) as assignee_user_ids
      from public.task_assignees ta
      where ta.task_id = p.id
    ) task_assignees on true
    left join lateral (
      select
        count(*)::bigint as open_subtask_count,
        min(st.due_date) filter (where st.due_date is not null) as next_subtask_due_date
      from public.tasks st
      where st.parent_task_id = p.id
        and (
          coalesce(array_length(p_hidden_subtask_statuses, 1), 0) = 0
          or not (st.status::text = any(coalesce(p_hidden_subtask_statuses, '{}'::text[])))
        )
    ) subtasks on true
  )
  select
    e.id,
    e.title,
    e.status::text as status,
    e.priority::text as priority,
    e.start_date,
    e.due_date,
    e.due_time::text as due_time,
    e.created_at,
    e.assignee_user_id,
    e.client_id,
    e.project_id,
    e.client_name,
    e.project_name,
    e.all_assignee_user_ids as assignee_user_ids,
    e.open_subtask_count,
    e.next_subtask_due_date,
    counted.total_count
  from enriched e
  cross join counted;
$$;

grant execute on function public.task_list_page(
  uuid[],
  boolean,
  boolean,
  text[],
  text[],
  uuid[],
  boolean,
  uuid[],
  uuid[],
  text[],
  text[],
  boolean,
  text,
  date,
  text,
  text,
  text[],
  integer,
  integer,
  text
) to authenticated;

create or replace function public.update_task_inline(
  p_task_id uuid,
  p_has_status boolean default false,
  p_status text default null,
  p_has_priority boolean default false,
  p_priority text default null,
  p_has_client_id boolean default false,
  p_client_id uuid default null,
  p_has_project_id boolean default false,
  p_project_id uuid default null,
  p_has_start_date boolean default false,
  p_start_date date default null,
  p_has_due_date boolean default false,
  p_due_date date default null,
  p_has_due_time boolean default false,
  p_due_time time default null,
  p_has_assignees boolean default false,
  p_assignee_user_ids uuid[] default '{}'::uuid[]
)
returns table(
  id uuid,
  status text,
  priority text,
  client_id uuid,
  project_id uuid,
  start_date date,
  due_date date,
  due_time text,
  assignee_user_id uuid,
  assignee_user_ids uuid[]
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_status public.task_status;
  v_priority public.task_priority;
  v_target_client_id uuid;
  v_target_project_id uuid;
  v_project_client_id uuid;
  v_assignee_ids uuid[];
  v_primary_assignee_id uuid;
begin
  if p_task_id is null then
    raise exception 'task_id is required' using errcode = '22023';
  end if;

  select *
  into v_task
  from public.tasks
  where tasks.id = p_task_id
  for update;

  if not found then
    raise exception 'Task not found' using errcode = '02000';
  end if;

  if p_has_status then
    select enum_value
    into v_status
    from unnest(enum_range(null::public.task_status)) as enum_value
    where enum_value::text = nullif(trim(coalesce(p_status, '')), '')
    limit 1;

    if v_status is null then
      raise exception 'Invalid status' using errcode = '22023';
    end if;
  else
    v_status := v_task.status;
  end if;

  if p_has_priority then
    select enum_value
    into v_priority
    from unnest(enum_range(null::public.task_priority)) as enum_value
    where enum_value::text = nullif(trim(coalesce(p_priority, '')), '')
    limit 1;

    if v_priority is null then
      raise exception 'Invalid priority' using errcode = '22023';
    end if;
  else
    v_priority := v_task.priority;
  end if;

  v_target_client_id := case when p_has_client_id then p_client_id else v_task.client_id end;
  v_target_project_id := case when p_has_project_id then p_project_id else v_task.project_id end;

  if v_target_project_id is not null then
    select projects.client_id
    into v_project_client_id
    from public.projects
    where projects.id = v_target_project_id;

    if not found then
      raise exception 'Project not found' using errcode = '22023';
    end if;

    if v_target_client_id is null then
      v_target_client_id := v_project_client_id;
    elsif v_project_client_id is not null and v_target_client_id is distinct from v_project_client_id then
      if p_has_client_id and not p_has_project_id then
        v_target_project_id := null;
      else
        raise exception 'Project does not belong to the selected client' using errcode = '22023';
      end if;
    end if;
  end if;

  if p_has_assignees then
    v_assignee_ids := coalesce(
      array(
        select distinct assignee_id
        from unnest(coalesce(p_assignee_user_ids, '{}'::uuid[])) as assignee_id
        where assignee_id is not null
        order by assignee_id
      ),
      '{}'::uuid[]
    );
    v_primary_assignee_id := case
      when cardinality(v_assignee_ids) > 0 then v_assignee_ids[1]
      else null
    end;
  else
    v_primary_assignee_id := v_task.assignee_user_id;
  end if;

  update public.tasks
  set
    status = v_status,
    priority = v_priority,
    client_id = v_target_client_id,
    project_id = v_target_project_id,
    start_date = case when p_has_start_date then p_start_date else tasks.start_date end,
    due_date = case when p_has_due_date then p_due_date else tasks.due_date end,
    due_time = case when p_has_due_time then p_due_time else tasks.due_time end,
    assignee_user_id = v_primary_assignee_id
  where tasks.id = p_task_id;

  if p_has_assignees then
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
  end if;

  return query
    select
      t.id,
      t.status::text,
      t.priority::text,
      t.client_id,
      t.project_id,
      t.start_date,
      t.due_date,
      t.due_time::text,
      t.assignee_user_id,
      coalesce(assignees.assignee_user_ids, '{}'::uuid[])
    from public.tasks t
    left join lateral (
      select array_agg(ta.user_id order by ta.created_at, ta.user_id::text) as assignee_user_ids
      from public.task_assignees ta
      where ta.task_id = t.id
    ) assignees on true
    where t.id = p_task_id;
end;
$$;

grant execute on function public.update_task_inline(
  uuid,
  boolean,
  text,
  boolean,
  text,
  boolean,
  uuid,
  boolean,
  uuid,
  boolean,
  date,
  boolean,
  date,
  boolean,
  time,
  boolean,
  uuid[]
) to authenticated;
