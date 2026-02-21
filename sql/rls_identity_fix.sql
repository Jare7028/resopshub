-- Fix RLS identity mismatch between Supabase Auth (auth.uid()) and app users (public.users.id).
-- The app frequently maps the logged-in user by email (auth.jwt()->>'email') to public.users.
-- Policies/functions should use that app user id for membership checks (project_users/client_users/etc).

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select u.id
  from public.users u
  where auth.uid() is not null
    and lower(u.email::text) = lower(
      coalesce(
        auth.email(),
        auth.jwt() ->> 'email',
        (
          select au.email
          from auth.users au
          where au.id = auth.uid()
          limit 1
        ),
        ''
      )
    )
  limit 1;
$$;

grant execute on function public.current_app_user_id() to anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and u.role = 'admin'
      and coalesce(u.status, 'active') <> 'disabled'
  );
$$;

create or replace function public.is_project_member(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.project_users pu
    where pu.project_id = project_uuid
      and pu.user_id = public.current_app_user_id()
  );
$$;

create or replace function public.is_project_creator(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = project_uuid
      and (
        p.created_by_user_id = auth.uid()
        or p.created_by_user_id = public.current_app_user_id()
      )
  );
$$;

-- Client access (base): use app user id for memberships and creator checks, with a safe fallback.
create or replace function public.can_access_client_base(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as app_uid, auth.uid() as auth_uid
  )
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.clients c, me
      where c.id = client_uuid
        and (c.created_by_user_id = me.app_uid or c.created_by_user_id = me.auth_uid)
    )
    or exists (
      select 1
      from public.client_users cu, me
      where cu.client_id = client_uuid
        and (cu.user_id = me.app_uid)
    )
    or exists (
      select 1
      from public.projects p
      join public.project_users pu on pu.project_id = p.id
      cross join me
      where p.client_id = client_uuid
        and pu.user_id = me.app_uid
    )
  );
$$;

create or replace function public.can_access_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and (
    public.can_access_client_base(client_uuid)
    or exists (
      select 1
      from public.projects p
      join public.project_watchers pw on pw.project_id = p.id
      cross join me
      where p.client_id = client_uuid
        and pw.user_id = me.app_uid
    )
    or exists (
      select 1
      from public.tasks t
      join public.task_watchers tw on tw.task_id = t.id
      cross join me
      where t.client_id = client_uuid
        and tw.user_id = me.app_uid
    )
    or exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      join public.task_watchers tw on tw.task_id = t.id
      cross join me
      where p.client_id = client_uuid
        and tw.user_id = me.app_uid
    )
  );
$$;

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
    left join public.project_users pu
      on pu.project_id = t.project_id and pu.user_id = (select app_uid from me)
    left join public.task_assignees ta
      on ta.task_id = t.id and ta.user_id = (select app_uid from me)
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or (t.client_id is not null and public.can_access_client_base(t.client_id))
        or pu.user_id is not null
        or t.assignee_user_id = (select app_uid from me)
        or ta.user_id is not null
        or (t.project_id is null and (t.created_by_user_id = (select app_uid from me) or t.created_by_user_id = (select auth_uid from me)))
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
    left join public.project_users pu
      on pu.project_id = t.project_id and pu.user_id = (select app_uid from me)
    left join public.task_assignees ta
      on ta.task_id = t.id and ta.user_id = (select app_uid from me)
    left join public.task_watchers tw
      on tw.task_id = t.id and tw.user_id = (select app_uid from me)
    left join public.project_watchers pw
      on pw.project_id = t.project_id and pw.user_id = (select app_uid from me)
    where t.id = task_uuid
      and auth.uid() is not null
      and (
        public.is_admin()
        or (t.client_id is not null and public.can_access_client(t.client_id))
        or pu.user_id is not null
        or t.assignee_user_id = (select app_uid from me)
        or ta.user_id is not null
        or tw.user_id is not null
        or pw.user_id is not null
        or (t.project_id is null and (t.created_by_user_id = (select app_uid from me) or t.created_by_user_id = (select auth_uid from me)))
      )
  );
$$;

-- Membership join tables: allow selecting your own rows via app user id.
drop policy if exists project_users_select on public.project_users;
create policy project_users_select
  on public.project_users
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.is_project_member(project_id)
      or user_id = public.current_app_user_id()
    )
  );

drop policy if exists client_users_select on public.client_users;
create policy client_users_select
  on public.client_users
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or public.can_access_client(client_id)
      or user_id = public.current_app_user_id()
    )
  );
