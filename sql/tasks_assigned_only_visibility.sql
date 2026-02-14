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
        or t.created_by_user_id = (select app_uid from me)
        or t.created_by_user_id = (select auth_uid from me)
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
        or t.created_by_user_id = (select app_uid from me)
        or t.created_by_user_id = (select auth_uid from me)
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
    and coalesce(created_by_user_id, auth.uid()) in (auth.uid(), public.current_app_user_id())
    and (
      public.is_admin()
      or (
        parent_task_id is not null
        and (
          exists (
            select 1
            from public.tasks parent
            left join public.task_assignees pta
              on pta.task_id = parent.id
             and pta.user_id in (public.current_app_user_id(), auth.uid())
            where parent.id = tasks.parent_task_id
              and (
                public.is_admin()
                or parent.status::text = 'template'
                or parent.created_by_user_id in (public.current_app_user_id(), auth.uid())
                or parent.assignee_user_id in (public.current_app_user_id(), auth.uid())
                or pta.user_id is not null
              )
          )
          or exists (
            select 1
            from public.task_templates tt
            where tt.id = tasks.parent_task_id
          )
        )
      )
      or (
        parent_task_id is null
        and (
          (
            project_id is not null
            and exists (
              select 1
              from public.projects p
              where p.id = tasks.project_id
                and (
                  public.is_project_member(p.id)
                  or public.is_project_creator(p.id)
                  or (p.client_id is not null and public.can_access_client(p.client_id))
                  or p.created_by_user_id in (public.current_app_user_id(), auth.uid())
                )
                and (
                  tasks.client_id is null
                  or p.client_id is null
                  or tasks.client_id = p.client_id
                )
            )
          )
          or (
            project_id is null
            and (client_id is null or public.can_access_client(client_id))
          )
        )
      )
    )
  );

-- Safety-net insert policy for parent/subtask creation flows.
-- This protects against older environments where only legacy insert policies exist.
-- Keep this helper independent from public.can_access_task() to tolerate mixed SQL states.
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
