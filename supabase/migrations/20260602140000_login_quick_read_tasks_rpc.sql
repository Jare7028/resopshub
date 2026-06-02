-- Bound login quick-read task lookup to one indexed SQL query.

create index if not exists idx_tasks_quick_read_primary_assignee_due
  on public.tasks(assignee_user_id, due_date, due_time, id)
  where due_date is not null
    and status <> 'template';

create index if not exists idx_task_assignees_user_task_id
  on public.task_assignees(user_id, task_id);

create or replace function public.login_quick_read_tasks(
  p_user_id uuid,
  p_due_date_cutoff date,
  p_limit integer default 600
)
returns table(
  id uuid,
  title text,
  status text,
  due_date date,
  due_time text
)
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select
      p_user_id as user_id,
      coalesce(p_due_date_cutoff, current_date) as due_date_cutoff,
      least(greatest(coalesce(p_limit, 600), 1), 600) as row_limit
  ),
  matching_tasks as (
    select
      t.id,
      t.title,
      t.status::text as status,
      t.due_date,
      t.due_time::text as due_time
    from public.tasks t
    cross join settings s
    where s.user_id is not null
      and t.assignee_user_id = s.user_id
      and t.due_date is not null
      and t.due_date <= s.due_date_cutoff
      and t.status::text <> 'template'

    union

    select
      t.id,
      t.title,
      t.status::text as status,
      t.due_date,
      t.due_time::text as due_time
    from settings s
    join public.task_assignees ta on ta.user_id = s.user_id
    join public.tasks t on t.id = ta.task_id
    where s.user_id is not null
      and t.due_date is not null
      and t.due_date <= s.due_date_cutoff
      and t.status::text <> 'template'
  )
  select
    matching_tasks.id,
    matching_tasks.title,
    matching_tasks.status,
    matching_tasks.due_date,
    matching_tasks.due_time
  from matching_tasks
  order by
    matching_tasks.due_date asc,
    matching_tasks.due_time asc nulls last,
    matching_tasks.id asc
  limit (select row_limit from settings);
$$;

grant execute on function public.login_quick_read_tasks(uuid, date, integer)
  to authenticated;
