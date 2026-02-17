-- Per-user Employee Info visibility rules (client + role scoped).
-- Run after:
--   sql/employee_info.sql
--   sql/permissions_admin_member.sql

create table if not exists public.employee_info_visibility_rules (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default false,
  allowed_client_ids uuid[] not null default '{}'::uuid[],
  role_column_id uuid references public.employee_info_columns(id) on delete set null,
  allowed_role_values text[] not null default '{}'::text[],
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_info_visibility_rules_allowed_role_values_no_empty
    check (array_position(allowed_role_values, '') is null)
);

drop trigger if exists trg_employee_info_visibility_rules_updated_at
  on public.employee_info_visibility_rules;
create trigger trg_employee_info_visibility_rules_updated_at
before update on public.employee_info_visibility_rules
for each row execute function public.set_updated_at();

create index if not exists idx_employee_info_visibility_rules_role_column_id
  on public.employee_info_visibility_rules(role_column_id);

alter table public.employee_info_visibility_rules enable row level security;

drop policy if exists employee_info_visibility_rules_select on public.employee_info_visibility_rules;
create policy employee_info_visibility_rules_select
  on public.employee_info_visibility_rules
  for select
  to authenticated
  using (
    public.can_manage_employee_info_access()
    or user_id = public.current_app_user_id()
  );

drop policy if exists employee_info_visibility_rules_insert on public.employee_info_visibility_rules;
create policy employee_info_visibility_rules_insert
  on public.employee_info_visibility_rules
  for insert
  to authenticated
  with check (public.can_manage_employee_info_access());

drop policy if exists employee_info_visibility_rules_update on public.employee_info_visibility_rules;
create policy employee_info_visibility_rules_update
  on public.employee_info_visibility_rules
  for update
  to authenticated
  using (public.can_manage_employee_info_access())
  with check (public.can_manage_employee_info_access());

drop policy if exists employee_info_visibility_rules_delete on public.employee_info_visibility_rules;
create policy employee_info_visibility_rules_delete
  on public.employee_info_visibility_rules
  for delete
  to authenticated
  using (public.can_manage_employee_info_access());

grant select, insert, update, delete
  on table public.employee_info_visibility_rules
  to authenticated;
