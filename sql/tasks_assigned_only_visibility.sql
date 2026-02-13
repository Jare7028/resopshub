-- Restrict task/subtask visibility to assignees (or admins).
-- Project assignment alone should not grant visibility to all tasks.

create or replace function public.can_access_task_base(task_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as app_uid, auth.uid() as auth_uid
  )
  select exists (
    select 1
    from public.tasks t
    left join public.task_assignees ta
      on ta.task_id = t.id and ta.user_id = (select app_uid from me)
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or t.status::text = 'template'
        or t.assignee_user_id = (select app_uid from me)
        or t.assignee_user_id = (select auth_uid from me)
        or ta.user_id is not null
      )
  );
$$;

create or replace function public.can_access_task(task_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as app_uid, auth.uid() as auth_uid
  )
  select exists (
    select 1
    from public.tasks t
    left join public.task_assignees ta
      on ta.task_id = t.id and ta.user_id = (select app_uid from me)
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or t.status::text = 'template'
        or t.assignee_user_id = (select app_uid from me)
        or t.assignee_user_id = (select auth_uid from me)
        or ta.user_id is not null
      )
  );
$$;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.can_access_task(id)
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update
  on public.tasks
  for update
  to authenticated
  using (
    auth.uid() is not null
    and public.can_access_task(id)
  )
  with check (
    auth.uid() is not null
    and (public.is_admin() or public.can_access_task(id))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete
  on public.tasks
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and public.can_access_task(id)
  );

drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_insert_assigned on public.tasks;
create policy tasks_insert
  on public.tasks
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and coalesce(created_by_user_id, auth.uid()) = auth.uid()
    and (
      public.is_admin()
      or (
        parent_task_id is not null
        and public.can_access_task(parent_task_id)
      )
      or (
        parent_task_id is null
        and (
          (project_id is not null and public.is_project_member(project_id))
          or (project_id is null)
        )
        and (client_id is null or public.can_access_client(client_id))
      )
    )
  );
