-- Performance improvements for clients + employee info hot paths.
-- Run after:
--   sql/rls_identity_fix.sql
--   sql/employee_info.sql

do $$
begin
  if to_regclass('public.users') is not null then
    execute 'create index if not exists users_email_lower_idx on public.users (lower(email))';
  end if;

  if to_regclass('public.clients') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'name'
    ) then
      execute 'create index if not exists clients_name_idx on public.clients(name)';
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'status'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'name'
    ) then
      execute 'create index if not exists clients_status_name_idx on public.clients(status, name)';
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'industry'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'name'
    ) then
      execute 'create index if not exists clients_industry_name_idx on public.clients(industry, name)';
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'start_date'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clients'
        and column_name = 'name'
    ) then
      execute 'create index if not exists clients_start_date_name_idx on public.clients(start_date, name)';
    end if;
  end if;

  if to_regclass('public.employee_info_records') is not null then
    execute 'create index if not exists employee_info_records_created_idx on public.employee_info_records(created_at desc)';
  end if;

  if to_regclass('public.employee_info_values') is not null then
    execute 'create index if not exists employee_info_values_column_record_idx on public.employee_info_values(column_id, record_id)';
  end if;
end
$$;

create or replace function public.client_active_employee_counts(p_client_ids uuid[])
returns table (
  client_id uuid,
  active_count integer
)
language sql
stable
set search_path = 'public'
as $$
  with target_clients as (
    select unnest(coalesce(p_client_ids, '{}'::uuid[])) as client_id
  ),
  scoped_records as (
    select r.id, r.client_id
    from public.employee_info_records r
    join target_clients tc on tc.client_id = r.client_id
  ),
  leave_columns as (
    select c.id
    from public.employee_info_columns c
    where c.column_kind = 'date'
      and (
        regexp_replace(lower(coalesce(c.key, '')), '[^a-z0-9]+', '_', 'g') = 'leave_date'
        or regexp_replace(lower(coalesce(c.label, '')), '[^a-z0-9]+', '_', 'g') = 'leave_date'
        or regexp_replace(lower(coalesce(c.key, '')), '[^a-z0-9]+', '_', 'g') like '%leave%date%'
        or regexp_replace(lower(coalesce(c.label, '')), '[^a-z0-9]+', '_', 'g') like '%leave%date%'
      )
  ),
  inactive_records as (
    select distinct v.record_id
    from public.employee_info_values v
    join leave_columns lc on lc.id = v.column_id
    where length(trim(coalesce(v.text_value, v.option_value, ''))) > 0
  )
  select
    tc.client_id,
    coalesce(count(sr.id) filter (where ir.record_id is null), 0)::integer as active_count
  from target_clients tc
  left join scoped_records sr on sr.client_id = tc.client_id
  left join inactive_records ir on ir.record_id = sr.id
  group by tc.client_id;
$$;

grant execute on function public.client_active_employee_counts(uuid[]) to authenticated;
