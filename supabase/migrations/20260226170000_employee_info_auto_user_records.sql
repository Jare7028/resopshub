-- Auto-create Employee Info records for all users (existing + future).

alter table if exists public.employee_info_records
  add column if not exists user_id uuid references public.users(id) on delete set null;

-- Backfill user links by unique name match when safe, preferring oldest record per name.
with candidate_users as (
  select
    lower(trim(coalesce(u.full_name, ''))) as name_key,
    min(u.id::text)::uuid as user_id,
    count(*) as user_count
  from public.users u
  where length(trim(coalesce(u.full_name, ''))) > 0
  group by lower(trim(coalesce(u.full_name, '')))
),
candidate_records as (
  select
    r.id as record_id,
    lower(trim(coalesce(r.full_name, ''))) as name_key,
    row_number() over (
      partition by lower(trim(coalesce(r.full_name, '')))
      order by r.created_at asc, r.id asc
    ) as record_rank
  from public.employee_info_records r
  where r.user_id is null
    and length(trim(coalesce(r.full_name, ''))) > 0
),
matches as (
  select
    cr.record_id,
    cu.user_id
  from candidate_records cr
  join candidate_users cu
    on cu.name_key = cr.name_key
   and cu.user_count = 1
  where cr.record_rank = 1
)
update public.employee_info_records r
set
  user_id = m.user_id,
  updated_at = now()
from matches m
where r.id = m.record_id
  and r.user_id is null;

-- If duplicates exist, keep the oldest linked record and detach the rest.
with ranked as (
  select
    r.id,
    row_number() over (
      partition by r.user_id
      order by r.created_at asc, r.id asc
    ) as duplicate_rank
  from public.employee_info_records r
  where r.user_id is not null
)
update public.employee_info_records r
set
  user_id = null,
  updated_at = now()
from ranked
where r.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists employee_info_records_user_id_unique_idx
  on public.employee_info_records(user_id)
  where user_id is not null;

create index if not exists employee_info_records_user_id_created_idx
  on public.employee_info_records(user_id, created_at desc)
  where user_id is not null;

-- Backfill missing Employee Info records for all current users.
insert into public.employee_info_records (
  full_name,
  client_id,
  user_id,
  created_by_user_id
)
select
  coalesce(
    nullif(trim(u.full_name), ''),
    nullif(trim(u.email), ''),
    u.id::text
  ) as full_name,
  null::uuid as client_id,
  u.id as user_id,
  null::uuid as created_by_user_id
from public.users u
where not exists (
  select 1
  from public.employee_info_records r
  where r.user_id = u.id
);

create or replace function public.employee_info_auto_create_record_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employee_info_records (
    full_name,
    client_id,
    user_id,
    created_by_user_id
  )
  values (
    coalesce(
      nullif(trim(new.full_name), ''),
      nullif(trim(new.email), ''),
      new.id::text
    ),
    null,
    new.id,
    null
  )
  on conflict (user_id) where user_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_employee_info_auto_create_record_for_user
  on public.users;

create trigger trg_employee_info_auto_create_record_for_user
after insert on public.users
for each row
execute procedure public.employee_info_auto_create_record_for_user();
