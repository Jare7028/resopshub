-- Replace legacy multi-role model with admin/member + granular permission grants.
-- Run after:
--   sql/rls_identity_fix.sql
--   sql/client_users.sql
--   sql/employee_info.sql

-- 1) Normalize roles to admin/member only.
do $$
declare
  role_constraint record;
  role_column_type text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role'
  ) then
    select format('%I.%I', c.udt_schema, c.udt_name)
    into role_column_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'users'
      and c.column_name = 'role';

    execute format(
      $sql$
      update public.users
      set role = case
        when role::text = 'admin' then %L::%s
        else %L::%s
      end
      $sql$,
      'admin',
      role_column_type,
      'member',
      role_column_type
    );

    execute format(
      'alter table public.users alter column role set default %L::%s',
      'member',
      role_column_type
    );

    alter table public.users
      alter column role set not null;

    for role_constraint in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'users'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%role%'
    loop
      execute format('alter table public.users drop constraint if exists %I', role_constraint.conname);
    end loop;

    alter table public.users
      add constraint users_role_check
      check (role::text in ('admin', 'member'));
  end if;
end
$$;

-- 2) Permission catalog.
create table if not exists public.permission_definitions (
  key text primary key,
  label text not null,
  description text,
  scope_type text not null default 'global',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permission_definitions_key_not_blank
    check (length(trim(key)) > 0),
  constraint permission_definitions_scope_type_check
    check (scope_type in ('global', 'client', 'project', 'task'))
);

create index if not exists permission_definitions_scope_idx
  on public.permission_definitions(scope_type, key);

insert into public.permission_definitions (key, label, description, scope_type)
values
  ('workspace.manage_users', 'Manage Users', 'Create/update/delete users and grants.', 'global'),
  ('workspace.manage_settings', 'Manage Workspace Settings', 'Update global workspace configuration.', 'global'),
  ('clients.view', 'View Client', 'View a specific client and client-level data.', 'client'),
  ('clients.edit', 'Edit Client', 'Edit client details and client-level settings.', 'client'),
  ('projects.create', 'Create Projects', 'Create projects under a client.', 'client'),
  ('projects.edit', 'Edit Projects', 'Edit an existing project.', 'project'),
  ('projects.delete', 'Delete Projects', 'Delete an existing project.', 'project'),
  ('tasks.create', 'Create Tasks', 'Create tasks under a client/project.', 'client'),
  ('tasks.edit', 'Edit Tasks', 'Edit task content and assignees.', 'task'),
  ('tasks.delete', 'Delete Tasks', 'Delete task records.', 'task'),
  ('employee_info.access', 'Employee Info Access', 'View and edit employee info records/values.', 'global'),
  ('employee_info.manage_columns', 'Employee Info Manage Columns', 'Create/reorder/update/delete employee info columns.', 'global'),
  ('employee_info.manage_access', 'Employee Info Manage Access', 'Manage employee info access-user list.', 'global'),
  ('employee_info.manage_fx', 'Employee Info Manage FX', 'Manage employee info exchange rates.', 'global'),
  ('billing.view', 'View Billing', 'View client billing data.', 'client'),
  ('billing.edit', 'Edit Billing', 'Edit client billing data.', 'client')
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  scope_type = excluded.scope_type,
  updated_at = now();

-- 3) Per-user grants with optional scope.
create table if not exists public.user_permission_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  permission_key text not null references public.permission_definitions(key) on delete cascade,
  scope_type text not null default 'global',
  scope_id uuid,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_permission_grants_scope_type_check
    check (scope_type in ('global', 'client', 'project', 'task')),
  constraint user_permission_grants_scope_presence_check
    check (
      (scope_type = 'global' and scope_id is null)
      or (scope_type <> 'global' and scope_id is not null)
    )
);

create unique index if not exists user_permission_grants_unique_scope_idx
  on public.user_permission_grants (
    user_id,
    permission_key,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists user_permission_grants_user_lookup_idx
  on public.user_permission_grants(user_id, permission_key);

create index if not exists user_permission_grants_scope_lookup_idx
  on public.user_permission_grants(scope_type, scope_id, permission_key);

do $$
begin
  if to_regclass('public.user_permission_grants') is not null
     and to_regclass('public.employee_info_access_users') is not null then
    insert into public.user_permission_grants (
      user_id,
      permission_key,
      scope_type,
      scope_id,
      created_by_user_id
    )
    select
      eau.user_id,
      'employee_info.access',
      'global',
      null,
      eau.added_by_user_id
    from public.employee_info_access_users eau
    on conflict do nothing;
  end if;
end
$$;

-- Bootstrap billing grants from existing client access relationships so rollout is non-breaking.
-- This mirrors existing edit visibility where client membership generally implies billing access.
do $$
begin
  if to_regclass('public.user_permission_grants') is not null
     and to_regclass('public.clients') is not null
     and to_regclass('public.client_users') is not null
     and to_regclass('public.project_users') is not null
     and to_regclass('public.projects') is not null then
    insert into public.user_permission_grants (
      user_id,
      permission_key,
      scope_type,
      scope_id,
      created_by_user_id
    )
    select distinct
      seed.user_id,
      'billing.view',
      'client',
      seed.client_id,
      seed.created_by_user_id
    from (
      select c.created_by_user_id as user_id, c.id as client_id, c.created_by_user_id
      from public.clients c
      where c.created_by_user_id is not null
      union all
      select cu.user_id, cu.client_id, null::uuid
      from public.client_users cu
      where cu.user_id is not null
      union all
      select pu.user_id, p.client_id, null::uuid
      from public.project_users pu
      join public.projects p on p.id = pu.project_id
      where pu.user_id is not null
        and p.client_id is not null
    ) as seed
    where seed.user_id is not null
      and seed.client_id is not null
    on conflict do nothing;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.user_permission_grants') is not null
     and to_regclass('public.clients') is not null
     and to_regclass('public.client_users') is not null
     and to_regclass('public.project_users') is not null
     and to_regclass('public.projects') is not null then
    insert into public.user_permission_grants (
      user_id,
      permission_key,
      scope_type,
      scope_id,
      created_by_user_id
    )
    select distinct
      seed.user_id,
      'billing.edit',
      'client',
      seed.client_id,
      seed.created_by_user_id
    from (
      select c.created_by_user_id as user_id, c.id as client_id, c.created_by_user_id
      from public.clients c
      where c.created_by_user_id is not null
      union all
      select cu.user_id, cu.client_id, null::uuid
      from public.client_users cu
      where cu.user_id is not null
      union all
      select pu.user_id, p.client_id, null::uuid
      from public.project_users pu
      join public.projects p on p.id = pu.project_id
      where pu.user_id is not null
        and p.client_id is not null
    ) as seed
    where seed.user_id is not null
      and seed.client_id is not null
    on conflict do nothing;
  end if;
end
$$;

-- 4) Permission resolver (admin always passes).
create or replace function public.has_permission(
  p_permission_key text,
  p_scope_type text default 'global',
  p_scope_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as app_user_id
  ),
  scope_client as (
    select case
      when p_scope_type = 'client' then p_scope_id
      when p_scope_type = 'project' then (
        select p.client_id
        from public.projects p
        where p.id = p_scope_id
      )
      when p_scope_type = 'task' then (
        select coalesce(t.client_id, p.client_id)
        from public.tasks t
        left join public.projects p on p.id = t.project_id
        where t.id = p_scope_id
      )
      else null::uuid
    end as client_id
  )
  select auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_permission_grants g
        cross join me
        cross join scope_client sc
        where g.user_id = me.app_user_id
          and g.permission_key = p_permission_key
          and (
            (g.scope_type = 'global' and g.scope_id is null)
            or (g.scope_type = p_scope_type and g.scope_id = p_scope_id)
            or (
              p_scope_type in ('project', 'task')
              and sc.client_id is not null
              and g.scope_type = 'client'
              and g.scope_id = sc.client_id
            )
          )
      )
    );
$$;

grant execute on function public.has_permission(text, text, uuid) to anon, authenticated;

-- 5) Hook Employee Info access into new grants while preserving legacy access list.
create or replace function public.can_access_employee_info()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('employee_info.access')
      or exists (
        select 1
        from public.employee_info_access_users eau
        where eau.user_id = public.current_app_user_id()
      )
    );
$$;

grant execute on function public.can_access_employee_info() to anon, authenticated;

create or replace function public.can_manage_employee_info_columns()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('employee_info.manage_columns')
    );
$$;

create or replace function public.can_manage_employee_info_access()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('employee_info.manage_access')
    );
$$;

create or replace function public.can_manage_employee_info_fx()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('employee_info.manage_fx')
    );
$$;

grant execute on function public.can_manage_employee_info_columns() to anon, authenticated;
grant execute on function public.can_manage_employee_info_access() to anon, authenticated;
grant execute on function public.can_manage_employee_info_fx() to anon, authenticated;

do $$
begin
  if to_regclass('public.employee_info_columns') is not null then
    execute 'drop policy if exists employee_info_columns_insert on public.employee_info_columns';
    execute 'create policy employee_info_columns_insert
      on public.employee_info_columns
      for insert
      to authenticated
      with check (public.can_manage_employee_info_columns())';

    execute 'drop policy if exists employee_info_columns_update on public.employee_info_columns';
    execute 'create policy employee_info_columns_update
      on public.employee_info_columns
      for update
      to authenticated
      using (public.can_manage_employee_info_columns())
      with check (public.can_manage_employee_info_columns())';

    execute 'drop policy if exists employee_info_columns_delete on public.employee_info_columns';
    execute 'create policy employee_info_columns_delete
      on public.employee_info_columns
      for delete
      to authenticated
      using (public.can_manage_employee_info_columns())';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.employee_info_access_users') is not null then
    execute 'drop policy if exists employee_info_access_users_insert on public.employee_info_access_users';
    execute 'create policy employee_info_access_users_insert
      on public.employee_info_access_users
      for insert
      to authenticated
      with check (public.can_manage_employee_info_access())';

    execute 'drop policy if exists employee_info_access_users_delete on public.employee_info_access_users';
    execute 'create policy employee_info_access_users_delete
      on public.employee_info_access_users
      for delete
      to authenticated
      using (public.can_manage_employee_info_access())';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.employee_info_exchange_rates') is not null then
    execute 'drop policy if exists employee_info_exchange_rates_insert on public.employee_info_exchange_rates';
    execute 'create policy employee_info_exchange_rates_insert
      on public.employee_info_exchange_rates
      for insert
      to authenticated
      with check (public.can_manage_employee_info_fx())';

    execute 'drop policy if exists employee_info_exchange_rates_update on public.employee_info_exchange_rates';
    execute 'create policy employee_info_exchange_rates_update
      on public.employee_info_exchange_rates
      for update
      to authenticated
      using (public.can_manage_employee_info_fx())
      with check (public.can_manage_employee_info_fx())';

    execute 'drop policy if exists employee_info_exchange_rates_delete on public.employee_info_exchange_rates';
    execute 'create policy employee_info_exchange_rates_delete
      on public.employee_info_exchange_rates
      for delete
      to authenticated
      using (public.can_manage_employee_info_fx())';
  end if;
end
$$;

create or replace function public.can_view_client_billing(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('billing.view', 'client', client_uuid)
      or public.has_permission('billing.edit', 'client', client_uuid)
    );
$$;

create or replace function public.can_edit_client_billing(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or public.has_permission('billing.edit', 'client', client_uuid)
    );
$$;

grant execute on function public.can_view_client_billing(uuid) to anon, authenticated;
grant execute on function public.can_edit_client_billing(uuid) to anon, authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'billing_profiles'
  ) then
    execute 'alter table public.billing_profiles enable row level security';

    execute 'drop policy if exists billing_profiles_select on public.billing_profiles';
    execute 'create policy billing_profiles_select
      on public.billing_profiles
      for select
      to authenticated
      using (public.can_view_client_billing(client_id))';

    execute 'drop policy if exists billing_profiles_insert on public.billing_profiles';
    execute 'create policy billing_profiles_insert
      on public.billing_profiles
      for insert
      to authenticated
      with check (public.can_edit_client_billing(client_id))';

    execute 'drop policy if exists billing_profiles_update on public.billing_profiles';
    execute 'create policy billing_profiles_update
      on public.billing_profiles
      for update
      to authenticated
      using (public.can_edit_client_billing(client_id))
      with check (public.can_edit_client_billing(client_id))';

    execute 'drop policy if exists billing_profiles_delete on public.billing_profiles';
    execute 'create policy billing_profiles_delete
      on public.billing_profiles
      for delete
      to authenticated
      using (public.can_edit_client_billing(client_id))';

    execute 'grant select, insert, update, delete on table public.billing_profiles to authenticated';
  end if;
end
$$;

-- 6) RLS for permission tables.
alter table public.permission_definitions enable row level security;
alter table public.user_permission_grants enable row level security;

drop policy if exists permission_definitions_select on public.permission_definitions;
create policy permission_definitions_select
  on public.permission_definitions
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists permission_definitions_insert on public.permission_definitions;
create policy permission_definitions_insert
  on public.permission_definitions
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists permission_definitions_update on public.permission_definitions;
create policy permission_definitions_update
  on public.permission_definitions
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists permission_definitions_delete on public.permission_definitions;
create policy permission_definitions_delete
  on public.permission_definitions
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists user_permission_grants_select on public.user_permission_grants;
create policy user_permission_grants_select
  on public.user_permission_grants
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id = public.current_app_user_id()
    )
  );

drop policy if exists user_permission_grants_insert on public.user_permission_grants;
create policy user_permission_grants_insert
  on public.user_permission_grants
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists user_permission_grants_update on public.user_permission_grants;
create policy user_permission_grants_update
  on public.user_permission_grants
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_permission_grants_delete on public.user_permission_grants;
create policy user_permission_grants_delete
  on public.user_permission_grants
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on table public.permission_definitions to authenticated;
grant select, insert, update, delete on table public.user_permission_grants to authenticated;

-- Example grants (run separately as needed):
-- 1) Global employee info access for one member:
-- insert into public.user_permission_grants (user_id, permission_key, scope_type, scope_id, created_by_user_id)
-- values ('<member_user_uuid>', 'employee_info.access', 'global', null, public.current_app_user_id());
--
-- 2) Client-scoped billing edit permission:
-- insert into public.user_permission_grants (user_id, permission_key, scope_type, scope_id, created_by_user_id)
-- values ('<member_user_uuid>', 'billing.edit', 'client', '<client_uuid>', public.current_app_user_id());
