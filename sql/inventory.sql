-- Inventory table with dynamic columns.
-- Run after:
--   sql/employee_info.sql
--   sql/permissions_admin_member.sql

create table if not exists public.inventory_records (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  client_id uuid references public.clients(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_records_full_name_not_blank check (length(trim(full_name)) > 0)
);

create index if not exists inventory_records_client_created_idx
  on public.inventory_records(client_id, created_at desc);

create table if not exists public.inventory_columns (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  column_kind text not null check (column_kind in ('text', 'dropdown', 'formula', 'number', 'date', 'currency')),
  formula text,
  formula_currency_mode text not null default 'display'
    check (formula_currency_mode in ('display', 'fixed')),
  formula_currency_code text not null default 'USD'
    check (formula_currency_code in ('USD', 'GBP', 'MUR')),
  options_json jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_columns_key_not_blank check (length(trim(key)) > 0),
  constraint inventory_columns_label_not_blank check (length(trim(label)) > 0)
);

create index if not exists inventory_columns_position_idx
  on public.inventory_columns(position, created_at);

create table if not exists public.inventory_values (
  record_id uuid not null references public.inventory_records(id) on delete cascade,
  column_id uuid not null references public.inventory_columns(id) on delete cascade,
  text_value text,
  option_value text,
  money_currency_code text check (money_currency_code in ('USD', 'GBP', 'MUR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (record_id, column_id),
  constraint inventory_values_has_value
    check (
      (text_value is not null and option_value is null)
      or (text_value is null and option_value is not null)
    )
);

create index if not exists inventory_values_record_idx
  on public.inventory_values(record_id);

create index if not exists inventory_values_column_idx
  on public.inventory_values(column_id);

create or replace function public.can_access_inventory()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_view_page('inventory');
$$;

grant execute on function public.can_access_inventory() to anon, authenticated;

create or replace function public.can_manage_inventory_columns()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_edit_page('inventory');
$$;

grant execute on function public.can_manage_inventory_columns() to anon, authenticated;

alter table public.inventory_records enable row level security;
alter table public.inventory_columns enable row level security;
alter table public.inventory_values enable row level security;

drop policy if exists inventory_records_select on public.inventory_records;
create policy inventory_records_select
  on public.inventory_records
  for select
  to authenticated
  using (public.can_access_inventory());

drop policy if exists inventory_records_insert on public.inventory_records;
create policy inventory_records_insert
  on public.inventory_records
  for insert
  to authenticated
  with check (public.can_access_inventory());

drop policy if exists inventory_records_update on public.inventory_records;
create policy inventory_records_update
  on public.inventory_records
  for update
  to authenticated
  using (public.can_access_inventory())
  with check (public.can_access_inventory());

drop policy if exists inventory_records_delete on public.inventory_records;
create policy inventory_records_delete
  on public.inventory_records
  for delete
  to authenticated
  using (public.can_access_inventory());

drop policy if exists inventory_columns_select on public.inventory_columns;
create policy inventory_columns_select
  on public.inventory_columns
  for select
  to authenticated
  using (public.can_access_inventory());

drop policy if exists inventory_columns_insert on public.inventory_columns;
create policy inventory_columns_insert
  on public.inventory_columns
  for insert
  to authenticated
  with check (public.can_manage_inventory_columns());

drop policy if exists inventory_columns_update on public.inventory_columns;
create policy inventory_columns_update
  on public.inventory_columns
  for update
  to authenticated
  using (public.can_manage_inventory_columns())
  with check (public.can_manage_inventory_columns());

drop policy if exists inventory_columns_delete on public.inventory_columns;
create policy inventory_columns_delete
  on public.inventory_columns
  for delete
  to authenticated
  using (public.can_manage_inventory_columns());

drop policy if exists inventory_values_select on public.inventory_values;
create policy inventory_values_select
  on public.inventory_values
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.inventory_records r
      where r.id = inventory_values.record_id
        and public.can_access_inventory()
    )
  );

drop policy if exists inventory_values_insert on public.inventory_values;
create policy inventory_values_insert
  on public.inventory_values
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.inventory_records r
      where r.id = inventory_values.record_id
        and public.can_access_inventory()
    )
  );

drop policy if exists inventory_values_update on public.inventory_values;
create policy inventory_values_update
  on public.inventory_values
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.inventory_records r
      where r.id = inventory_values.record_id
        and public.can_access_inventory()
    )
  )
  with check (
    exists (
      select 1
      from public.inventory_records r
      where r.id = inventory_values.record_id
        and public.can_access_inventory()
    )
  );

drop policy if exists inventory_values_delete on public.inventory_values;
create policy inventory_values_delete
  on public.inventory_values
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.inventory_records r
      where r.id = inventory_values.record_id
        and public.can_access_inventory()
    )
  );

grant select, insert, update, delete on table public.inventory_records to authenticated;
grant select, insert, update, delete on table public.inventory_columns to authenticated;
grant select, insert, update, delete on table public.inventory_values to authenticated;
