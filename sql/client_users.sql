-- Client assignments and access control
-- Adds explicit client membership (client_users) and extends access checks + RLS.

create table if not exists public.client_users (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create index if not exists client_users_user_id_idx
  on public.client_users (user_id);

alter table public.client_users enable row level security;

-- Access: admin, client creator, explicitly assigned, or assigned to any project under the client.
create or replace function public.can_access_client(client_uuid uuid)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.clients c
      where c.id = client_uuid
        and c.created_by_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.client_users cu
      where cu.client_id = client_uuid
        and cu.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.projects p
      join public.project_users pu on pu.project_id = p.id
      where p.client_id = client_uuid
        and pu.user_id = auth.uid()
    )
  );
$$;

-- Client users: admins can manage; client members can view membership.
drop policy if exists client_users_select on public.client_users;
create policy client_users_select
  on public.client_users
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (public.is_admin() or public.can_access_client(client_id) or user_id = auth.uid())
  );

drop policy if exists client_users_insert_admin on public.client_users;
create policy client_users_insert_admin
  on public.client_users
  for insert
  to authenticated
  with check (auth.uid() is not null and public.is_admin());

drop policy if exists client_users_update_admin on public.client_users;
create policy client_users_update_admin
  on public.client_users
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists client_users_delete_admin on public.client_users;
create policy client_users_delete_admin
  on public.client_users
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.client_users to authenticated;

-- Tighten client_kpis: require client access.
alter table public.client_kpis enable row level security;

drop policy if exists client_kpis_select on public.client_kpis;
create policy client_kpis_select
  on public.client_kpis
  for select
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists client_kpis_insert on public.client_kpis;
create policy client_kpis_insert
  on public.client_kpis
  for insert
  to authenticated
  with check (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists client_kpis_update on public.client_kpis;
create policy client_kpis_update
  on public.client_kpis
  for update
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)))
  with check (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

drop policy if exists client_kpis_delete on public.client_kpis;
create policy client_kpis_delete
  on public.client_kpis
  for delete
  to authenticated
  using (auth.uid() is not null and (public.is_admin() or public.can_access_client(client_id)));

-- Projects: allow client members to view/edit projects under the client.
alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select
  on public.projects
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.is_project_member(id)
      or public.can_access_client(client_id)
      or created_by_user_id = auth.uid()
    )
  );

drop policy if exists projects_insert on public.projects;
create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (public.is_admin() or created_by_user_id = auth.uid())
    and (client_id is null or public.is_admin() or public.can_access_client(client_id))
  );

drop policy if exists projects_update on public.projects;
create policy projects_update
  on public.projects
  for update
  to authenticated
  using (
    public.is_admin()
    or public.is_project_member(id)
    or public.can_access_client(client_id)
    or created_by_user_id = auth.uid()
  )
  with check (
    public.is_admin()
    or public.is_project_member(id)
    or public.can_access_client(client_id)
    or created_by_user_id = auth.uid()
  );

drop policy if exists projects_delete on public.projects;
create policy projects_delete
  on public.projects
  for delete
  to authenticated
  using (
    public.is_admin()
    or public.is_project_member(id)
    or public.can_access_client(client_id)
    or created_by_user_id = auth.uid()
  );

-- Tasks: allow client members to view/edit tasks tied to the client (even without a project).
alter table public.tasks enable row level security;

create or replace function public.can_access_task(task_uuid uuid)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.tasks t
    left join public.project_users pu
      on pu.project_id = t.project_id and pu.user_id = auth.uid()
    left join public.task_assignees ta
      on ta.task_id = t.id and ta.user_id = auth.uid()
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or (t.client_id is not null and public.can_access_client(t.client_id))
        or pu.user_id is not null
        or t.assignee_user_id = auth.uid()
        or ta.user_id is not null
        or (t.project_id is null and t.created_by_user_id = auth.uid())
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
    and (
      public.is_admin()
      or ((project_id is not null) and public.is_project_member(project_id))
      or ((client_id is not null) and public.can_access_client(client_id))
      or (assignee_user_id = auth.uid())
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = tasks.id
          and ta.user_id = auth.uid()
      )
      or ((project_id is null) and (created_by_user_id = auth.uid()))
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update
  on public.tasks
  for update
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or ((project_id is not null) and public.is_project_member(project_id))
      or ((client_id is not null) and public.can_access_client(client_id))
      or (assignee_user_id = auth.uid())
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = tasks.id
          and ta.user_id = auth.uid()
      )
      or ((project_id is null) and (created_by_user_id = auth.uid()))
    )
  )
  with check (
    auth.uid() is not null
    and (
      public.is_admin()
      or ((project_id is not null) and public.is_project_member(project_id))
      or ((client_id is not null) and public.can_access_client(client_id))
      or ((project_id is null) and (coalesce(created_by_user_id, auth.uid()) = auth.uid()))
      or (assignee_user_id = auth.uid())
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = tasks.id
          and ta.user_id = auth.uid()
      )
    )
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete
  on public.tasks
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or ((project_id is not null) and public.is_project_member(project_id))
      or ((client_id is not null) and public.can_access_client(client_id))
      or (assignee_user_id = auth.uid())
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = tasks.id
          and ta.user_id = auth.uid()
      )
      or ((project_id is null) and (created_by_user_id = auth.uid()))
    )
  );

drop policy if exists tasks_insert_assigned on public.tasks;
create policy tasks_insert_assigned
  on public.tasks
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (coalesce(created_by_user_id, auth.uid()) = auth.uid())
    and (
      public.is_admin()
      or ((project_id is not null) and public.is_project_member(project_id))
      or (project_id is null)
    )
    and (client_id is null or public.is_admin() or public.can_access_client(client_id))
  );

-- Task assignees: allow client members to manage assignees for client tasks.
alter table public.task_assignees enable row level security;

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select
  on public.task_assignees
  for select
  to authenticated
  using (public.can_access_task(task_id));

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert
  on public.task_assignees
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.is_project_member((
        select t.project_id
        from public.tasks t
        where t.id = public.task_assignees.task_id
      ))
      or public.can_access_client((
        select t.client_id
        from public.tasks t
        where t.id = public.task_assignees.task_id
      ))
      or (
        select (t.project_id is null and t.created_by_user_id = auth.uid())
        from public.tasks t
        where t.id = public.task_assignees.task_id
      )
    )
  );

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete
  on public.task_assignees
  for delete
  to authenticated
  using (
    public.is_admin()
    or public.is_project_member((
      select t.project_id
      from public.tasks t
      where t.id = public.task_assignees.task_id
    ))
    or public.can_access_client((
      select t.client_id
      from public.tasks t
      where t.id = public.task_assignees.task_id
    ))
    or (
      select (t.project_id is null and t.created_by_user_id = auth.uid())
      from public.tasks t
      where t.id = public.task_assignees.task_id
    )
  );

