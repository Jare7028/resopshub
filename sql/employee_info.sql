-- Employee info table with dynamic columns.
-- Run after:
--   sql/rls_identity_fix.sql

create table if not exists public.employee_info_records (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  client_id uuid references public.clients(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_info_records_full_name_not_blank check (length(trim(full_name)) > 0)
);

create index if not exists employee_info_records_client_created_idx
  on public.employee_info_records(client_id, created_at desc);

create table if not exists public.employee_info_columns (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  column_kind text not null check (column_kind in ('text', 'dropdown', 'formula', 'number')),
  formula text,
  options_json jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_info_columns_key_not_blank check (length(trim(key)) > 0),
  constraint employee_info_columns_label_not_blank check (length(trim(label)) > 0)
);

create index if not exists employee_info_columns_position_idx
  on public.employee_info_columns(position, created_at);

create table if not exists public.employee_info_values (
  record_id uuid not null references public.employee_info_records(id) on delete cascade,
  column_id uuid not null references public.employee_info_columns(id) on delete cascade,
  text_value text,
  option_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (record_id, column_id),
  constraint employee_info_values_has_value
    check (
      (text_value is not null and option_value is null)
      or (text_value is null and option_value is not null)
    )
);

create index if not exists employee_info_values_record_idx
  on public.employee_info_values(record_id);

create index if not exists employee_info_values_column_idx
  on public.employee_info_values(column_id);

create table if not exists public.employee_info_access_users (
  user_id uuid primary key references public.users(id) on delete cascade,
  added_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

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
      or exists (
        select 1
        from public.employee_info_access_users eau
        where eau.user_id = public.current_app_user_id()
      )
    );
$$;

grant execute on function public.can_access_employee_info() to anon, authenticated;

alter table public.employee_info_records enable row level security;
alter table public.employee_info_columns enable row level security;
alter table public.employee_info_values enable row level security;
alter table public.employee_info_access_users enable row level security;

drop policy if exists employee_info_records_select on public.employee_info_records;
create policy employee_info_records_select
  on public.employee_info_records
  for select
  to authenticated
  using (public.can_access_employee_info());

drop policy if exists employee_info_records_insert on public.employee_info_records;
create policy employee_info_records_insert
  on public.employee_info_records
  for insert
  to authenticated
  with check (public.can_access_employee_info());

drop policy if exists employee_info_records_update on public.employee_info_records;
create policy employee_info_records_update
  on public.employee_info_records
  for update
  to authenticated
  using (public.can_access_employee_info())
  with check (public.can_access_employee_info());

drop policy if exists employee_info_records_delete on public.employee_info_records;
create policy employee_info_records_delete
  on public.employee_info_records
  for delete
  to authenticated
  using (public.can_access_employee_info());

drop policy if exists employee_info_columns_select on public.employee_info_columns;
create policy employee_info_columns_select
  on public.employee_info_columns
  for select
  to authenticated
  using (public.can_access_employee_info());

drop policy if exists employee_info_columns_insert on public.employee_info_columns;
create policy employee_info_columns_insert
  on public.employee_info_columns
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists employee_info_columns_update on public.employee_info_columns;
create policy employee_info_columns_update
  on public.employee_info_columns
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists employee_info_columns_delete on public.employee_info_columns;
create policy employee_info_columns_delete
  on public.employee_info_columns
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists employee_info_values_select on public.employee_info_values;
create policy employee_info_values_select
  on public.employee_info_values
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.employee_info_records r
      where r.id = employee_info_values.record_id
        and public.can_access_employee_info()
    )
  );

drop policy if exists employee_info_values_insert on public.employee_info_values;
create policy employee_info_values_insert
  on public.employee_info_values
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.employee_info_records r
      where r.id = employee_info_values.record_id
        and public.can_access_employee_info()
    )
  );

drop policy if exists employee_info_values_update on public.employee_info_values;
create policy employee_info_values_update
  on public.employee_info_values
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.employee_info_records r
      where r.id = employee_info_values.record_id
        and public.can_access_employee_info()
    )
  )
  with check (
    exists (
      select 1
      from public.employee_info_records r
      where r.id = employee_info_values.record_id
        and public.can_access_employee_info()
    )
  );

drop policy if exists employee_info_values_delete on public.employee_info_values;
create policy employee_info_values_delete
  on public.employee_info_values
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.employee_info_records r
      where r.id = employee_info_values.record_id
        and public.can_access_employee_info()
    )
  );

drop policy if exists employee_info_access_users_select on public.employee_info_access_users;
create policy employee_info_access_users_select
  on public.employee_info_access_users
  for select
  to authenticated
  using (public.can_access_employee_info());

drop policy if exists employee_info_access_users_insert on public.employee_info_access_users;
create policy employee_info_access_users_insert
  on public.employee_info_access_users
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists employee_info_access_users_delete on public.employee_info_access_users;
create policy employee_info_access_users_delete
  on public.employee_info_access_users
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on table public.employee_info_records to authenticated;
grant select, insert, update, delete on table public.employee_info_columns to authenticated;
grant select, insert, update, delete on table public.employee_info_values to authenticated;
grant select, insert, delete on table public.employee_info_access_users to authenticated;
