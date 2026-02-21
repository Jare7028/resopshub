-- Allow subtask inserts when a user can access the parent task via
-- direct ownership/assignment OR client/project visibility.
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
      left join public.task_assignees pta
        on pta.task_id = parent.id
       and pta.user_id in ((select auth_uid from me), (select app_uid from me))
      where parent.id = parent_uuid
        and (
          public.is_admin()
          or public.can_access_task(parent_uuid)
          or parent.status::text = 'template'
          or parent.created_by_user_id in ((select auth_uid from me), (select app_uid from me))
          or parent.assignee_user_id in ((select auth_uid from me), (select app_uid from me))
          or pta.user_id is not null
          or (parent.client_id is not null and public.can_access_client(parent.client_id))
          or (
            parent.project_id is not null
            and (
              public.is_project_member(parent.project_id)
              or public.is_project_creator(parent.project_id)
            )
          )
        )
    );
$$;

grant execute on function public.can_create_subtask_under(uuid, uuid) to authenticated;

drop policy if exists tasks_insert_with_parent_access on public.tasks;
create policy tasks_insert_with_parent_access
  on public.tasks
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and parent_task_id is not null
    and public.can_create_subtask_under(parent_task_id, created_by_user_id)
  );
