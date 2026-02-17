-- Add per-cell currency storage, formula currency controls, and monthly FX rates for Employee Info.
-- Run after:
--   sql/employee_info.sql

alter table public.employee_info_columns
  add column if not exists formula_currency_mode text not null default 'display';

alter table public.employee_info_columns
  add column if not exists formula_currency_code text not null default 'USD';

alter table public.employee_info_columns
  drop constraint if exists employee_info_columns_formula_currency_mode_check;

alter table public.employee_info_columns
  add constraint employee_info_columns_formula_currency_mode_check
  check (formula_currency_mode in ('display', 'fixed'));

alter table public.employee_info_columns
  drop constraint if exists employee_info_columns_formula_currency_code_check;

alter table public.employee_info_columns
  add constraint employee_info_columns_formula_currency_code_check
  check (formula_currency_code in ('USD', 'GBP', 'MUR'));

alter table public.employee_info_values
  add column if not exists money_currency_code text;

alter table public.employee_info_values
  drop constraint if exists employee_info_values_money_currency_code_check;

alter table public.employee_info_values
  add constraint employee_info_values_money_currency_code_check
  check (money_currency_code in ('USD', 'GBP', 'MUR'));

create table if not exists public.employee_info_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency_code text not null check (base_currency_code in ('USD', 'GBP', 'MUR')),
  quote_currency_code text not null check (quote_currency_code in ('USD', 'GBP', 'MUR')),
  rate numeric(18,8) not null check (rate > 0),
  effective_month_start date not null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_info_exchange_rates_pair_not_same
    check (base_currency_code <> quote_currency_code),
  constraint employee_info_exchange_rates_unique_pair_month
    unique (base_currency_code, quote_currency_code, effective_month_start)
);

create index if not exists employee_info_exchange_rates_effective_month_idx
  on public.employee_info_exchange_rates(effective_month_start desc, base_currency_code, quote_currency_code);

alter table public.employee_info_exchange_rates enable row level security;

drop policy if exists employee_info_exchange_rates_select on public.employee_info_exchange_rates;
create policy employee_info_exchange_rates_select
  on public.employee_info_exchange_rates
  for select
  to authenticated
  using (public.can_access_employee_info());

drop policy if exists employee_info_exchange_rates_insert on public.employee_info_exchange_rates;
create policy employee_info_exchange_rates_insert
  on public.employee_info_exchange_rates
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists employee_info_exchange_rates_update on public.employee_info_exchange_rates;
create policy employee_info_exchange_rates_update
  on public.employee_info_exchange_rates
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists employee_info_exchange_rates_delete on public.employee_info_exchange_rates;
create policy employee_info_exchange_rates_delete
  on public.employee_info_exchange_rates
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on table public.employee_info_exchange_rates to authenticated;
