-- Employee payroll source data and permissions.
-- Apply in Supabase SQL editor.

create table if not exists public.employee_payroll_columns (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  kind text not null check (kind in ('number', 'formula')),
  formula text,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_payroll_columns_formula_required_check
    check (
      (kind = 'formula' and formula is not null and length(trim(formula)) > 0)
      or (kind = 'number' and formula is null)
    )
);

create unique index if not exists employee_payroll_columns_position_uidx
  on public.employee_payroll_columns(position);

create table if not exists public.employee_payroll_rows (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_payroll_rows_client_id_idx
  on public.employee_payroll_rows(client_id);

create index if not exists employee_payroll_rows_created_by_user_id_idx
  on public.employee_payroll_rows(created_by_user_id);

create table if not exists public.employee_payroll_row_users (
  row_id uuid not null references public.employee_payroll_rows(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (row_id, user_id)
);

create index if not exists employee_payroll_row_users_user_id_idx
  on public.employee_payroll_row_users(user_id);

create table if not exists public.employee_payroll_cell_values (
  row_id uuid not null references public.employee_payroll_rows(id) on delete cascade,
  column_id uuid not null references public.employee_payroll_columns(id) on delete cascade,
  number_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (row_id, column_id)
);

create index if not exists employee_payroll_cell_values_column_id_idx
  on public.employee_payroll_cell_values(column_id);

create or replace function public.can_access_employee_payroll()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and coalesce(u.status, 'active') <> 'disabled'
      and u.role in ('admin', 'ops', 'manager')
  );
$$;

grant execute on function public.can_access_employee_payroll() to anon, authenticated;

create or replace function public.can_view_employee_payroll_row(row_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.employee_payroll_rows r
      where r.id = row_uuid
        and r.created_by_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.employee_payroll_row_users ru
      where ru.row_id = row_uuid
        and ru.user_id = auth.uid()
    )
  );
$$;

grant execute on function public.can_view_employee_payroll_row(uuid) to anon, authenticated;

create or replace function public.can_edit_employee_payroll_row(row_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.employee_payroll_rows r
      where r.id = row_uuid
        and r.created_by_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.employee_payroll_row_users ru
      where ru.row_id = row_uuid
        and ru.user_id = auth.uid()
        and ru.role in ('owner', 'editor')
    )
  );
$$;

grant execute on function public.can_edit_employee_payroll_row(uuid) to anon, authenticated;

alter table public.employee_payroll_columns enable row level security;
alter table public.employee_payroll_rows enable row level security;
alter table public.employee_payroll_row_users enable row level security;
alter table public.employee_payroll_cell_values enable row level security;

drop policy if exists employee_payroll_columns_select on public.employee_payroll_columns;
create policy employee_payroll_columns_select
  on public.employee_payroll_columns
  for select
  to authenticated
  using (public.can_access_employee_payroll());

drop policy if exists employee_payroll_columns_insert on public.employee_payroll_columns;
create policy employee_payroll_columns_insert
  on public.employee_payroll_columns
  for insert
  to authenticated
  with check (public.can_access_employee_payroll());

drop policy if exists employee_payroll_columns_update on public.employee_payroll_columns;
create policy employee_payroll_columns_update
  on public.employee_payroll_columns
  for update
  to authenticated
  using (public.can_access_employee_payroll())
  with check (public.can_access_employee_payroll());

drop policy if exists employee_payroll_columns_delete on public.employee_payroll_columns;
create policy employee_payroll_columns_delete
  on public.employee_payroll_columns
  for delete
  to authenticated
  using (public.can_access_employee_payroll());

drop policy if exists employee_payroll_rows_select on public.employee_payroll_rows;
create policy employee_payroll_rows_select
  on public.employee_payroll_rows
  for select
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_view_employee_payroll_row(id)
  );

drop policy if exists employee_payroll_rows_insert on public.employee_payroll_rows;
create policy employee_payroll_rows_insert
  on public.employee_payroll_rows
  for insert
  to authenticated
  with check (
    public.can_access_employee_payroll()
    and auth.uid() is not null
    and created_by_user_id = auth.uid()
  );

drop policy if exists employee_payroll_rows_update on public.employee_payroll_rows;
create policy employee_payroll_rows_update
  on public.employee_payroll_rows
  for update
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(id)
  )
  with check (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(id)
  );

drop policy if exists employee_payroll_rows_delete on public.employee_payroll_rows;
create policy employee_payroll_rows_delete
  on public.employee_payroll_rows
  for delete
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(id)
  );

drop policy if exists employee_payroll_row_users_select on public.employee_payroll_row_users;
create policy employee_payroll_row_users_select
  on public.employee_payroll_row_users
  for select
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_view_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_row_users_insert on public.employee_payroll_row_users;
create policy employee_payroll_row_users_insert
  on public.employee_payroll_row_users
  for insert
  to authenticated
  with check (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_row_users_update on public.employee_payroll_row_users;
create policy employee_payroll_row_users_update
  on public.employee_payroll_row_users
  for update
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  )
  with check (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_row_users_delete on public.employee_payroll_row_users;
create policy employee_payroll_row_users_delete
  on public.employee_payroll_row_users
  for delete
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_cell_values_select on public.employee_payroll_cell_values;
create policy employee_payroll_cell_values_select
  on public.employee_payroll_cell_values
  for select
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_view_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_cell_values_insert on public.employee_payroll_cell_values;
create policy employee_payroll_cell_values_insert
  on public.employee_payroll_cell_values
  for insert
  to authenticated
  with check (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_cell_values_update on public.employee_payroll_cell_values;
create policy employee_payroll_cell_values_update
  on public.employee_payroll_cell_values
  for update
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  )
  with check (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

drop policy if exists employee_payroll_cell_values_delete on public.employee_payroll_cell_values;
create policy employee_payroll_cell_values_delete
  on public.employee_payroll_cell_values
  for delete
  to authenticated
  using (
    public.can_access_employee_payroll()
    and public.can_edit_employee_payroll_row(row_id)
  );

grant select, insert, update, delete on table public.employee_payroll_columns to authenticated;
grant select, insert, update, delete on table public.employee_payroll_rows to authenticated;
grant select, insert, update, delete on table public.employee_payroll_row_users to authenticated;
grant select, insert, update, delete on table public.employee_payroll_cell_values to authenticated;
