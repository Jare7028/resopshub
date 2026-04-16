create table if not exists public.role_scout_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('success', 'error')),
  trigger_source text,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists role_scout_runs_finished_idx
  on public.role_scout_runs (finished_at desc);

alter table public.role_scout_runs enable row level security;

drop policy if exists role_scout_runs_select on public.role_scout_runs;
create policy role_scout_runs_select
  on public.role_scout_runs
  for select
  to authenticated
  using (public.can_access_scout());

grant select on table public.role_scout_runs to authenticated;
