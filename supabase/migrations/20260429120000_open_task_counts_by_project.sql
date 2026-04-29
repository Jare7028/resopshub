create or replace function public.open_task_counts_by_project(
  p_project_ids uuid[],
  p_hidden_statuses text[] default array[]::text[]
)
returns table(project_id uuid, open_task_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    tasks.project_id,
    count(*)::bigint as open_task_count
  from public.tasks
  where tasks.project_id = any(p_project_ids)
    and tasks.parent_task_id is null
    and (
      coalesce(array_length(p_hidden_statuses, 1), 0) = 0
      or not (tasks.status::text = any(p_hidden_statuses))
    )
  group by tasks.project_id;
$$;
