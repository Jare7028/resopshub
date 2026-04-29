drop function if exists public.task_list_page(
  uuid[],
  boolean,
  text[],
  text[],
  uuid[],
  boolean,
  uuid[],
  uuid[],
  text[],
  boolean,
  text,
  date,
  text,
  text,
  text[],
  integer
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
  p_limit integer default 500
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
  next_subtask_due_date date
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
          'due'
        )
          then lower(p_sort_key)
        else 'created'
      end as sort_key,
      case when lower(coalesce(p_sort_dir, '')) = 'asc' then 'asc' else 'desc' end as sort_dir,
      coalesce(p_is_admin, false) as is_admin,
      least(greatest(coalesce(p_limit, 500), 1), 500) as row_limit
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
      c.name as client_name,
      p.name as project_name,
      coalesce(nullif(primary_user.full_name, ''), primary_user.email, '') as primary_assignee_label,
      coalesce(assignee_labels.first_assignee_label, '') as first_assignee_label
    from public.tasks t
    join visible_root_ids v on v.task_id = t.id
    left join public.clients c on c.id = t.client_id
    left join public.projects p on p.id = t.project_id
    left join public.users primary_user on primary_user.id = t.assignee_user_id
    left join lateral (
      select min(coalesce(nullif(u.full_name, ''), u.email, 'Unnamed user')) as first_assignee_label
      from public.task_assignees ta
      left join public.users u on u.id = ta.user_id
      where ta.task_id = t.id
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
  ),
  enriched as (
    select
      f.*,
      case
        when f.assignee_user_id is null then coalesce(task_assignees.assignee_user_ids, '{}'::uuid[])
        when f.assignee_user_id = any(coalesce(task_assignees.assignee_user_ids, '{}'::uuid[]))
          then coalesce(task_assignees.assignee_user_ids, '{}'::uuid[])
        else coalesce(task_assignees.assignee_user_ids, '{}'::uuid[]) || f.assignee_user_id
      end as all_assignee_user_ids,
      coalesce(subtasks.open_subtask_count, 0)::bigint as open_subtask_count,
      subtasks.next_subtask_due_date
    from filtered f
    left join lateral (
      select array_agg(ta.user_id order by ta.created_at, ta.user_id::text) as assignee_user_ids
      from public.task_assignees ta
      where ta.task_id = f.id
    ) task_assignees on true
    left join lateral (
      select
        count(*)::bigint as open_subtask_count,
        min(st.due_date) filter (where st.due_date is not null) as next_subtask_due_date
      from public.tasks st
      where st.parent_task_id = f.id
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
    e.next_subtask_due_date
  from enriched e
  cross join settings s
  order by
    case when s.sort_key = 'title' and s.sort_dir = 'asc' then lower(coalesce(e.title, '')) end asc nulls last,
    case when s.sort_key = 'title' and s.sort_dir = 'desc' then lower(coalesce(e.title, '')) end desc nulls last,
    case when s.sort_key = 'client' and s.sort_dir = 'asc' then lower(coalesce(e.client_name, '')) end asc nulls last,
    case when s.sort_key = 'client' and s.sort_dir = 'desc' then lower(coalesce(e.client_name, '')) end desc nulls last,
    case when s.sort_key = 'project' and s.sort_dir = 'asc' then lower(coalesce(e.project_name, '')) end asc nulls last,
    case when s.sort_key = 'project' and s.sort_dir = 'desc' then lower(coalesce(e.project_name, '')) end desc nulls last,
    case when s.sort_key = 'status' and s.sort_dir = 'asc' then coalesce(array_position(p_status_order, e.status::text), 2147483647) end asc nulls last,
    case when s.sort_key = 'status' and s.sort_dir = 'desc' then coalesce(array_position(p_status_order, e.status::text), 2147483647) end desc nulls last,
    case when s.sort_key = 'priority' and s.sort_dir = 'asc' then
      case lower(coalesce(e.priority::text, ''))
        when 'low' then 0
        when 'medium' then 1
        when 'high' then 2
        when 'critical' then 3
        else 2147483647
      end
    end asc nulls last,
    case when s.sort_key = 'priority' and s.sort_dir = 'desc' then
      case lower(coalesce(e.priority::text, ''))
        when 'low' then 0
        when 'medium' then 1
        when 'high' then 2
        when 'critical' then 3
        else 2147483647
      end
    end desc nulls last,
    case when s.sort_key = 'assignees' and s.sort_dir = 'asc' then lower(coalesce(nullif(e.first_assignee_label, ''), e.primary_assignee_label, '')) end asc nulls last,
    case when s.sort_key = 'assignees' and s.sort_dir = 'desc' then lower(coalesce(nullif(e.first_assignee_label, ''), e.primary_assignee_label, '')) end desc nulls last,
    case when s.sort_key = 'start' and s.sort_dir = 'asc' then e.start_date end asc nulls last,
    case when s.sort_key = 'start' and s.sort_dir = 'desc' then e.start_date end desc nulls last,
    case when s.sort_key = 'due' and s.sort_dir = 'asc' then e.due_date end asc nulls last,
    case when s.sort_key = 'due' and s.sort_dir = 'desc' then e.due_date end desc nulls last,
    case when s.sort_key = 'created' and s.sort_dir = 'asc' then e.created_at end asc nulls last,
    case when s.sort_key = 'created' and s.sort_dir = 'desc' then e.created_at end desc nulls last,
    e.id asc
  limit (select row_limit from settings);
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
  integer
) to authenticated;
