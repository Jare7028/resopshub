-- Client-level schedule billable settings and weekly overrides.

create table if not exists public.schedule_client_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  default_weekly_billable_hours numeric not null default 0,
  breaks_billable boolean not null default true,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_client_settings_default_weekly_non_negative
    check (default_weekly_billable_hours >= 0)
);

create table if not exists public.schedule_client_billable_job_codes (
  client_id uuid not null references public.clients(id) on delete cascade,
  job_code_id uuid not null references public.schedule_job_codes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, job_code_id)
);

create index if not exists schedule_client_billable_job_codes_job_code_idx
  on public.schedule_client_billable_job_codes(job_code_id, client_id);

create table if not exists public.schedule_client_weekly_billable_overrides (
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start_date date not null,
  weekly_billable_hours numeric not null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, week_start_date),
  constraint schedule_client_weekly_billable_overrides_hours_non_negative
    check (weekly_billable_hours >= 0),
  constraint schedule_client_weekly_billable_overrides_monday_check
    check (extract(isodow from week_start_date)::int = 1)
);

drop trigger if exists trg_schedule_client_settings_updated_at on public.schedule_client_settings;
create trigger trg_schedule_client_settings_updated_at
before update on public.schedule_client_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedule_client_weekly_billable_overrides_updated_at on public.schedule_client_weekly_billable_overrides;
create trigger trg_schedule_client_weekly_billable_overrides_updated_at
before update on public.schedule_client_weekly_billable_overrides
for each row execute function public.set_updated_at();

insert into public.schedule_client_settings (client_id)
select c.id
from public.clients c
on conflict (client_id) do nothing;

insert into public.schedule_client_billable_job_codes (client_id, job_code_id)
select c.id, jc.id
from public.clients c
cross join public.schedule_job_codes jc
on conflict (client_id, job_code_id) do nothing;

create or replace function public.schedule_seed_client_billable_defaults()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.schedule_client_settings (client_id)
  values (new.id)
  on conflict (client_id) do nothing;

  insert into public.schedule_client_billable_job_codes (client_id, job_code_id)
  select new.id, jc.id
  from public.schedule_job_codes jc
  on conflict (client_id, job_code_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_clients_schedule_seed_billable_defaults on public.clients;
create trigger trg_clients_schedule_seed_billable_defaults
after insert on public.clients
for each row execute function public.schedule_seed_client_billable_defaults();

create or replace function public.schedule_seed_job_code_billable_defaults()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.schedule_client_billable_job_codes (client_id, job_code_id)
  select c.id, new.id
  from public.clients c
  on conflict (client_id, job_code_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_schedule_job_codes_seed_billable_defaults on public.schedule_job_codes;
create trigger trg_schedule_job_codes_seed_billable_defaults
after insert on public.schedule_job_codes
for each row execute function public.schedule_seed_job_code_billable_defaults();

create or replace function public.schedule_upsert_client_billable_settings(
  p_client_id uuid,
  p_default_weekly_billable_hours numeric default 0,
  p_breaks_billable boolean default true,
  p_billable_job_code_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  normalized_hours numeric := coalesce(p_default_weekly_billable_hours, 0);
  normalized_breaks boolean := coalesce(p_breaks_billable, true);
  normalized_job_code_ids uuid[] := coalesce(p_billable_job_code_ids, '{}'::uuid[]);
  actor_id uuid := public.current_app_user_id();
  invalid_job_code_count integer := 0;
begin
  if p_client_id is null then
    raise exception 'Client id is required';
  end if;

  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to edit client schedule settings';
  end if;

  if normalized_hours < 0 then
    raise exception 'Default weekly billable hours must be non-negative';
  end if;

  select count(*)
  into invalid_job_code_count
  from unnest(normalized_job_code_ids) as selected_code_id
  where not exists (
    select 1
    from public.schedule_job_codes jc
    where jc.id = selected_code_id
  );

  if invalid_job_code_count > 0 then
    raise exception 'One or more selected billable job codes are invalid';
  end if;

  insert into public.schedule_client_settings (
    client_id,
    default_weekly_billable_hours,
    breaks_billable,
    updated_by_user_id
  )
  values (
    p_client_id,
    normalized_hours,
    normalized_breaks,
    actor_id
  )
  on conflict (client_id)
  do update set
    default_weekly_billable_hours = excluded.default_weekly_billable_hours,
    breaks_billable = excluded.breaks_billable,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now();

  delete from public.schedule_client_billable_job_codes scbjc
  where scbjc.client_id = p_client_id
    and not (scbjc.job_code_id = any(normalized_job_code_ids));

  insert into public.schedule_client_billable_job_codes (client_id, job_code_id)
  select p_client_id, selected_code_id
  from unnest(normalized_job_code_ids) as selected_code_id
  on conflict (client_id, job_code_id) do nothing;

  return true;
end;
$$;

create or replace function public.schedule_upsert_client_weekly_billable_override(
  p_client_id uuid,
  p_week_start_date date,
  p_weekly_billable_hours numeric
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  normalized_hours numeric := coalesce(p_weekly_billable_hours, 0);
  actor_id uuid := public.current_app_user_id();
begin
  if p_client_id is null then
    raise exception 'Client id is required';
  end if;

  if p_week_start_date is null then
    raise exception 'Week start date is required';
  end if;

  if extract(isodow from p_week_start_date)::int <> 1 then
    raise exception 'Week start date must be a Monday';
  end if;

  if normalized_hours < 0 then
    raise exception 'Weekly billable hours must be non-negative';
  end if;

  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to edit client schedule settings';
  end if;

  insert into public.schedule_client_weekly_billable_overrides (
    client_id,
    week_start_date,
    weekly_billable_hours,
    updated_by_user_id
  )
  values (
    p_client_id,
    p_week_start_date,
    normalized_hours,
    actor_id
  )
  on conflict (client_id, week_start_date)
  do update set
    weekly_billable_hours = excluded.weekly_billable_hours,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now();

  return true;
end;
$$;

create or replace function public.schedule_delete_client_weekly_billable_override(
  p_client_id uuid,
  p_week_start_date date
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if p_client_id is null then
    raise exception 'Client id is required';
  end if;

  if p_week_start_date is null then
    raise exception 'Week start date is required';
  end if;

  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to edit client schedule settings';
  end if;

  delete from public.schedule_client_weekly_billable_overrides
  where client_id = p_client_id
    and week_start_date = p_week_start_date;

  return true;
end;
$$;

alter table public.schedule_client_settings enable row level security;
alter table public.schedule_client_billable_job_codes enable row level security;
alter table public.schedule_client_weekly_billable_overrides enable row level security;

drop policy if exists schedule_client_settings_select on public.schedule_client_settings;
create policy schedule_client_settings_select
  on public.schedule_client_settings
  for select
  to authenticated
  using (public.schedule_can_view_client(client_id));

drop policy if exists schedule_client_settings_insert_block on public.schedule_client_settings;
create policy schedule_client_settings_insert_block
  on public.schedule_client_settings
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_client_settings_update_block on public.schedule_client_settings;
create policy schedule_client_settings_update_block
  on public.schedule_client_settings
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_client_settings_delete_block on public.schedule_client_settings;
create policy schedule_client_settings_delete_block
  on public.schedule_client_settings
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_client_billable_job_codes_select on public.schedule_client_billable_job_codes;
create policy schedule_client_billable_job_codes_select
  on public.schedule_client_billable_job_codes
  for select
  to authenticated
  using (public.schedule_can_view_client(client_id));

drop policy if exists schedule_client_billable_job_codes_insert_block on public.schedule_client_billable_job_codes;
create policy schedule_client_billable_job_codes_insert_block
  on public.schedule_client_billable_job_codes
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_client_billable_job_codes_update_block on public.schedule_client_billable_job_codes;
create policy schedule_client_billable_job_codes_update_block
  on public.schedule_client_billable_job_codes
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_client_billable_job_codes_delete_block on public.schedule_client_billable_job_codes;
create policy schedule_client_billable_job_codes_delete_block
  on public.schedule_client_billable_job_codes
  for delete
  to authenticated
  using (false);

drop policy if exists schedule_client_weekly_billable_overrides_select on public.schedule_client_weekly_billable_overrides;
create policy schedule_client_weekly_billable_overrides_select
  on public.schedule_client_weekly_billable_overrides
  for select
  to authenticated
  using (public.schedule_can_view_client(client_id));

drop policy if exists schedule_client_weekly_billable_overrides_insert_block on public.schedule_client_weekly_billable_overrides;
create policy schedule_client_weekly_billable_overrides_insert_block
  on public.schedule_client_weekly_billable_overrides
  for insert
  to authenticated
  with check (false);

drop policy if exists schedule_client_weekly_billable_overrides_update_block on public.schedule_client_weekly_billable_overrides;
create policy schedule_client_weekly_billable_overrides_update_block
  on public.schedule_client_weekly_billable_overrides
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists schedule_client_weekly_billable_overrides_delete_block on public.schedule_client_weekly_billable_overrides;
create policy schedule_client_weekly_billable_overrides_delete_block
  on public.schedule_client_weekly_billable_overrides
  for delete
  to authenticated
  using (false);

grant select on public.schedule_client_settings to authenticated;
grant select on public.schedule_client_billable_job_codes to authenticated;
grant select on public.schedule_client_weekly_billable_overrides to authenticated;

grant execute on function public.schedule_seed_client_billable_defaults() to anon, authenticated;
grant execute on function public.schedule_seed_job_code_billable_defaults() to anon, authenticated;
grant execute on function public.schedule_upsert_client_billable_settings(uuid, numeric, boolean, uuid[]) to anon, authenticated;
grant execute on function public.schedule_upsert_client_weekly_billable_override(uuid, date, numeric) to anon, authenticated;
grant execute on function public.schedule_delete_client_weekly_billable_override(uuid, date) to anon, authenticated;
