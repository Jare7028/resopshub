-- Schedule time off suite.

create table if not exists public.schedule_time_off_settings (
  id smallint primary key default 1,
  start_date_column_id uuid references public.employee_info_columns(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_time_off_settings_singleton_check check (id = 1)
);

create table if not exists public.schedule_time_off_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active boolean not null default true,
  default_paid_days_per_year integer not null default 0,
  carryover_enabled boolean not null default false,
  carryover_cap_days integer not null default 0,
  carryover_expiry_month smallint,
  carryover_expiry_day smallint,
  sort_order integer not null default 0,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_time_off_codes_code_not_blank check (length(trim(code)) > 0),
  constraint schedule_time_off_codes_label_not_blank check (length(trim(label)) > 0),
  constraint schedule_time_off_codes_default_paid_non_negative check (default_paid_days_per_year >= 0),
  constraint schedule_time_off_codes_carryover_cap_non_negative check (carryover_cap_days >= 0),
  constraint schedule_time_off_codes_expiry_month_valid check (
    carryover_expiry_month is null or (carryover_expiry_month between 1 and 12)
  ),
  constraint schedule_time_off_codes_expiry_day_valid check (
    carryover_expiry_day is null or (carryover_expiry_day between 1 and 31)
  ),
  constraint schedule_time_off_codes_expiry_pair_check check (
    (carryover_expiry_month is null and carryover_expiry_day is null)
    or (carryover_expiry_month is not null and carryover_expiry_day is not null)
  )
);

create index if not exists schedule_time_off_codes_sort_idx
  on public.schedule_time_off_codes(sort_order, label);

create table if not exists public.schedule_time_off_user_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_id uuid not null references public.schedule_time_off_codes(id) on delete cascade,
  annual_paid_days integer not null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, code_id),
  constraint schedule_time_off_user_overrides_paid_non_negative check (annual_paid_days >= 0)
);

create index if not exists schedule_time_off_user_overrides_user_idx
  on public.schedule_time_off_user_overrides(user_id, code_id);

create table if not exists public.schedule_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.users(id) on delete cascade,
  code_id uuid not null references public.schedule_time_off_codes(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  request_note text,
  submitted_by_user_id uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by_user_id uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  approved_paid_days integer not null default 0,
  approved_unpaid_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_time_off_requests_range_check check (end_date >= start_date),
  constraint schedule_time_off_requests_paid_non_negative check (approved_paid_days >= 0),
  constraint schedule_time_off_requests_unpaid_non_negative check (approved_unpaid_days >= 0)
);

create index if not exists schedule_time_off_requests_status_idx
  on public.schedule_time_off_requests(status, submitted_at desc);

create index if not exists schedule_time_off_requests_target_idx
  on public.schedule_time_off_requests(target_user_id, start_date, end_date);

create index if not exists schedule_time_off_requests_code_idx
  on public.schedule_time_off_requests(code_id, start_date, end_date);

create table if not exists public.schedule_time_off_allocations (
  request_id uuid not null references public.schedule_time_off_requests(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  code_id uuid not null references public.schedule_time_off_codes(id) on delete restrict,
  day date not null,
  leave_year integer not null,
  pay_source text not null check (pay_source in ('carryover', 'entitlement', 'unpaid')),
  created_at timestamptz not null default now(),
  primary key (request_id, day),
  unique (target_user_id, day)
);

create index if not exists schedule_time_off_allocations_user_year_idx
  on public.schedule_time_off_allocations(target_user_id, code_id, leave_year, day);

create index if not exists schedule_time_off_allocations_day_idx
  on public.schedule_time_off_allocations(day, target_user_id);

create index if not exists schedule_time_off_allocations_request_idx
  on public.schedule_time_off_allocations(request_id, day);

insert into public.schedule_time_off_settings (id)
values (1)
on conflict (id) do nothing;

insert into public.schedule_time_off_codes (
  code,
  label,
  is_active,
  default_paid_days_per_year,
  carryover_enabled,
  carryover_cap_days,
  carryover_expiry_month,
  carryover_expiry_day,
  sort_order
)
values
  ('VACATION', 'Vacation', true, 0, false, 0, null, null, 10),
  ('SICK', 'Sick', true, 0, false, 0, null, null, 20)
on conflict (code) do update
set
  label = excluded.label,
  is_active = excluded.is_active,
  updated_at = now();

drop trigger if exists trg_schedule_time_off_settings_updated_at on public.schedule_time_off_settings;
create trigger trg_schedule_time_off_settings_updated_at
before update on public.schedule_time_off_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedule_time_off_codes_updated_at on public.schedule_time_off_codes;
create trigger trg_schedule_time_off_codes_updated_at
before update on public.schedule_time_off_codes
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedule_time_off_user_overrides_updated_at on public.schedule_time_off_user_overrides;
create trigger trg_schedule_time_off_user_overrides_updated_at
before update on public.schedule_time_off_user_overrides
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedule_time_off_requests_updated_at on public.schedule_time_off_requests;
create trigger trg_schedule_time_off_requests_updated_at
before update on public.schedule_time_off_requests
for each row execute function public.set_updated_at();

create or replace function public.schedule_can_manage_time_off()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('schedules');
$$;

create or replace function public.schedule_time_off_try_parse_iso_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  normalized text := trim(coalesce(p_value, ''));
  parsed date;
begin
  if normalized !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  parsed := to_date(normalized, 'YYYY-MM-DD');
  if to_char(parsed, 'YYYY-MM-DD') <> normalized then
    return null;
  end if;

  return parsed;
end;
$$;

create or replace function public.schedule_time_off_start_date_for_user(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = 'public'
as $$
  with selected_setting as (
    select s.start_date_column_id
    from public.schedule_time_off_settings s
    where s.id = 1
      and s.start_date_column_id is not null
    limit 1
  ),
  candidate as (
    select coalesce(v.text_value, v.option_value) as raw_value
    from selected_setting s
    join public.employee_info_records r
      on r.user_id = p_user_id
    left join public.employee_info_values v
      on v.record_id = r.id
     and v.column_id = s.start_date_column_id
    order by r.updated_at desc nulls last, r.created_at desc, r.id
    limit 1
  )
  select public.schedule_time_off_try_parse_iso_date(candidate.raw_value)
  from candidate;
$$;

create or replace function public.schedule_time_off_annual_base_days(
  p_user_id uuid,
  p_code_id uuid
)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select greatest(
    0,
    coalesce(override_row.annual_paid_days, code_row.default_paid_days_per_year, 0)
  )
  from public.schedule_time_off_codes code_row
  left join public.schedule_time_off_user_overrides override_row
    on override_row.code_id = code_row.id
   and override_row.user_id = p_user_id
  where code_row.id = p_code_id;
$$;

create or replace function public.schedule_time_off_entitlement_days(
  p_user_id uuid,
  p_code_id uuid,
  p_leave_year integer
)
returns integer
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  annual_base integer := coalesce(public.schedule_time_off_annual_base_days(p_user_id, p_code_id), 0);
  start_date date := public.schedule_time_off_start_date_for_user(p_user_id);
  start_year integer;
  year_start date;
  year_end date;
  eligible_days integer;
  total_days integer;
begin
  if p_leave_year is null then
    return 0;
  end if;

  if annual_base <= 0 then
    return 0;
  end if;

  if start_date is null then
    return 0;
  end if;

  start_year := extract(year from start_date)::int;

  if start_year > p_leave_year then
    return 0;
  end if;

  if start_year < p_leave_year then
    return annual_base;
  end if;

  year_start := make_date(p_leave_year, 1, 1);
  year_end := make_date(p_leave_year, 12, 31);
  eligible_days := (year_end - greatest(start_date, year_start)) + 1;
  total_days := (year_end - year_start) + 1;

  if eligible_days <= 0 or total_days <= 0 then
    return 0;
  end if;

  return floor((annual_base::numeric * eligible_days::numeric) / total_days::numeric)::int;
end;
$$;

create or replace function public.schedule_time_off_carryover_expiry_for_year(
  p_code_id uuid,
  p_leave_year integer
)
returns date
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  code_row record;
  month_start date;
  last_day integer;
begin
  if p_leave_year is null then
    return null;
  end if;

  select
    c.carryover_enabled,
    c.carryover_expiry_month,
    c.carryover_expiry_day
  into code_row
  from public.schedule_time_off_codes c
  where c.id = p_code_id;

  if not found then
    return null;
  end if;

  if not coalesce(code_row.carryover_enabled, false) then
    return null;
  end if;

  if code_row.carryover_expiry_month is null or code_row.carryover_expiry_day is null then
    return null;
  end if;

  month_start := make_date(p_leave_year, code_row.carryover_expiry_month::int, 1);
  last_day := extract(day from (date_trunc('month', month_start::timestamp) + interval '1 month -1 day'))::int;

  return make_date(
    p_leave_year,
    code_row.carryover_expiry_month::int,
    least(code_row.carryover_expiry_day::int, last_day)
  );
end;
$$;

create or replace function public.schedule_time_off_carryover_pool_days(
  p_user_id uuid,
  p_code_id uuid,
  p_leave_year integer
)
returns integer
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  code_row record;
  previous_year integer := p_leave_year - 1;
  entitlement_previous integer := 0;
  used_entitlement_previous integer := 0;
begin
  if p_leave_year is null then
    return 0;
  end if;

  select
    c.carryover_enabled,
    c.carryover_cap_days
  into code_row
  from public.schedule_time_off_codes c
  where c.id = p_code_id;

  if not found then
    return 0;
  end if;

  if not coalesce(code_row.carryover_enabled, false) then
    return 0;
  end if;

  entitlement_previous := coalesce(
    public.schedule_time_off_entitlement_days(p_user_id, p_code_id, previous_year),
    0
  );

  select count(*)::int
  into used_entitlement_previous
  from public.schedule_time_off_allocations a
  where a.target_user_id = p_user_id
    and a.code_id = p_code_id
    and a.leave_year = previous_year
    and a.pay_source = 'entitlement';

  return least(
    greatest(coalesce(code_row.carryover_cap_days, 0), 0),
    greatest(entitlement_previous - used_entitlement_previous, 0)
  );
end;
$$;

create or replace function public.schedule_time_off_project_allocations(
  p_target_user_id uuid,
  p_code_id uuid,
  p_start_date date,
  p_end_date date,
  p_ignore_request_id uuid default null
)
returns table (
  day date,
  leave_year integer,
  pay_source text
)
language sql
stable
security definer
set search_path = 'public'
as $$
  with request_days as (
    select
      gs::date as day,
      extract(year from gs)::int as leave_year
    from generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') as gs
  ),
  request_years as (
    select distinct rd.leave_year
    from request_days rd
  ),
  used_totals as (
    select
      a.leave_year,
      count(*) filter (where a.pay_source = 'entitlement')::int as used_entitlement_days,
      count(*) filter (where a.pay_source = 'carryover')::int as used_carryover_days
    from public.schedule_time_off_allocations a
    where a.target_user_id = p_target_user_id
      and a.code_id = p_code_id
      and (p_ignore_request_id is null or a.request_id <> p_ignore_request_id)
      and a.leave_year in (select leave_year from request_years)
    group by a.leave_year
  ),
  year_state as (
    select
      y.leave_year,
      coalesce(public.schedule_time_off_entitlement_days(p_target_user_id, p_code_id, y.leave_year), 0) as entitlement_days,
      coalesce(public.schedule_time_off_carryover_pool_days(p_target_user_id, p_code_id, y.leave_year), 0) as carryover_pool_days,
      public.schedule_time_off_carryover_expiry_for_year(p_code_id, y.leave_year) as carryover_expiry_date,
      coalesce(u.used_entitlement_days, 0) as used_entitlement_days,
      coalesce(u.used_carryover_days, 0) as used_carryover_days
    from request_years y
    left join used_totals u
      on u.leave_year = y.leave_year
  ),
  year_remaining as (
    select
      ys.leave_year,
      greatest(ys.entitlement_days - ys.used_entitlement_days, 0) as entitlement_remaining,
      greatest(ys.carryover_pool_days - ys.used_carryover_days, 0) as carryover_remaining,
      ys.carryover_expiry_date
    from year_state ys
  ),
  ordered as (
    select
      rd.day,
      rd.leave_year,
      yr.entitlement_remaining,
      yr.carryover_remaining,
      yr.carryover_expiry_date,
      row_number() over (partition by rd.leave_year order by rd.day) as year_day_index,
      sum(
        case
          when yr.carryover_remaining > 0
            and yr.carryover_expiry_date is not null
            and rd.day <= yr.carryover_expiry_date
          then 1 else 0
        end
      ) over (
        partition by rd.leave_year
        order by rd.day
        rows between unbounded preceding and current row
      ) as carryover_eligible_index
    from request_days rd
    join year_remaining yr
      on yr.leave_year = rd.leave_year
  ),
  with_carryover as (
    select
      o.*,
      case
        when o.carryover_remaining > 0
          and o.carryover_expiry_date is not null
          and o.day <= o.carryover_expiry_date
          and o.carryover_eligible_index <= o.carryover_remaining
        then 1 else 0
      end as is_carryover
    from ordered o
  ),
  with_entitlement as (
    select
      wc.*,
      (
        wc.year_day_index
        - sum(wc.is_carryover) over (
            partition by wc.leave_year
            order by wc.day
            rows between unbounded preceding and current row
          )
      ) as entitlement_index
    from with_carryover wc
  )
  select
    we.day,
    we.leave_year,
    case
      when we.is_carryover = 1 then 'carryover'
      when we.entitlement_remaining > 0 and we.entitlement_index <= we.entitlement_remaining then 'entitlement'
      else 'unpaid'
    end as pay_source
  from with_entitlement we
  order by we.day;
$$;

create or replace function public.schedule_time_off_upsert_settings(
  p_start_date_column_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  column_kind text;
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to manage time off settings';
  end if;

  if p_start_date_column_id is not null then
    select c.column_kind
    into column_kind
    from public.employee_info_columns c
    where c.id = p_start_date_column_id;

    if not found then
      raise exception 'START_DATE_COLUMN_NOT_FOUND';
    end if;

    if column_kind <> 'date' then
      raise exception 'START_DATE_COLUMN_MUST_BE_DATE';
    end if;
  end if;

  insert into public.schedule_time_off_settings (
    id,
    start_date_column_id,
    updated_by_user_id
  )
  values (
    1,
    p_start_date_column_id,
    actor_id
  )
  on conflict (id)
  do update set
    start_date_column_id = excluded.start_date_column_id,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now();

  return true;
end;
$$;

create or replace function public.schedule_time_off_upsert_code(
  p_code_id uuid default null,
  p_code text default null,
  p_label text default null,
  p_default_paid_days_per_year integer default 0,
  p_carryover_enabled boolean default false,
  p_carryover_cap_days integer default 0,
  p_carryover_expiry_month smallint default null,
  p_carryover_expiry_day smallint default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  normalized_code text;
  normalized_label text;
  normalized_carryover_enabled boolean := coalesce(p_carryover_enabled, false);
  normalized_cap integer := greatest(coalesce(p_carryover_cap_days, 0), 0);
  normalized_paid integer := greatest(coalesce(p_default_paid_days_per_year, 0), 0);
  normalized_month smallint := p_carryover_expiry_month;
  normalized_day smallint := p_carryover_expiry_day;
  normalized_sort integer := coalesce(p_sort_order, 0);
  normalized_active boolean := coalesce(p_is_active, true);
  resolved_id uuid;
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to manage time off codes';
  end if;

  normalized_label := trim(coalesce(p_label, ''));
  if normalized_label = '' then
    raise exception 'CODE_LABEL_REQUIRED';
  end if;

  normalized_code := trim(coalesce(p_code, ''));
  normalized_code := regexp_replace(upper(normalized_code), '[^A-Z0-9]+', '_', 'g');
  normalized_code := regexp_replace(normalized_code, '^_+|_+$', '', 'g');
  if normalized_code = '' then
    raise exception 'CODE_KEY_REQUIRED';
  end if;

  if normalized_carryover_enabled then
    if normalized_month is null or normalized_day is null then
      raise exception 'CARRYOVER_EXPIRY_REQUIRED';
    end if;
    if normalized_month < 1 or normalized_month > 12 then
      raise exception 'CARRYOVER_EXPIRY_MONTH_INVALID';
    end if;
    if normalized_day < 1 or normalized_day > 31 then
      raise exception 'CARRYOVER_EXPIRY_DAY_INVALID';
    end if;
  else
    normalized_month := null;
    normalized_day := null;
  end if;

  if p_code_id is null then
    insert into public.schedule_time_off_codes (
      code,
      label,
      is_active,
      default_paid_days_per_year,
      carryover_enabled,
      carryover_cap_days,
      carryover_expiry_month,
      carryover_expiry_day,
      sort_order,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      normalized_code,
      normalized_label,
      normalized_active,
      normalized_paid,
      normalized_carryover_enabled,
      normalized_cap,
      normalized_month,
      normalized_day,
      normalized_sort,
      actor_id,
      actor_id
    )
    on conflict (code)
    do update set
      label = excluded.label,
      is_active = excluded.is_active,
      default_paid_days_per_year = excluded.default_paid_days_per_year,
      carryover_enabled = excluded.carryover_enabled,
      carryover_cap_days = excluded.carryover_cap_days,
      carryover_expiry_month = excluded.carryover_expiry_month,
      carryover_expiry_day = excluded.carryover_expiry_day,
      sort_order = excluded.sort_order,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = now()
    returning id into resolved_id;
  else
    update public.schedule_time_off_codes c
    set
      code = normalized_code,
      label = normalized_label,
      is_active = normalized_active,
      default_paid_days_per_year = normalized_paid,
      carryover_enabled = normalized_carryover_enabled,
      carryover_cap_days = normalized_cap,
      carryover_expiry_month = normalized_month,
      carryover_expiry_day = normalized_day,
      sort_order = normalized_sort,
      updated_by_user_id = actor_id,
      updated_at = now()
    where c.id = p_code_id
    returning c.id into resolved_id;

    if resolved_id is null then
      raise exception 'CODE_NOT_FOUND';
    end if;
  end if;

  return resolved_id;
end;
$$;

create or replace function public.schedule_time_off_set_code_active(
  p_code_id uuid,
  p_is_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to manage time off codes';
  end if;

  update public.schedule_time_off_codes c
  set
    is_active = coalesce(p_is_active, true),
    updated_by_user_id = actor_id,
    updated_at = now()
  where c.id = p_code_id;

  if not found then
    raise exception 'CODE_NOT_FOUND';
  end if;

  return true;
end;
$$;

create or replace function public.schedule_time_off_upsert_user_override(
  p_user_id uuid,
  p_code_id uuid,
  p_annual_paid_days integer
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  resolved_id uuid;
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to manage time off entitlements';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_code_id is null then
    raise exception 'CODE_ID_REQUIRED';
  end if;

  if coalesce(p_annual_paid_days, -1) < 0 then
    raise exception 'ANNUAL_PAID_DAYS_INVALID';
  end if;

  insert into public.schedule_time_off_user_overrides (
    user_id,
    code_id,
    annual_paid_days,
    updated_by_user_id
  )
  values (
    p_user_id,
    p_code_id,
    p_annual_paid_days,
    actor_id
  )
  on conflict (user_id, code_id)
  do update set
    annual_paid_days = excluded.annual_paid_days,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now()
  returning id into resolved_id;

  return resolved_id;
end;
$$;

create or replace function public.schedule_time_off_delete_user_override(
  p_user_id uuid,
  p_code_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to manage time off entitlements';
  end if;

  delete from public.schedule_time_off_user_overrides o
  where o.user_id = p_user_id
    and o.code_id = p_code_id;

  return true;
end;
$$;

create or replace function public.schedule_time_off_create_request(
  p_target_user_id uuid,
  p_code_id uuid,
  p_start_date date,
  p_end_date date,
  p_request_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  resolved_request_id uuid;
  normalized_note text := nullif(trim(coalesce(p_request_note, '')), '');
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to create time off requests';
  end if;

  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED';
  end if;

  if p_code_id is null then
    raise exception 'CODE_REQUIRED';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'DATE_RANGE_REQUIRED';
  end if;

  if p_end_date < p_start_date then
    raise exception 'DATE_RANGE_INVALID';
  end if;

  if not exists (
    select 1
    from public.schedule_time_off_codes c
    where c.id = p_code_id
      and c.is_active
  ) then
    raise exception 'CODE_NOT_ACTIVE';
  end if;

  insert into public.schedule_time_off_requests (
    target_user_id,
    code_id,
    start_date,
    end_date,
    status,
    request_note,
    submitted_by_user_id,
    submitted_at,
    approved_paid_days,
    approved_unpaid_days
  )
  values (
    p_target_user_id,
    p_code_id,
    p_start_date,
    p_end_date,
    'pending',
    normalized_note,
    actor_id,
    now(),
    0,
    0
  )
  returning id into resolved_request_id;

  return resolved_request_id;
end;
$$;

create or replace function public.schedule_time_off_preview_request(
  p_target_user_id uuid,
  p_code_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  preview_json jsonb;
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to preview time off requests';
  end if;

  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED';
  end if;

  if p_code_id is null then
    raise exception 'CODE_REQUIRED';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'DATE_RANGE_REQUIRED';
  end if;

  if p_end_date < p_start_date then
    raise exception 'DATE_RANGE_INVALID';
  end if;

  with allocations as (
    select *
    from public.schedule_time_off_project_allocations(
      p_target_user_id,
      p_code_id,
      p_start_date,
      p_end_date,
      null
    )
  ),
  year_breakdown as (
    select
      a.leave_year,
      count(*)::int as total_days,
      count(*) filter (where a.pay_source in ('carryover', 'entitlement'))::int as paid_days,
      count(*) filter (where a.pay_source = 'unpaid')::int as unpaid_days,
      count(*) filter (where a.pay_source = 'carryover')::int as carryover_days,
      count(*) filter (where a.pay_source = 'entitlement')::int as entitlement_days
    from allocations a
    group by a.leave_year
    order by a.leave_year
  )
  select jsonb_build_object(
    'total_days', coalesce((select count(*)::int from allocations), 0),
    'paid_days', coalesce((select count(*)::int from allocations where pay_source in ('carryover', 'entitlement')), 0),
    'unpaid_days', coalesce((select count(*)::int from allocations where pay_source = 'unpaid'), 0),
    'by_year', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'leave_year', y.leave_year,
            'total_days', y.total_days,
            'paid_days', y.paid_days,
            'unpaid_days', y.unpaid_days,
            'carryover_days', y.carryover_days,
            'entitlement_days', y.entitlement_days
          )
          order by y.leave_year
        )
        from year_breakdown y
      ),
      '[]'::jsonb
    ),
    'days', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'day', a.day,
            'leave_year', a.leave_year,
            'pay_source', a.pay_source
          )
          order by a.day
        )
        from allocations a
      ),
      '[]'::jsonb
    )
  )
  into preview_json;

  return coalesce(preview_json, '{}'::jsonb);
end;
$$;

create or replace function public.schedule_time_off_decide_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  normalized_decision text := lower(trim(coalesce(p_decision, '')));
  normalized_note text := nullif(trim(coalesce(p_decision_note, '')), '');
  request_row public.schedule_time_off_requests%rowtype;
  start_date_column_id uuid;
  start_date_value date;
  paid_days integer := 0;
  unpaid_days integer := 0;
begin
  if not public.schedule_can_manage_time_off() then
    raise exception 'Not authorized to decide time off requests';
  end if;

  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;

  if normalized_decision not in ('approved', 'rejected') then
    raise exception 'DECISION_INVALID';
  end if;

  select *
  into request_row
  from public.schedule_time_off_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  if normalized_decision = 'rejected' then
    update public.schedule_time_off_requests r
    set
      status = 'rejected',
      decided_by_user_id = actor_id,
      decided_at = now(),
      decision_note = normalized_note,
      approved_paid_days = 0,
      approved_unpaid_days = 0,
      updated_at = now()
    where r.id = request_row.id;

    return jsonb_build_object(
      'request_id', request_row.id,
      'status', 'rejected',
      'approved_paid_days', 0,
      'approved_unpaid_days', 0
    );
  end if;

  select s.start_date_column_id
  into start_date_column_id
  from public.schedule_time_off_settings s
  where s.id = 1;

  if start_date_column_id is null then
    raise exception 'START_DATE_CONFIG_REQUIRED';
  end if;

  start_date_value := public.schedule_time_off_start_date_for_user(request_row.target_user_id);
  if start_date_value is null then
    raise exception 'START_DATE_MISSING';
  end if;

  perform pg_advisory_xact_lock(hashtext('schedule_time_off:' || request_row.target_user_id::text || ':' || request_row.code_id::text));

  if exists (
    select 1
    from public.schedule_time_off_allocations a
    where a.target_user_id = request_row.target_user_id
      and a.day between request_row.start_date and request_row.end_date
  ) then
    raise exception 'OVERLAP_EXISTS';
  end if;

  begin
    insert into public.schedule_time_off_allocations (
      request_id,
      target_user_id,
      code_id,
      day,
      leave_year,
      pay_source
    )
    select
      request_row.id,
      request_row.target_user_id,
      request_row.code_id,
      projected.day,
      projected.leave_year,
      projected.pay_source
    from public.schedule_time_off_project_allocations(
      request_row.target_user_id,
      request_row.code_id,
      request_row.start_date,
      request_row.end_date,
      request_row.id
    ) as projected;
  exception
    when unique_violation then
      raise exception 'OVERLAP_EXISTS';
  end;

  select
    count(*) filter (where a.pay_source in ('carryover', 'entitlement'))::int,
    count(*) filter (where a.pay_source = 'unpaid')::int
  into paid_days, unpaid_days
  from public.schedule_time_off_allocations a
  where a.request_id = request_row.id;

  update public.schedule_time_off_requests r
  set
    status = 'approved',
    decided_by_user_id = actor_id,
    decided_at = now(),
    decision_note = normalized_note,
    approved_paid_days = coalesce(paid_days, 0),
    approved_unpaid_days = coalesce(unpaid_days, 0),
    updated_at = now()
  where r.id = request_row.id;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', 'approved',
    'approved_paid_days', coalesce(paid_days, 0),
    'approved_unpaid_days', coalesce(unpaid_days, 0)
  );
end;
$$;

create or replace function public.schedule_time_off_get_balances(
  p_year integer,
  p_user_id uuid default null,
  p_code_id uuid default null
)
returns table (
  target_user_id uuid,
  target_user_name text,
  code_id uuid,
  code text,
  label text,
  leave_year integer,
  annual_paid_days integer,
  entitlement_days integer,
  carryover_pool_days integer,
  carryover_expiry_date date,
  used_entitlement_days integer,
  used_carryover_days integer,
  used_unpaid_days integer,
  used_paid_days integer,
  remaining_entitlement_days integer,
  remaining_carryover_days integer,
  remaining_paid_days integer
)
language sql
stable
security definer
set search_path = 'public'
as $$
  with selected_users as (
    select
      u.id,
      coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.email), ''), u.id::text) as display_name
    from public.users u
    where p_user_id is null or u.id = p_user_id
  ),
  selected_codes as (
    select
      c.id,
      c.code,
      c.label,
      c.default_paid_days_per_year
    from public.schedule_time_off_codes c
    where (p_code_id is not null and c.id = p_code_id)
       or (p_code_id is null and c.is_active)
  ),
  grid as (
    select
      su.id as user_id,
      su.display_name,
      sc.id as code_id,
      sc.code,
      sc.label,
      coalesce(override_row.annual_paid_days, sc.default_paid_days_per_year, 0) as annual_paid_days
    from selected_users su
    cross join selected_codes sc
    left join public.schedule_time_off_user_overrides override_row
      on override_row.user_id = su.id
     and override_row.code_id = sc.id
  ),
  usage as (
    select
      a.target_user_id,
      a.code_id,
      count(*) filter (where a.pay_source = 'entitlement')::int as used_entitlement_days,
      count(*) filter (where a.pay_source = 'carryover')::int as used_carryover_days,
      count(*) filter (where a.pay_source = 'unpaid')::int as used_unpaid_days
    from public.schedule_time_off_allocations a
    where a.leave_year = p_year
    group by a.target_user_id, a.code_id
  )
  select
    g.user_id as target_user_id,
    g.display_name as target_user_name,
    g.code_id,
    g.code,
    g.label,
    p_year as leave_year,
    greatest(g.annual_paid_days, 0) as annual_paid_days,
    coalesce(public.schedule_time_off_entitlement_days(g.user_id, g.code_id, p_year), 0) as entitlement_days,
    coalesce(public.schedule_time_off_carryover_pool_days(g.user_id, g.code_id, p_year), 0) as carryover_pool_days,
    public.schedule_time_off_carryover_expiry_for_year(g.code_id, p_year) as carryover_expiry_date,
    coalesce(u.used_entitlement_days, 0) as used_entitlement_days,
    coalesce(u.used_carryover_days, 0) as used_carryover_days,
    coalesce(u.used_unpaid_days, 0) as used_unpaid_days,
    (coalesce(u.used_entitlement_days, 0) + coalesce(u.used_carryover_days, 0))::int as used_paid_days,
    greatest(
      coalesce(public.schedule_time_off_entitlement_days(g.user_id, g.code_id, p_year), 0)
      - coalesce(u.used_entitlement_days, 0),
      0
    )::int as remaining_entitlement_days,
    greatest(
      coalesce(public.schedule_time_off_carryover_pool_days(g.user_id, g.code_id, p_year), 0)
      - coalesce(u.used_carryover_days, 0),
      0
    )::int as remaining_carryover_days,
    (
      greatest(
        coalesce(public.schedule_time_off_entitlement_days(g.user_id, g.code_id, p_year), 0)
        - coalesce(u.used_entitlement_days, 0),
        0
      )
      +
      greatest(
        coalesce(public.schedule_time_off_carryover_pool_days(g.user_id, g.code_id, p_year), 0)
        - coalesce(u.used_carryover_days, 0),
        0
      )
    )::int as remaining_paid_days
  from grid g
  left join usage u
    on u.target_user_id = g.user_id
   and u.code_id = g.code_id
  order by g.display_name, g.label;
$$;

create or replace function public.schedule_time_off_list_days(
  p_user_ids uuid[],
  p_start_date date,
  p_end_date date
)
returns table (
  target_user_id uuid,
  day date,
  code_id uuid,
  code text,
  label text,
  pay_source text,
  request_id uuid
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if auth.uid() is null or not public.can_view_page('schedules') then
    raise exception 'Not authorized to view time off days';
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  if p_start_date is null or p_end_date is null then
    return;
  end if;

  if p_end_date < p_start_date then
    return;
  end if;

  return query
  select
    a.target_user_id,
    a.day,
    a.code_id,
    c.code,
    c.label,
    a.pay_source,
    a.request_id
  from public.schedule_time_off_allocations a
  join public.schedule_time_off_requests r
    on r.id = a.request_id
  join public.schedule_time_off_codes c
    on c.id = a.code_id
  where a.target_user_id = any(p_user_ids)
    and a.day between p_start_date and p_end_date
    and r.status = 'approved'
  order by a.day, a.target_user_id, c.label;
end;
$$;

alter table public.schedule_time_off_settings enable row level security;
alter table public.schedule_time_off_codes enable row level security;
alter table public.schedule_time_off_user_overrides enable row level security;
alter table public.schedule_time_off_requests enable row level security;
alter table public.schedule_time_off_allocations enable row level security;

drop policy if exists schedule_time_off_settings_select on public.schedule_time_off_settings;
create policy schedule_time_off_settings_select
  on public.schedule_time_off_settings
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));

drop policy if exists schedule_time_off_settings_insert_block on public.schedule_time_off_settings;
create policy schedule_time_off_settings_insert_block
  on public.schedule_time_off_settings
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_time_off_settings_update_block on public.schedule_time_off_settings;
create policy schedule_time_off_settings_update_block
  on public.schedule_time_off_settings
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_time_off_settings_delete_block on public.schedule_time_off_settings;
create policy schedule_time_off_settings_delete_block
  on public.schedule_time_off_settings
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_time_off_codes_select on public.schedule_time_off_codes;
create policy schedule_time_off_codes_select
  on public.schedule_time_off_codes
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));

drop policy if exists schedule_time_off_codes_insert_block on public.schedule_time_off_codes;
create policy schedule_time_off_codes_insert_block
  on public.schedule_time_off_codes
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_time_off_codes_update_block on public.schedule_time_off_codes;
create policy schedule_time_off_codes_update_block
  on public.schedule_time_off_codes
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_time_off_codes_delete_block on public.schedule_time_off_codes;
create policy schedule_time_off_codes_delete_block
  on public.schedule_time_off_codes
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_time_off_user_overrides_select on public.schedule_time_off_user_overrides;
create policy schedule_time_off_user_overrides_select
  on public.schedule_time_off_user_overrides
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));

drop policy if exists schedule_time_off_user_overrides_insert_block on public.schedule_time_off_user_overrides;
create policy schedule_time_off_user_overrides_insert_block
  on public.schedule_time_off_user_overrides
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_time_off_user_overrides_update_block on public.schedule_time_off_user_overrides;
create policy schedule_time_off_user_overrides_update_block
  on public.schedule_time_off_user_overrides
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_time_off_user_overrides_delete_block on public.schedule_time_off_user_overrides;
create policy schedule_time_off_user_overrides_delete_block
  on public.schedule_time_off_user_overrides
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_time_off_requests_select on public.schedule_time_off_requests;
create policy schedule_time_off_requests_select
  on public.schedule_time_off_requests
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));

drop policy if exists schedule_time_off_requests_insert_block on public.schedule_time_off_requests;
create policy schedule_time_off_requests_insert_block
  on public.schedule_time_off_requests
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_time_off_requests_update_block on public.schedule_time_off_requests;
create policy schedule_time_off_requests_update_block
  on public.schedule_time_off_requests
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_time_off_requests_delete_block on public.schedule_time_off_requests;
create policy schedule_time_off_requests_delete_block
  on public.schedule_time_off_requests
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_time_off_allocations_select on public.schedule_time_off_allocations;
create policy schedule_time_off_allocations_select
  on public.schedule_time_off_allocations
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));

drop policy if exists schedule_time_off_allocations_insert_block on public.schedule_time_off_allocations;
create policy schedule_time_off_allocations_insert_block
  on public.schedule_time_off_allocations
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_time_off_allocations_update_block on public.schedule_time_off_allocations;
create policy schedule_time_off_allocations_update_block
  on public.schedule_time_off_allocations
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_time_off_allocations_delete_block on public.schedule_time_off_allocations;
create policy schedule_time_off_allocations_delete_block
  on public.schedule_time_off_allocations
  for delete
  to authenticated
  using (false);

grant select on public.schedule_time_off_settings to authenticated;
grant select on public.schedule_time_off_codes to authenticated;
grant select on public.schedule_time_off_user_overrides to authenticated;
grant select on public.schedule_time_off_requests to authenticated;
grant select on public.schedule_time_off_allocations to authenticated;

grant execute on function public.schedule_can_manage_time_off() to anon, authenticated;
grant execute on function public.schedule_time_off_try_parse_iso_date(text) to anon, authenticated;
grant execute on function public.schedule_time_off_start_date_for_user(uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_annual_base_days(uuid, uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_entitlement_days(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.schedule_time_off_carryover_expiry_for_year(uuid, integer) to anon, authenticated;
grant execute on function public.schedule_time_off_carryover_pool_days(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.schedule_time_off_project_allocations(uuid, uuid, date, date, uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_upsert_settings(uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_upsert_code(uuid, text, text, integer, boolean, integer, smallint, smallint, integer, boolean) to anon, authenticated;
grant execute on function public.schedule_time_off_set_code_active(uuid, boolean) to anon, authenticated;
grant execute on function public.schedule_time_off_upsert_user_override(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.schedule_time_off_delete_user_override(uuid, uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_create_request(uuid, uuid, date, date, text) to anon, authenticated;
grant execute on function public.schedule_time_off_preview_request(uuid, uuid, date, date) to anon, authenticated;
grant execute on function public.schedule_time_off_decide_request(uuid, text, text) to anon, authenticated;
grant execute on function public.schedule_time_off_get_balances(integer, uuid, uuid) to anon, authenticated;
grant execute on function public.schedule_time_off_list_days(uuid[], date, date) to anon, authenticated;
