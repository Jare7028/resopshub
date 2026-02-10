-- Watchers: users who can follow (and edit) specific tasks or projects without being an assignee.
-- Design: becoming a watcher grants view/edit permissions via RLS + access helper functions.

create table if not exists public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_watchers_user_id_idx
  on public.task_watchers (user_id);

alter table public.task_watchers enable row level security;

create table if not exists public.project_watchers (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_watchers_user_id_idx
  on public.project_watchers (user_id);

alter table public.project_watchers enable row level security;

-- Helper: "base" client access (does not consider watchers).
-- This is used inside watcher policies to avoid self-referential RLS checks.
create or replace function public.can_access_client_base(client_uuid uuid)
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

-- Helper: "base" task access (does not consider watchers).
create or replace function public.can_access_task_base(task_uuid uuid)
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
        or (t.client_id is not null and public.can_access_client_base(t.client_id))
        or pu.user_id is not null
        or t.assignee_user_id = auth.uid()
        or ta.user_id is not null
        or (t.project_id is null and t.created_by_user_id = auth.uid())
      )
  );
$$;

-- Helper: "base" project access (does not consider watchers).
create or replace function public.can_access_project_base(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.projects p
    where p.id = project_uuid
      and (
        public.is_admin()
        or public.is_project_member(project_uuid)
        or public.is_project_creator(project_uuid)
        or (p.client_id is not null and public.can_access_client_base(p.client_id))
      )
  );
$$;

-- Extend access helpers so watchers gain permissions.
create or replace function public.can_access_client(client_uuid uuid)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and (
    public.can_access_client_base(client_uuid)
    or exists (
      select 1
      from public.projects p
      join public.project_watchers pw on pw.project_id = p.id
      where p.client_id = client_uuid
        and pw.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.tasks t
      join public.task_watchers tw on tw.task_id = t.id
      where t.client_id = client_uuid
        and tw.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      join public.task_watchers tw on tw.task_id = t.id
      where p.client_id = client_uuid
        and tw.user_id = auth.uid()
    )
  );
$$;

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
    left join public.task_watchers tw
      on tw.task_id = t.id and tw.user_id = auth.uid()
    left join public.project_watchers pw
      on pw.project_id = t.project_id and pw.user_id = auth.uid()
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or (t.client_id is not null and public.can_access_client(t.client_id))
        or pu.user_id is not null
        or t.assignee_user_id = auth.uid()
        or ta.user_id is not null
        or tw.user_id is not null
        or pw.user_id is not null
        or (t.project_id is null and t.created_by_user_id = auth.uid())
      )
  );
$$;

-- Task watchers RLS
drop policy if exists task_watchers_select on public.task_watchers;
create policy task_watchers_select
  on public.task_watchers
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id = auth.uid()
      or public.can_access_task_base(task_id)
    )
  );

drop policy if exists task_watchers_insert on public.task_watchers;
create policy task_watchers_insert
  on public.task_watchers
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.can_access_task_base(task_id)
    )
  );

drop policy if exists task_watchers_delete on public.task_watchers;
create policy task_watchers_delete
  on public.task_watchers
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id = auth.uid()
      or public.can_access_task_base(task_id)
    )
  );

grant select, insert, delete on public.task_watchers to authenticated;

-- Project watchers RLS
drop policy if exists project_watchers_select on public.project_watchers;
create policy project_watchers_select
  on public.project_watchers
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id = auth.uid()
      or public.can_access_project_base(project_id)
    )
  );

drop policy if exists project_watchers_insert on public.project_watchers;
create policy project_watchers_insert
  on public.project_watchers
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.can_access_project_base(project_id)
    )
  );

drop policy if exists project_watchers_delete on public.project_watchers;
create policy project_watchers_delete
  on public.project_watchers
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id = auth.uid()
      or public.can_access_project_base(project_id)
    )
  );

grant select, insert, delete on public.project_watchers to authenticated;

-- Update core table RLS so watchers gain view/edit.

-- Projects: include watchers.
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
      or exists (
        select 1
        from public.project_watchers pw
        where pw.project_id = public.projects.id
          and pw.user_id = auth.uid()
      )
    )
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
    or exists (
      select 1
      from public.project_watchers pw
      where pw.project_id = public.projects.id
        and pw.user_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or public.is_project_member(id)
    or public.can_access_client(client_id)
    or created_by_user_id = auth.uid()
    or exists (
      select 1
      from public.project_watchers pw
      where pw.project_id = public.projects.id
        and pw.user_id = auth.uid()
    )
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
    or exists (
      select 1
      from public.project_watchers pw
      where pw.project_id = public.projects.id
        and pw.user_id = auth.uid()
    )
  );

-- Tasks: include watchers and project watchers.
alter table public.tasks enable row level security;

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
        where ta.task_id = public.tasks.id
          and ta.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.task_watchers tw
        where tw.task_id = public.tasks.id
          and tw.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.project_watchers pw
        where pw.project_id = public.tasks.project_id
          and pw.user_id = auth.uid()
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
        where ta.task_id = public.tasks.id
          and ta.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.task_watchers tw
        where tw.task_id = public.tasks.id
          and tw.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.project_watchers pw
        where pw.project_id = public.tasks.project_id
          and pw.user_id = auth.uid()
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
        where ta.task_id = public.tasks.id
          and ta.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.task_watchers tw
        where tw.task_id = public.tasks.id
          and tw.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.project_watchers pw
        where pw.project_id = public.tasks.project_id
          and pw.user_id = auth.uid()
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
        where ta.task_id = public.tasks.id
          and ta.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.task_watchers tw
        where tw.task_id = public.tasks.id
          and tw.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.project_watchers pw
        where pw.project_id = public.tasks.project_id
          and pw.user_id = auth.uid()
      )
      or ((project_id is null) and (created_by_user_id = auth.uid()))
    )
  );

-- Task assignees: include watchers as editors.
alter table public.task_assignees enable row level security;

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
      or exists (
        select 1
        from public.task_watchers tw
        where tw.task_id = public.task_assignees.task_id
          and tw.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.tasks t
        join public.project_watchers pw on pw.project_id = t.project_id
        where t.id = public.task_assignees.task_id
          and pw.user_id = auth.uid()
      )
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
    or exists (
      select 1
      from public.task_watchers tw
      where tw.task_id = public.task_assignees.task_id
        and tw.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.tasks t
      join public.project_watchers pw on pw.project_id = t.project_id
      where t.id = public.task_assignees.task_id
        and pw.user_id = auth.uid()
    )
    or (
      select (t.project_id is null and t.created_by_user_id = auth.uid())
      from public.tasks t
      where t.id = public.task_assignees.task_id
    )
  );
