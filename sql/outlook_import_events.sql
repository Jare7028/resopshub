create table if not exists public.outlook_import_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outlook_import_events_name_created_idx
  on public.outlook_import_events (event_name, created_at desc);

create index if not exists outlook_import_events_created_idx
  on public.outlook_import_events (created_at desc);

alter table public.outlook_import_events enable row level security;

grant select, insert on table public.outlook_import_events to authenticated;

drop policy if exists outlook_import_events_select on public.outlook_import_events;
create policy outlook_import_events_select
  on public.outlook_import_events
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id in (auth.uid(), public.current_app_user_id())
    )
  );

drop policy if exists outlook_import_events_insert on public.outlook_import_events;
create policy outlook_import_events_insert
  on public.outlook_import_events
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and user_id in (auth.uid(), public.current_app_user_id())
  );

create or replace view public.outlook_import_daily_metrics as
select
  date_trunc('day', created_at)::date as day,
  event_name,
  count(*) as event_count
from public.outlook_import_events
group by 1, 2
order by day desc, event_name asc;

