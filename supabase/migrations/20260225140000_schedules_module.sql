-- Schedules module foundation.

create extension if not exists btree_gist;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter table if exists public.employee_info_records
  add column if not exists user_id uuid references public.users(id) on delete set null;

create index if not exists employee_info_records_client_user_idx
  on public.employee_info_records(client_id, user_id);

with candidate_users as (
  select
    lower(trim(coalesce(u.full_name, ''))) as name_key,
    min(u.id::text)::uuid as user_id,
    count(*) as user_count
  from public.users u
  where length(trim(coalesce(u.full_name, ''))) > 0
  group by lower(trim(coalesce(u.full_name, '')))
),
match_rows as (
  select
    r.id as record_id,
    c.user_id
  from public.employee_info_records r
  join candidate_users c
    on c.name_key = lower(trim(coalesce(r.full_name, '')))
   and c.user_count = 1
  where r.user_id is null
)
update public.employee_info_records r
set
  user_id = m.user_id,
  updated_at = now()
from match_rows m
where r.id = m.record_id
  and r.user_id is null;

insert into public.permission_definitions (key, label, description, scope_type)
values
  ('schedules.edit', 'Schedules Edit', 'Create and edit schedule weeks/shifts/rosters.', 'client'),
  ('schedules.publish', 'Schedules Publish', 'Publish draft schedules for a client.', 'client'),
  ('schedules.unpublish', 'Schedules Unpublish', 'Unpublish client schedules.', 'client'),
  ('schedules.manage_templates', 'Schedules Manage Templates', 'Create and apply schedule templates.', 'client'),
  ('schedules.claim_open_shift', 'Schedules Claim Open Shift', 'Claim open shifts for a client.', 'client'),
  ('schedules.manage_job_codes', 'Schedules Manage Job Codes', 'Create and edit global job codes.', 'global'),
  ('schedules.view_audit', 'Schedules View Audit', 'View schedule audit events.', 'client')
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  scope_type = excluded.scope_type,
  updated_at = now();

create or replace function public.schedule_normalize_role_token(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(p_value, ''))), '\\s+', '_', 'g');
$$;

create or replace function public.schedule_role_token_from_text(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := public.schedule_normalize_role_token(p_value);
begin
  if normalized = '' then
    return 'agent';
  end if;

  if normalized like '%team_leader%' or normalized in ('teamlead', 'teamlead_agent', 'tl') then
    return 'team_leader';
  end if;

  if normalized like '%manager%' then
    return 'manager';
  end if;

  if normalized like '%agent%' or normalized like '%csr%' or normalized like '%customer_service%' then
    return 'agent';
  end if;

  return 'agent';
end;
$$;

create or replace function public.schedule_role_label_from_token(p_token text)
returns text
language sql
immutable
as $$
  select case public.schedule_normalize_role_token(p_token)
    when 'manager' then 'Manager'
    when 'team_leader' then 'Team Leader'
    else 'Agent'
  end;
$$;

create or replace function public.schedule_role_rank(p_token text)
returns integer
language sql
immutable
as $$
  select case public.schedule_normalize_role_token(p_token)
    when 'manager' then 1
    when 'team_leader' then 2
    else 3
  end;
$$;

create or replace function public.schedule_is_leadership_role(p_token text)
returns boolean
language sql
immutable
as $$
  select public.schedule_normalize_role_token(p_token) in ('manager', 'team_leader');
$$;

create or replace function public.schedule_monday(p_day date)
returns date
language sql
immutable
as $$
  select p_day - ((extract(isodow from p_day)::int - 1))::int;
$$;

create table if not exists public.schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start_date date not null,
  timezone text not null default 'UTC',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by_user_id uuid references public.users(id) on delete set null,
  published_version integer not null default 0 check (published_version >= 0),
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_weeks_monday_check check (extract(isodow from week_start_date)::int = 1),
  unique (client_id, week_start_date)
);

create index if not exists schedule_weeks_client_week_idx
  on public.schedule_weeks(client_id, week_start_date desc);

drop trigger if exists trg_schedule_weeks_updated_at on public.schedule_weeks;
create trigger trg_schedule_weeks_updated_at
before update on public.schedule_weeks
for each row execute function public.set_updated_at();

create table if not exists public.schedule_roster_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  employee_info_record_id uuid references public.employee_info_records(id) on delete set null,
  display_name text not null,
  email text,
  role_token text not null default 'agent',
  role_label text not null default 'Agent',
  source text not null default 'manual' check (source in ('employee_info', 'manual', 'client_membership')),
  active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_roster_entries_display_name_not_blank check (length(trim(display_name)) > 0),
  constraint schedule_roster_entries_identity_check check (user_id is not null or employee_info_record_id is not null)
);

create unique index if not exists schedule_roster_entries_client_user_unique
  on public.schedule_roster_entries(client_id, user_id)
  where user_id is not null;

create unique index if not exists schedule_roster_entries_client_employee_record_unique
  on public.schedule_roster_entries(client_id, employee_info_record_id)
  where employee_info_record_id is not null;

create index if not exists schedule_roster_entries_client_active_role_idx
  on public.schedule_roster_entries(client_id, active, role_token, display_name);

drop trigger if exists trg_schedule_roster_entries_updated_at on public.schedule_roster_entries;
create trigger trg_schedule_roster_entries_updated_at
before update on public.schedule_roster_entries
for each row execute function public.set_updated_at();
create table if not exists public.schedule_job_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  color_hex text not null default '#2563EB' check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_job_codes_code_not_blank check (length(trim(code)) > 0),
  constraint schedule_job_codes_label_not_blank check (length(trim(label)) > 0)
);

create index if not exists schedule_job_codes_sort_idx
  on public.schedule_job_codes(sort_order, label);

drop trigger if exists trg_schedule_job_codes_updated_at on public.schedule_job_codes;
create trigger trg_schedule_job_codes_updated_at
before update on public.schedule_job_codes
for each row execute function public.set_updated_at();

insert into public.schedule_job_codes (code, label, color_hex, sort_order)
values
  ('GEN', 'General', '#2563EB', 10),
  ('SUPPORT', 'Support', '#0284C7', 20),
  ('SALES', 'Sales', '#16A34A', 30),
  ('QA', 'QA', '#9333EA', 40)
on conflict (code) do nothing;

create table if not exists public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  roster_entry_id uuid references public.schedule_roster_entries(id) on delete set null,
  assignee_user_id uuid references public.users(id) on delete set null,
  is_open boolean not null default false,
  local_date date not null,
  start_local_time time not null,
  end_local_time time not null,
  ends_next_day boolean not null default false,
  break_minutes integer not null default 0,
  job_code_id uuid references public.schedule_job_codes(id) on delete set null,
  notes text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_shifts_open_assignment_check
    check ((is_open and roster_entry_id is null and assignee_user_id is null) or ((not is_open) and roster_entry_id is not null)),
  constraint schedule_shifts_break_nonnegative_check check (break_minutes >= 0),
  constraint schedule_shifts_time_bounds_check check (end_at > start_at)
);

create index if not exists schedule_shifts_week_day_idx
  on public.schedule_shifts(week_id, local_date, start_local_time);

create index if not exists schedule_shifts_client_time_idx
  on public.schedule_shifts(client_id, start_at, end_at);

create index if not exists schedule_shifts_assignee_idx
  on public.schedule_shifts(assignee_user_id, start_at, end_at)
  where assignee_user_id is not null;

drop trigger if exists trg_schedule_shifts_updated_at on public.schedule_shifts;
create trigger trg_schedule_shifts_updated_at
before update on public.schedule_shifts
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_shifts_no_user_overlap'
      and conrelid = 'public.schedule_shifts'::regclass
  ) then
    alter table public.schedule_shifts
      add constraint schedule_shifts_no_user_overlap
      exclude using gist (
        assignee_user_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      )
      where (assignee_user_id is not null);
  end if;
end
$$;

create table if not exists public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_templates_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists schedule_templates_client_idx
  on public.schedule_templates(client_id, created_at desc);

drop trigger if exists trg_schedule_templates_updated_at on public.schedule_templates;
create trigger trg_schedule_templates_updated_at
before update on public.schedule_templates
for each row execute function public.set_updated_at();

create table if not exists public.schedule_template_shifts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.schedule_templates(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7),
  is_open boolean not null default false,
  employee_user_id uuid references public.users(id) on delete set null,
  role_token text not null default 'agent',
  slot_index integer not null default 1 check (slot_index >= 1),
  start_local_time time not null,
  end_local_time time not null,
  ends_next_day boolean not null default false,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  job_code_id uuid references public.schedule_job_codes(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_template_shifts_template_idx
  on public.schedule_template_shifts(template_id, weekday, role_token, slot_index, start_local_time);

drop trigger if exists trg_schedule_template_shifts_updated_at on public.schedule_template_shifts;
create trigger trg_schedule_template_shifts_updated_at
before update on public.schedule_template_shifts
for each row execute function public.set_updated_at();

create table if not exists public.schedule_audit_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_id uuid references public.schedule_weeks(id) on delete set null,
  shift_id uuid references public.schedule_shifts(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists schedule_audit_events_week_idx
  on public.schedule_audit_events(week_id, created_at desc);

create index if not exists schedule_audit_events_client_idx
  on public.schedule_audit_events(client_id, created_at desc);

create table if not exists public.schedule_publications (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  version integer not null check (version >= 1),
  published_by_user_id uuid references public.users(id) on delete set null,
  published_at timestamptz not null default now(),
  snapshot_json jsonb not null default '{}'::jsonb,
  unique (week_id, version)
);

create index if not exists schedule_publications_week_idx
  on public.schedule_publications(week_id, version desc);

create or replace function public.schedule_can_view_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_view_page('schedules')
    and public.can_access_client(client_uuid);
$$;

create or replace function public.schedule_can_edit_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as user_id
  )
  select auth.uid() is not null
    and public.can_edit_page('schedules')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('schedules.edit', 'client', client_uuid)
      or exists (
        select 1
        from public.schedule_roster_entries sre
        join me on me.user_id = sre.user_id
        where sre.client_id = client_uuid
          and sre.active
          and public.schedule_is_leadership_role(sre.role_token)
      )
    );
$$;

create or replace function public.schedule_can_publish_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as user_id
  )
  select auth.uid() is not null
    and public.can_edit_page('schedules')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('schedules.publish', 'client', client_uuid)
      or exists (
        select 1
        from public.schedule_roster_entries sre
        join me on me.user_id = sre.user_id
        where sre.client_id = client_uuid
          and sre.active
          and public.schedule_is_leadership_role(sre.role_token)
      )
    );
$$;
create or replace function public.schedule_can_unpublish_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as user_id
  )
  select auth.uid() is not null
    and public.can_edit_page('schedules')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('schedules.unpublish', 'client', client_uuid)
      or exists (
        select 1
        from public.schedule_roster_entries sre
        join me on me.user_id = sre.user_id
        where sre.client_id = client_uuid
          and sre.active
          and public.schedule_is_leadership_role(sre.role_token)
      )
    );
$$;

create or replace function public.schedule_can_manage_templates_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select public.current_app_user_id() as user_id
  )
  select auth.uid() is not null
    and public.can_edit_page('schedules')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('schedules.manage_templates', 'client', client_uuid)
      or exists (
        select 1
        from public.schedule_roster_entries sre
        join me on me.user_id = sre.user_id
        where sre.client_id = client_uuid
          and sre.active
          and public.schedule_is_leadership_role(sre.role_token)
      )
    );
$$;

create or replace function public.schedule_can_claim_open_shift_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.schedule_can_view_client(client_uuid);
$$;

create or replace function public.schedule_can_manage_job_codes()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('schedules')
    and (public.is_admin() or public.has_permission('schedules.manage_job_codes'));
$$;

create or replace function public.schedule_can_view_audit_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.schedule_can_view_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('schedules.view_audit', 'client', client_uuid)
      or public.schedule_can_edit_client(client_uuid)
    );
$$;

create or replace function public.schedule_week_is_visible(week_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.schedule_weeks w
    where w.id = week_uuid
      and public.schedule_can_view_client(w.client_id)
      and (w.status = 'published' or public.schedule_can_edit_client(w.client_id))
  );
$$;

create or replace function public.schedule_log_audit_event(
  p_client_id uuid,
  p_week_id uuid,
  p_shift_id uuid,
  p_action text,
  p_before_json jsonb default '{}'::jsonb,
  p_after_json jsonb default '{}'::jsonb,
  p_metadata_json jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = 'public'
as $$
  insert into public.schedule_audit_events (
    client_id,
    week_id,
    shift_id,
    actor_user_id,
    action,
    before_json,
    after_json,
    metadata_json
  )
  values (
    p_client_id,
    p_week_id,
    p_shift_id,
    public.current_app_user_id(),
    coalesce(nullif(trim(p_action), ''), 'schedule.event'),
    coalesce(p_before_json, '{}'::jsonb),
    coalesce(p_after_json, '{}'::jsonb),
    coalesce(p_metadata_json, '{}'::jsonb)
  );
$$;

create or replace function public.schedule_notify_users(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key_suffix text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  recipient_id uuid;
  dedupe_key text;
  normalized_type text := coalesce(nullif(trim(p_type), ''), 'schedule_update');
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  foreach recipient_id in array p_user_ids loop
    if recipient_id is null then
      continue;
    end if;

    dedupe_key := null;
    if p_dedupe_key_suffix is not null and length(trim(p_dedupe_key_suffix)) > 0 then
      dedupe_key := normalized_type || ':' || recipient_id::text || ':' || trim(p_dedupe_key_suffix);
    end if;

    insert into public.notifications (
      user_id,
      actor_user_id,
      type,
      title,
      body,
      metadata,
      dedupe_key
    )
    values (
      recipient_id,
      auth.uid(),
      normalized_type,
      coalesce(nullif(trim(p_title), ''), 'Schedule updated'),
      nullif(trim(coalesce(p_body, '')), ''),
      coalesce(p_metadata, '{}'::jsonb),
      dedupe_key
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end;
$$;

create or replace function public.schedule_before_shift_write()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  roster_row public.schedule_roster_entries%rowtype;
  actor_id uuid := public.current_app_user_id();
  end_date date;
  start_local_ts timestamp;
  end_local_ts timestamp;
  shift_minutes integer;
begin
  select *
  into week_row
  from public.schedule_weeks w
  where w.id = new.week_id
  limit 1;

  if week_row.id is null then
    raise exception 'Schedule week not found';
  end if;

  new.client_id := week_row.client_id;

  if new.is_open then
    new.roster_entry_id := null;
    new.assignee_user_id := null;
  else
    if new.roster_entry_id is null then
      raise exception 'Shift assignee is required for non-open shifts';
    end if;

    select *
    into roster_row
    from public.schedule_roster_entries r
    where r.id = new.roster_entry_id
    limit 1;

    if roster_row.id is null then
      raise exception 'Roster entry not found';
    end if;

    if roster_row.client_id <> week_row.client_id then
      raise exception 'Roster entry must belong to the same client';
    end if;

    if not roster_row.active then
      raise exception 'Roster entry is inactive';
    end if;

    new.assignee_user_id := roster_row.user_id;
  end if;

  if (not new.ends_next_day) and new.end_local_time <= new.start_local_time then
    raise exception 'End time must be after start time unless the shift ends next day';
  end if;

  end_date := new.local_date + case when new.ends_next_day then 1 else 0 end;
  start_local_ts := ((new.local_date::text || ' ' || new.start_local_time::text)::timestamp);
  end_local_ts := ((end_date::text || ' ' || new.end_local_time::text)::timestamp);

  new.start_at := start_local_ts at time zone week_row.timezone;
  new.end_at := end_local_ts at time zone week_row.timezone;

  if new.end_at <= new.start_at then
    raise exception 'Shift end time must be after shift start time';
  end if;

  shift_minutes := floor(extract(epoch from (new.end_at - new.start_at)) / 60.0);
  if new.break_minutes < 0 then
    raise exception 'Break minutes cannot be negative';
  end if;
  if new.break_minutes >= shift_minutes then
    raise exception 'Break minutes must be less than shift duration';
  end if;

  if tg_op = 'INSERT' and new.created_by_user_id is null then
    new.created_by_user_id := actor_id;
  end if;
  new.updated_by_user_id := actor_id;

  return new;
end;
$$;

drop trigger if exists trg_schedule_shifts_before_write on public.schedule_shifts;
create trigger trg_schedule_shifts_before_write
before insert or update on public.schedule_shifts
for each row execute function public.schedule_before_shift_write();
create or replace function public.schedule_sync_roster_for_client(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  role_column_id uuid;
  upserted_count integer := 0;
  deactivated_count integer := 0;
begin
  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to sync schedule roster';
  end if;

  select c.id
  into role_column_id
  from public.employee_info_columns c
  where c.column_kind <> 'formula'
    and (
      public.schedule_normalize_role_token(c.key) in ('role', 'employee_role', 'job_role')
      or public.schedule_normalize_role_token(c.label) in ('role', 'employee_role', 'job_role')
    )
  order by c.position asc, c.created_at asc
  limit 1;

  with unique_user_name as (
    select
      lower(trim(coalesce(u.full_name, ''))) as name_key,
      min(u.id::text)::uuid as user_id,
      count(*) as user_count
    from public.users u
    where length(trim(coalesce(u.full_name, ''))) > 0
    group by lower(trim(coalesce(u.full_name, '')))
  ),
  employee_scope as (
    select
      r.id as record_id,
      r.full_name,
      coalesce(
        r.user_id,
        case when uu.user_count = 1 then uu.user_id else null end
      ) as resolved_user_id,
      coalesce(v.option_value, v.text_value, '') as role_text
    from public.employee_info_records r
    left join unique_user_name uu
      on uu.name_key = lower(trim(coalesce(r.full_name, '')))
    left join public.employee_info_values v
      on v.record_id = r.id
     and v.column_id = role_column_id
    where r.client_id = p_client_id
  ),
  update_employee_links as (
    update public.employee_info_records r
    set
      user_id = es.resolved_user_id,
      updated_at = now()
    from employee_scope es
    where r.id = es.record_id
      and r.user_id is distinct from es.resolved_user_id
      and es.resolved_user_id is not null
    returning r.id
  ),
  upsert_employee_rows as (
    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      employee_info_record_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    select
      p_client_id,
      es.resolved_user_id,
      es.record_id,
      es.full_name,
      u.email,
      public.schedule_role_token_from_text(es.role_text),
      public.schedule_role_label_from_token(public.schedule_role_token_from_text(es.role_text)),
      'employee_info',
      true,
      actor_id
    from employee_scope es
    left join public.users u on u.id = es.resolved_user_id
    on conflict (client_id, employee_info_record_id)
    do update set
      user_id = excluded.user_id,
      display_name = excluded.display_name,
      email = excluded.email,
      role_token = excluded.role_token,
      role_label = excluded.role_label,
      source = 'employee_info',
      active = true,
      updated_at = now()
    returning id
  ),
  upsert_client_memberships as (
    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      employee_info_record_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    select
      p_client_id,
      u.id,
      null,
      coalesce(nullif(trim(u.full_name), ''), u.email, 'Team member'),
      u.email,
      'agent',
      'Agent',
      'client_membership',
      true,
      actor_id
    from public.client_users cu
    join public.users u on u.id = cu.user_id
    where cu.client_id = p_client_id
    on conflict (client_id, user_id)
    do update set
      display_name = excluded.display_name,
      email = excluded.email,
      active = true,
      source = case
        when public.schedule_roster_entries.source = 'employee_info' then public.schedule_roster_entries.source
        else excluded.source
      end,
      updated_at = now()
    returning id
  )
  select
    coalesce((select count(*) from upsert_employee_rows), 0)
      + coalesce((select count(*) from upsert_client_memberships), 0)
  into upserted_count;

  with stale as (
    update public.schedule_roster_entries sre
    set
      active = false,
      updated_at = now()
    where sre.client_id = p_client_id
      and sre.source = 'employee_info'
      and sre.employee_info_record_id is not null
      and not exists (
        select 1
        from public.employee_info_records r
        where r.id = sre.employee_info_record_id
          and r.client_id = p_client_id
      )
    returning sre.id
  )
  select coalesce(count(*), 0) into deactivated_count from stale;

  return jsonb_build_object(
    'upserted', upserted_count,
    'deactivated', deactivated_count
  );
end;
$$;

create or replace function public.schedule_get_or_create_week(
  p_client_id uuid,
  p_reference_date date default current_date,
  p_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  week_id uuid;
  week_start date := public.schedule_monday(coalesce(p_reference_date, current_date));
  tz text := coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'UTC');
begin
  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to create schedule weeks';
  end if;

  insert into public.schedule_weeks (
    client_id,
    week_start_date,
    timezone,
    status,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    p_client_id,
    week_start,
    tz,
    'draft',
    actor_id,
    actor_id
  )
  on conflict (client_id, week_start_date)
  do update set
    timezone = excluded.timezone,
    updated_by_user_id = actor_id,
    updated_at = now()
  returning id into week_id;

  perform public.schedule_sync_roster_for_client(p_client_id);

  return week_id;
end;
$$;

create or replace function public.schedule_add_roster_user(
  p_client_id uuid,
  p_user_id uuid,
  p_role_token text default 'agent'
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  normalized_role text := public.schedule_role_token_from_text(p_role_token);
  roster_id uuid;
  profile_row record;
begin
  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to manage roster';
  end if;

  select u.id, u.full_name, u.email
  into profile_row
  from public.users u
  where u.id = p_user_id
  limit 1;

  if profile_row.id is null then
    raise exception 'User not found';
  end if;

  insert into public.schedule_roster_entries (
    client_id,
    user_id,
    employee_info_record_id,
    display_name,
    email,
    role_token,
    role_label,
    source,
    active,
    created_by_user_id
  )
  values (
    p_client_id,
    profile_row.id,
    null,
    coalesce(nullif(trim(coalesce(profile_row.full_name, '')), ''), profile_row.email, 'Team member'),
    profile_row.email,
    normalized_role,
    public.schedule_role_label_from_token(normalized_role),
    'manual',
    true,
    actor_id
  )
  on conflict (client_id, user_id)
  do update set
    role_token = excluded.role_token,
    role_label = excluded.role_label,
    display_name = excluded.display_name,
    email = excluded.email,
    source = case
      when public.schedule_roster_entries.source = 'employee_info' then public.schedule_roster_entries.source
      else 'manual'
    end,
    active = true,
    updated_at = now()
  returning id into roster_id;

  return roster_id;
end;
$$;

create or replace function public.schedule_remove_roster_user(p_roster_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  roster_row public.schedule_roster_entries%rowtype;
begin
  select *
  into roster_row
  from public.schedule_roster_entries
  where id = p_roster_entry_id
  limit 1;

  if roster_row.id is null then
    return false;
  end if;

  if not public.schedule_can_edit_client(roster_row.client_id) then
    raise exception 'Not authorized to manage roster';
  end if;

  update public.schedule_roster_entries
  set
    active = false,
    updated_at = now()
  where id = roster_row.id;

  return true;
end;
$$;

create or replace function public.schedule_notify_week_team(
  p_client_id uuid,
  p_type text,
  p_title text,
  p_body text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(distinct x.user_id), '{}'::uuid[])
  into recipient_ids
  from (
    select cu.user_id
    from public.client_users cu
    where cu.client_id = p_client_id
    union
    select sre.user_id
    from public.schedule_roster_entries sre
    where sre.client_id = p_client_id
      and sre.active
      and sre.user_id is not null
  ) as x;

  perform public.schedule_notify_users(
    recipient_ids,
    p_type,
    p_title,
    p_body,
    jsonb_build_object('source_url', '/schedules/' || p_client_id::text),
    p_client_id::text || ':' || coalesce(nullif(trim(p_type), ''), 'schedule_update')
  );
end;
$$;
create or replace function public.schedule_upsert_shift(
  p_week_id uuid,
  p_shift_id uuid default null,
  p_roster_entry_id uuid default null,
  p_is_open boolean default false,
  p_local_date date default null,
  p_start_local_time time default null,
  p_end_local_time time default null,
  p_ends_next_day boolean default false,
  p_break_minutes integer default 0,
  p_job_code_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  old_shift public.schedule_shifts%rowtype;
  new_shift public.schedule_shifts%rowtype;
  shift_id uuid;
  route_path text;
begin
  select *
  into week_row
  from public.schedule_weeks
  where id = p_week_id
  limit 1;

  if week_row.id is null then
    raise exception 'Schedule week not found';
  end if;

  if not public.schedule_can_edit_client(week_row.client_id) then
    raise exception 'Not authorized to edit this schedule';
  end if;

  if p_local_date is null then
    raise exception 'Shift date is required';
  end if;
  if p_start_local_time is null then
    raise exception 'Shift start time is required';
  end if;
  if p_end_local_time is null then
    raise exception 'Shift end time is required';
  end if;

  if p_shift_id is null then
    insert into public.schedule_shifts (
      week_id,
      client_id,
      roster_entry_id,
      is_open,
      local_date,
      start_local_time,
      end_local_time,
      ends_next_day,
      break_minutes,
      job_code_id,
      notes,
      start_at,
      end_at
    )
    values (
      week_row.id,
      week_row.client_id,
      case when p_is_open then null else p_roster_entry_id end,
      coalesce(p_is_open, false),
      p_local_date,
      p_start_local_time,
      p_end_local_time,
      coalesce(p_ends_next_day, false),
      coalesce(p_break_minutes, 0),
      p_job_code_id,
      nullif(trim(coalesce(p_notes, '')), ''),
      now(),
      now() + interval '1 minute'
    )
    returning id into shift_id;
  else
    select *
    into old_shift
    from public.schedule_shifts
    where id = p_shift_id
      and week_id = week_row.id
    for update;

    if old_shift.id is null then
      raise exception 'Shift not found for this week';
    end if;

    update public.schedule_shifts s
    set
      roster_entry_id = case when p_is_open then null else p_roster_entry_id end,
      is_open = coalesce(p_is_open, false),
      local_date = p_local_date,
      start_local_time = p_start_local_time,
      end_local_time = p_end_local_time,
      ends_next_day = coalesce(p_ends_next_day, false),
      break_minutes = coalesce(p_break_minutes, 0),
      job_code_id = p_job_code_id,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
    where s.id = old_shift.id;

    shift_id := old_shift.id;
  end if;

  select *
  into new_shift
  from public.schedule_shifts
  where id = shift_id
  limit 1;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    new_shift.id,
    case when p_shift_id is null then 'shift.created' else 'shift.updated' end,
    case when p_shift_id is null then '{}'::jsonb else to_jsonb(old_shift) end,
    to_jsonb(new_shift),
    '{}'::jsonb
  );

  if week_row.status = 'published' and new_shift.assignee_user_id is not null then
    route_path := '/schedules/' || week_row.client_id::text || '?week=' || week_row.week_start_date::text;
    perform public.schedule_notify_users(
      array[new_shift.assignee_user_id],
      case when p_shift_id is null then 'schedule_shift_created' else 'schedule_shift_updated' end,
      case when p_shift_id is null then 'New published shift assigned' else 'Published shift updated' end,
      'A published shift in your schedule was updated.',
      jsonb_build_object('source_url', route_path, 'schedule_shift_id', new_shift.id),
      new_shift.id::text || ':' || week_row.published_version::text || ':' || coalesce(p_shift_id::text, 'new')
    );
  end if;

  return shift_id;
exception
  when exclusion_violation then
    raise exception 'Shift overlaps with an existing shift for this employee';
end;
$$;

create or replace function public.schedule_delete_shift(p_shift_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  shift_row public.schedule_shifts%rowtype;
  week_row public.schedule_weeks%rowtype;
  route_path text;
begin
  select *
  into shift_row
  from public.schedule_shifts
  where id = p_shift_id
  for update;

  if shift_row.id is null then
    return false;
  end if;

  select *
  into week_row
  from public.schedule_weeks
  where id = shift_row.week_id
  limit 1;

  if week_row.id is null then
    return false;
  end if;

  if not public.schedule_can_edit_client(week_row.client_id) then
    raise exception 'Not authorized to delete shifts';
  end if;

  delete from public.schedule_shifts
  where id = shift_row.id;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    shift_row.id,
    'shift.deleted',
    to_jsonb(shift_row),
    '{}'::jsonb,
    '{}'::jsonb
  );

  if week_row.status = 'published' and shift_row.assignee_user_id is not null then
    route_path := '/schedules/' || week_row.client_id::text || '?week=' || week_row.week_start_date::text;
    perform public.schedule_notify_users(
      array[shift_row.assignee_user_id],
      'schedule_shift_deleted',
      'Published shift removed',
      'A published shift was removed from your schedule.',
      jsonb_build_object('source_url', route_path, 'schedule_shift_id', shift_row.id),
      shift_row.id::text || ':deleted:' || week_row.published_version::text
    );
  end if;

  return true;
end;
$$;

create or replace function public.schedule_claim_open_shift(p_shift_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  shift_row public.schedule_shifts%rowtype;
  week_row public.schedule_weeks%rowtype;
  roster_id uuid;
  actor_profile record;
  route_path text;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into shift_row
  from public.schedule_shifts
  where id = p_shift_id
  for update;

  if shift_row.id is null then
    raise exception 'Open shift not found';
  end if;

  select *
  into week_row
  from public.schedule_weeks
  where id = shift_row.week_id
  limit 1;

  if week_row.id is null then
    raise exception 'Week not found';
  end if;

  if not public.schedule_can_claim_open_shift_client(week_row.client_id) then
    raise exception 'Not authorized to claim open shifts';
  end if;

  if not shift_row.is_open or shift_row.roster_entry_id is not null then
    raise exception 'Shift is no longer open';
  end if;

  select id
  into roster_id
  from public.schedule_roster_entries
  where client_id = week_row.client_id
    and user_id = actor_id
  limit 1;

  if roster_id is null then
    select u.id, u.full_name, u.email
    into actor_profile
    from public.users u
    where u.id = actor_id
    limit 1;

    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    values (
      week_row.client_id,
      actor_id,
      coalesce(nullif(trim(coalesce(actor_profile.full_name, '')), ''), actor_profile.email, 'Team member'),
      actor_profile.email,
      'agent',
      'Agent',
      'manual',
      true,
      actor_id
    )
    on conflict (client_id, user_id)
    do update set
      active = true,
      updated_at = now()
    returning id into roster_id;
  end if;

  update public.schedule_shifts s
  set
    is_open = false,
    roster_entry_id = roster_id,
    updated_at = now()
  where s.id = shift_row.id;

  select *
  into shift_row
  from public.schedule_shifts
  where id = p_shift_id
  limit 1;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    shift_row.id,
    'shift.open_claimed',
    '{}'::jsonb,
    to_jsonb(shift_row),
    jsonb_build_object('claimed_by_user_id', actor_id)
  );

  route_path := '/schedules/' || week_row.client_id::text || '?week=' || week_row.week_start_date::text;
  perform public.schedule_notify_week_team(
    week_row.client_id,
    'schedule_open_shift_claimed',
    'Open shift claimed',
    'An open shift was claimed.'
  );

  perform public.schedule_notify_users(
    array[actor_id],
    'schedule_open_shift_claimed',
    'You claimed an open shift',
    'The open shift is now assigned to you.',
    jsonb_build_object('source_url', route_path, 'schedule_shift_id', shift_row.id),
    shift_row.id::text || ':claimed'
  );

  return shift_row.id;
exception
  when exclusion_violation then
    raise exception 'Cannot claim this shift because it overlaps an existing shift';
end;
$$;

create or replace function public.schedule_publish_week(p_week_id uuid)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  next_version integer;
  snapshot jsonb;
begin
  select *
  into week_row
  from public.schedule_weeks
  where id = p_week_id
  for update;

  if week_row.id is null then
    raise exception 'Week not found';
  end if;

  if not public.schedule_can_publish_client(week_row.client_id) then
    raise exception 'Not authorized to publish';
  end if;

  next_version := coalesce(week_row.published_version, 0) + 1;

  update public.schedule_weeks
  set
    status = 'published',
    published_at = now(),
    published_by_user_id = public.current_app_user_id(),
    published_version = next_version,
    updated_by_user_id = public.current_app_user_id(),
    updated_at = now()
  where id = week_row.id;

  select jsonb_build_object(
    'week', to_jsonb(w),
    'shifts',
      coalesce(
        (
          select jsonb_agg(to_jsonb(s) order by s.local_date, s.start_local_time, s.created_at)
          from public.schedule_shifts s
          where s.week_id = w.id
        ),
        '[]'::jsonb
      )
  )
  into snapshot
  from public.schedule_weeks w
  where w.id = week_row.id;

  insert into public.schedule_publications (
    week_id,
    version,
    published_by_user_id,
    published_at,
    snapshot_json
  )
  values (
    week_row.id,
    next_version,
    public.current_app_user_id(),
    now(),
    coalesce(snapshot, '{}'::jsonb)
  );

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    null,
    'week.published',
    to_jsonb(week_row),
    jsonb_build_object('published_version', next_version),
    '{}'::jsonb
  );

  perform public.schedule_notify_week_team(
    week_row.client_id,
    'schedule_week_published',
    'Schedule published',
    'The weekly schedule is now published.'
  );

  return next_version;
end;
$$;

create or replace function public.schedule_unpublish_week(p_week_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
begin
  select *
  into week_row
  from public.schedule_weeks
  where id = p_week_id
  for update;

  if week_row.id is null then
    raise exception 'Week not found';
  end if;

  if not public.schedule_can_unpublish_client(week_row.client_id) then
    raise exception 'Not authorized to unpublish';
  end if;

  update public.schedule_weeks
  set
    status = 'draft',
    updated_by_user_id = public.current_app_user_id(),
    updated_at = now()
  where id = week_row.id;

  perform public.schedule_log_audit_event(
    week_row.client_id,
    week_row.id,
    null,
    'week.unpublished',
    to_jsonb(week_row),
    jsonb_build_object('status', 'draft'),
    '{}'::jsonb
  );

  perform public.schedule_notify_week_team(
    week_row.client_id,
    'schedule_week_unpublished',
    'Schedule unpublished',
    'The weekly schedule moved back to draft.'
  );

  return true;
end;
$$;
create or replace function public.schedule_copy_previous_week(p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_week public.schedule_weeks%rowtype;
  previous_week public.schedule_weeks%rowtype;
  day_offset integer;
  inserted_count integer := 0;
  warning_messages text[] := '{}'::text[];
  row_shift record;
begin
  select *
  into target_week
  from public.schedule_weeks
  where id = p_week_id
  limit 1;

  if target_week.id is null then
    raise exception 'Week not found';
  end if;

  if not public.schedule_can_edit_client(target_week.client_id) then
    raise exception 'Not authorized to copy shifts';
  end if;

  select *
  into previous_week
  from public.schedule_weeks
  where client_id = target_week.client_id
    and week_start_date = target_week.week_start_date - 7
  limit 1;

  if previous_week.id is null then
    return jsonb_build_object('inserted', 0, 'warnings', jsonb_build_array('No previous week found'));
  end if;

  day_offset := target_week.week_start_date - previous_week.week_start_date;

  for row_shift in
    select
      s.*,
      r.active as roster_active,
      r.display_name as roster_name
    from public.schedule_shifts s
    left join public.schedule_roster_entries r on r.id = s.roster_entry_id
    where s.week_id = previous_week.id
    order by s.local_date, s.start_local_time, s.created_at
  loop
    begin
      if row_shift.is_open then
        insert into public.schedule_shifts (
          week_id, client_id, roster_entry_id, assignee_user_id, is_open,
          local_date, start_local_time, end_local_time, ends_next_day,
          break_minutes, job_code_id, notes, start_at, end_at
        ) values (
          target_week.id, target_week.client_id, null, null, true,
          row_shift.local_date + day_offset,
          row_shift.start_local_time,
          row_shift.end_local_time,
          row_shift.ends_next_day,
          row_shift.break_minutes,
          row_shift.job_code_id,
          row_shift.notes,
          now(),
          now() + interval '1 minute'
        );
        inserted_count := inserted_count + 1;
      else
        if row_shift.roster_entry_id is null then
          warning_messages := array_append(warning_messages, 'Skipped shift with missing assignee on ' || row_shift.local_date::text);
          continue;
        end if;
        if row_shift.roster_active is not true then
          warning_messages := array_append(warning_messages, 'Skipped shift for inactive employee ' || coalesce(row_shift.roster_name, '(unknown)'));
          continue;
        end if;

        insert into public.schedule_shifts (
          week_id, client_id, roster_entry_id, is_open,
          local_date, start_local_time, end_local_time, ends_next_day,
          break_minutes, job_code_id, notes, start_at, end_at
        ) values (
          target_week.id,
          target_week.client_id,
          row_shift.roster_entry_id,
          false,
          row_shift.local_date + day_offset,
          row_shift.start_local_time,
          row_shift.end_local_time,
          row_shift.ends_next_day,
          row_shift.break_minutes,
          row_shift.job_code_id,
          row_shift.notes,
          now(),
          now() + interval '1 minute'
        );
        inserted_count := inserted_count + 1;
      end if;
    exception
      when exclusion_violation then
        warning_messages := array_append(
          warning_messages,
          'Skipped overlapping shift for ' || coalesce(row_shift.roster_name, '(employee)')
        );
      when others then
        warning_messages := array_append(
          warning_messages,
          'Skipped shift: ' || SQLERRM
        );
    end;
  end loop;

  perform public.schedule_log_audit_event(
    target_week.client_id,
    target_week.id,
    null,
    'week.copied_previous',
    '{}'::jsonb,
    jsonb_build_object('inserted', inserted_count, 'warning_count', coalesce(array_length(warning_messages, 1), 0)),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'inserted', inserted_count,
    'warnings', to_jsonb(coalesce(warning_messages, '{}'::text[]))
  );
end;
$$;

create or replace function public.schedule_create_template_from_week(p_week_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  template_id uuid;
  row_shift record;
  slot_counter_by_key jsonb := '{}'::jsonb;
  role_token text;
  slot_key text;
  next_slot integer;
begin
  select * into week_row from public.schedule_weeks where id = p_week_id limit 1;
  if week_row.id is null then raise exception 'Week not found'; end if;
  if not public.schedule_can_manage_templates_client(week_row.client_id) then
    raise exception 'Not authorized to create templates';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Template name is required';
  end if;

  insert into public.schedule_templates (client_id, name, created_by_user_id)
  values (week_row.client_id, trim(p_name), public.current_app_user_id())
  returning id into template_id;

  for row_shift in
    select s.*, coalesce(r.role_token, 'agent') as role_token
    from public.schedule_shifts s
    left join public.schedule_roster_entries r on r.id = s.roster_entry_id
    where s.week_id = week_row.id
    order by s.local_date, s.start_local_time, s.created_at
  loop
    role_token := public.schedule_role_token_from_text(row_shift.role_token);
    slot_key := extract(isodow from row_shift.local_date)::int::text || ':' || role_token;
    next_slot := coalesce((slot_counter_by_key ->> slot_key)::int, 0) + 1;
    slot_counter_by_key := jsonb_set(slot_counter_by_key, array[slot_key], to_jsonb(next_slot), true);

    insert into public.schedule_template_shifts (
      template_id, weekday, is_open, employee_user_id, role_token, slot_index,
      start_local_time, end_local_time, ends_next_day, break_minutes, job_code_id, notes
    ) values (
      template_id,
      extract(isodow from row_shift.local_date)::int,
      row_shift.is_open,
      row_shift.assignee_user_id,
      role_token,
      next_slot,
      row_shift.start_local_time,
      row_shift.end_local_time,
      row_shift.ends_next_day,
      row_shift.break_minutes,
      row_shift.job_code_id,
      row_shift.notes
    );
  end loop;

  return template_id;
end;
$$;

create or replace function public.schedule_apply_template_to_week(
  p_week_id uuid,
  p_template_id uuid,
  p_mapping_mode text default 'role_slot'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  week_row public.schedule_weeks%rowtype;
  template_row public.schedule_templates%rowtype;
  mapping_mode text := case lower(trim(coalesce(p_mapping_mode, '')))
    when 'by_employee' then 'by_employee'
    when 'employee' then 'by_employee'
    else 'role_slot'
  end;
  inserted_count integer := 0;
  warning_messages text[] := '{}'::text[];
  template_shift record;
  target_roster_id uuid;
begin
  select * into week_row from public.schedule_weeks where id = p_week_id limit 1;
  if week_row.id is null then raise exception 'Week not found'; end if;

  select * into template_row from public.schedule_templates where id = p_template_id limit 1;
  if template_row.id is null then raise exception 'Template not found'; end if;
  if template_row.client_id <> week_row.client_id then raise exception 'Template must belong to the same client'; end if;
  if not public.schedule_can_manage_templates_client(week_row.client_id) then raise exception 'Not authorized to apply templates'; end if;
  if week_row.status <> 'draft' then raise exception 'Templates can only be applied to draft weeks'; end if;

  delete from public.schedule_shifts where week_id = week_row.id;

  for template_shift in
    select *
    from public.schedule_template_shifts t
    where t.template_id = template_row.id
    order by t.weekday, t.role_token, t.slot_index, t.start_local_time
  loop
    target_roster_id := null;

    if template_shift.is_open then
      target_roster_id := null;
    elsif mapping_mode = 'by_employee' and template_shift.employee_user_id is not null then
      select r.id into target_roster_id
      from public.schedule_roster_entries r
      where r.client_id = week_row.client_id
        and r.user_id = template_shift.employee_user_id
        and r.active
      limit 1;

      if target_roster_id is null then
        warning_messages := array_append(warning_messages, 'No employee match for template shift (weekday ' || template_shift.weekday::text || ')');
        continue;
      end if;
    else
      select candidate.id into target_roster_id
      from (
        select
          r.id,
          public.schedule_role_token_from_text(r.role_token) as role_token,
          row_number() over (
            partition by public.schedule_role_token_from_text(r.role_token)
            order by lower(r.display_name), r.id
          ) as role_slot
        from public.schedule_roster_entries r
        where r.client_id = week_row.client_id
          and r.active
      ) as candidate
      where candidate.role_token = public.schedule_role_token_from_text(template_shift.role_token)
        and candidate.role_slot = template_shift.slot_index
      limit 1;

      if target_roster_id is null then
        warning_messages := array_append(
          warning_messages,
          'No role-slot match for role ' || template_shift.role_token || ' slot ' || template_shift.slot_index::text
        );
        continue;
      end if;
    end if;

    begin
      insert into public.schedule_shifts (
        week_id, client_id, roster_entry_id, is_open,
        local_date, start_local_time, end_local_time, ends_next_day,
        break_minutes, job_code_id, notes, start_at, end_at
      )
      values (
        week_row.id,
        week_row.client_id,
        target_roster_id,
        template_shift.is_open,
        week_row.week_start_date + (template_shift.weekday - 1),
        template_shift.start_local_time,
        template_shift.end_local_time,
        template_shift.ends_next_day,
        template_shift.break_minutes,
        template_shift.job_code_id,
        template_shift.notes,
        now(),
        now() + interval '1 minute'
      );
      inserted_count := inserted_count + 1;
    exception
      when exclusion_violation then
        warning_messages := array_append(warning_messages, 'Skipped overlapping shift in template apply (weekday ' || template_shift.weekday::text || ')');
      when others then
        warning_messages := array_append(warning_messages, 'Template shift apply error: ' || SQLERRM);
    end;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_count,
    'warnings', to_jsonb(coalesce(warning_messages, '{}'::text[]))
  );
end;
$$;
alter table public.schedule_weeks enable row level security;
alter table public.schedule_roster_entries enable row level security;
alter table public.schedule_job_codes enable row level security;
alter table public.schedule_shifts enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.schedule_template_shifts enable row level security;
alter table public.schedule_audit_events enable row level security;
alter table public.schedule_publications enable row level security;

drop policy if exists schedule_weeks_select on public.schedule_weeks;
create policy schedule_weeks_select
  on public.schedule_weeks
  for select
  to authenticated
  using (public.schedule_can_view_client(client_id) and (status = 'published' or public.schedule_can_edit_client(client_id)));

drop policy if exists schedule_weeks_insert_block on public.schedule_weeks;
create policy schedule_weeks_insert_block on public.schedule_weeks for insert to authenticated with check (false);
drop policy if exists schedule_weeks_update_block on public.schedule_weeks;
create policy schedule_weeks_update_block on public.schedule_weeks for update to authenticated using (false) with check (false);
drop policy if exists schedule_weeks_delete_block on public.schedule_weeks;
create policy schedule_weeks_delete_block on public.schedule_weeks for delete to authenticated using (false);

drop policy if exists schedule_roster_entries_select on public.schedule_roster_entries;
create policy schedule_roster_entries_select
  on public.schedule_roster_entries
  for select
  to authenticated
  using (public.schedule_can_view_client(client_id));
drop policy if exists schedule_roster_entries_insert_block on public.schedule_roster_entries;
create policy schedule_roster_entries_insert_block on public.schedule_roster_entries for insert to authenticated with check (false);
drop policy if exists schedule_roster_entries_update_block on public.schedule_roster_entries;
create policy schedule_roster_entries_update_block on public.schedule_roster_entries for update to authenticated using (false) with check (false);
drop policy if exists schedule_roster_entries_delete_block on public.schedule_roster_entries;
create policy schedule_roster_entries_delete_block on public.schedule_roster_entries for delete to authenticated using (false);

drop policy if exists schedule_job_codes_select on public.schedule_job_codes;
create policy schedule_job_codes_select
  on public.schedule_job_codes
  for select
  to authenticated
  using (auth.uid() is not null and public.can_view_page('schedules'));
drop policy if exists schedule_job_codes_insert_block on public.schedule_job_codes;
create policy schedule_job_codes_insert_block on public.schedule_job_codes for insert to authenticated with check (false);
drop policy if exists schedule_job_codes_update_block on public.schedule_job_codes;
create policy schedule_job_codes_update_block on public.schedule_job_codes for update to authenticated using (false) with check (false);
drop policy if exists schedule_job_codes_delete_block on public.schedule_job_codes;
create policy schedule_job_codes_delete_block on public.schedule_job_codes for delete to authenticated using (false);

drop policy if exists schedule_shifts_select on public.schedule_shifts;
create policy schedule_shifts_select
  on public.schedule_shifts
  for select
  to authenticated
  using (public.schedule_week_is_visible(week_id));
drop policy if exists schedule_shifts_insert_block on public.schedule_shifts;
create policy schedule_shifts_insert_block on public.schedule_shifts for insert to authenticated with check (false);
drop policy if exists schedule_shifts_update_block on public.schedule_shifts;
create policy schedule_shifts_update_block on public.schedule_shifts for update to authenticated using (false) with check (false);
drop policy if exists schedule_shifts_delete_block on public.schedule_shifts;
create policy schedule_shifts_delete_block on public.schedule_shifts for delete to authenticated using (false);

drop policy if exists schedule_templates_select on public.schedule_templates;
create policy schedule_templates_select on public.schedule_templates for select to authenticated using (public.schedule_can_view_client(client_id));
drop policy if exists schedule_templates_insert_block on public.schedule_templates;
create policy schedule_templates_insert_block on public.schedule_templates for insert to authenticated with check (false);
drop policy if exists schedule_templates_update_block on public.schedule_templates;
create policy schedule_templates_update_block on public.schedule_templates for update to authenticated using (false) with check (false);
drop policy if exists schedule_templates_delete_block on public.schedule_templates;
create policy schedule_templates_delete_block on public.schedule_templates for delete to authenticated using (false);

drop policy if exists schedule_template_shifts_select on public.schedule_template_shifts;
create policy schedule_template_shifts_select
  on public.schedule_template_shifts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.schedule_templates t
      where t.id = schedule_template_shifts.template_id
        and public.schedule_can_view_client(t.client_id)
    )
  );
drop policy if exists schedule_template_shifts_insert_block on public.schedule_template_shifts;
create policy schedule_template_shifts_insert_block on public.schedule_template_shifts for insert to authenticated with check (false);
drop policy if exists schedule_template_shifts_update_block on public.schedule_template_shifts;
create policy schedule_template_shifts_update_block on public.schedule_template_shifts for update to authenticated using (false) with check (false);
drop policy if exists schedule_template_shifts_delete_block on public.schedule_template_shifts;
create policy schedule_template_shifts_delete_block on public.schedule_template_shifts for delete to authenticated using (false);

drop policy if exists schedule_audit_events_select on public.schedule_audit_events;
create policy schedule_audit_events_select
  on public.schedule_audit_events
  for select
  to authenticated
  using (public.schedule_can_view_audit_client(client_id));
drop policy if exists schedule_audit_events_insert_block on public.schedule_audit_events;
create policy schedule_audit_events_insert_block on public.schedule_audit_events for insert to authenticated with check (false);
drop policy if exists schedule_audit_events_update_block on public.schedule_audit_events;
create policy schedule_audit_events_update_block on public.schedule_audit_events for update to authenticated using (false) with check (false);
drop policy if exists schedule_audit_events_delete_block on public.schedule_audit_events;
create policy schedule_audit_events_delete_block on public.schedule_audit_events for delete to authenticated using (false);

drop policy if exists schedule_publications_select on public.schedule_publications;
create policy schedule_publications_select
  on public.schedule_publications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.schedule_weeks w
      where w.id = schedule_publications.week_id
        and public.schedule_can_view_client(w.client_id)
    )
  );
drop policy if exists schedule_publications_insert_block on public.schedule_publications;
create policy schedule_publications_insert_block on public.schedule_publications for insert to authenticated with check (false);
drop policy if exists schedule_publications_update_block on public.schedule_publications;
create policy schedule_publications_update_block on public.schedule_publications for update to authenticated using (false) with check (false);
drop policy if exists schedule_publications_delete_block on public.schedule_publications;
create policy schedule_publications_delete_block on public.schedule_publications for delete to authenticated using (false);

grant select on public.schedule_weeks to authenticated;
grant select on public.schedule_roster_entries to authenticated;
grant select on public.schedule_job_codes to authenticated;
grant select on public.schedule_shifts to authenticated;
grant select on public.schedule_templates to authenticated;
grant select on public.schedule_template_shifts to authenticated;
grant select on public.schedule_audit_events to authenticated;
grant select on public.schedule_publications to authenticated;

grant execute on function public.schedule_normalize_role_token(text) to anon, authenticated;
grant execute on function public.schedule_role_token_from_text(text) to anon, authenticated;
grant execute on function public.schedule_role_label_from_token(text) to anon, authenticated;
grant execute on function public.schedule_role_rank(text) to anon, authenticated;
grant execute on function public.schedule_is_leadership_role(text) to anon, authenticated;
grant execute on function public.schedule_monday(date) to anon, authenticated;
grant execute on function public.schedule_can_view_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_edit_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_publish_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_unpublish_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_manage_templates_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_claim_open_shift_client(uuid) to anon, authenticated;
grant execute on function public.schedule_can_manage_job_codes() to anon, authenticated;
grant execute on function public.schedule_can_view_audit_client(uuid) to anon, authenticated;
grant execute on function public.schedule_week_is_visible(uuid) to anon, authenticated;
grant execute on function public.schedule_log_audit_event(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.schedule_notify_users(uuid[], text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.schedule_sync_roster_for_client(uuid) to anon, authenticated;
grant execute on function public.schedule_get_or_create_week(uuid, date, text) to anon, authenticated;
grant execute on function public.schedule_add_roster_user(uuid, uuid, text) to anon, authenticated;
grant execute on function public.schedule_remove_roster_user(uuid) to anon, authenticated;
grant execute on function public.schedule_notify_week_team(uuid, text, text, text) to anon, authenticated;
grant execute on function public.schedule_upsert_shift(uuid, uuid, uuid, boolean, date, time, time, boolean, integer, uuid, text) to anon, authenticated;
grant execute on function public.schedule_delete_shift(uuid) to anon, authenticated;
grant execute on function public.schedule_claim_open_shift(uuid) to anon, authenticated;
grant execute on function public.schedule_publish_week(uuid) to anon, authenticated;
grant execute on function public.schedule_unpublish_week(uuid) to anon, authenticated;
grant execute on function public.schedule_copy_previous_week(uuid) to anon, authenticated;
grant execute on function public.schedule_create_template_from_week(uuid, text) to anon, authenticated;
grant execute on function public.schedule_apply_template_to_week(uuid, uuid, text) to anon, authenticated;
