-- Fix: infinite recursion detected in policy for relation "task_watchers" / "project_watchers".
--
-- Root cause: RLS policies were selecting from the same table they protect (self-referential
-- EXISTS queries), which Postgres detects as infinite recursion.
--
-- This patch removes self-referential subqueries and replaces watcher INSERT/DELETE checks
-- with calls to existing SECURITY DEFINER "base access" helpers.

-- Base project access (does not consider watchers).
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

grant execute on function public.can_access_project_base(uuid) to anon, authenticated;

-- Task watchers RLS (no self-referential subqueries).
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

-- Project watchers RLS (no self-referential subqueries).
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

