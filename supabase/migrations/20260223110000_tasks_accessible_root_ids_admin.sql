-- Ensure admin users receive all root tasks from the visibility helper.

create or replace function public.task_accessible_root_ids_for(
  p_user_ids uuid[] default '{}'::uuid[],
  p_include_watching boolean default false
)
returns table (task_id uuid)
language sql
stable
set search_path = 'public'
as $$
  with admin_access as (
    select public.is_admin() as is_admin
  ),
  me as (
    select distinct uid
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as uid
    where uid is not null
  ),
  admin_roots as (
    select t.id as task_id
    from public.tasks t
    cross join admin_access a
    where a.is_admin
      and t.parent_task_id is null
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
  select task_id from admin_roots
  union
  select task_id from direct
  union
  select task_id from assigned
  union
  select task_id from watched;
$$;

grant execute on function public.task_accessible_root_ids_for(uuid[], boolean) to authenticated;
