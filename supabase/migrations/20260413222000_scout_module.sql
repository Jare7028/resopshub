-- Scout hiring tracker module.

insert into public.page_permissions (key, label, nav_href, sort_order)
values ('scout', 'Scout', '/scout', 76)
on conflict (key) do update
set
  label = excluded.label,
  nav_href = excluded.nav_href,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_page_permissions (
  user_id,
  page_key,
  access_level,
  updated_by_user_id
)
select
  u.id,
  'scout',
  'edit',
  null::uuid
from public.users u
where u.role::text = 'member'
on conflict (user_id, page_key) do nothing;

create or replace function public.can_access_scout()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_view_page('scout');
$$;

grant execute on function public.can_access_scout() to anon, authenticated;

create or replace function public.can_manage_scout()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and public.can_edit_page('scout');
$$;

grant execute on function public.can_manage_scout() to anon, authenticated;

create table if not exists public.role_scout_jobs (
  id uuid primary key default gen_random_uuid(),
  external_job_key text,
  company_name text not null,
  role_title text not null,
  location_text text,
  employment_type text,
  compensation_text text,
  source_name text,
  source_url text,
  role_summary text,
  metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'watchlist', 'contacted', 'ignore')),
  ignore_reason text,
  ignored_at timestamptz,
  contacted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_scout_jobs_company_name_not_blank check (length(trim(company_name)) > 0),
  constraint role_scout_jobs_role_title_not_blank check (length(trim(role_title)) > 0),
  constraint role_scout_jobs_external_job_key_not_blank check (
    external_job_key is null or length(trim(external_job_key)) > 0
  ),
  constraint role_scout_jobs_ignore_reason_required check (
    (status = 'ignore' and nullif(btrim(ignore_reason), '') is not null)
    or (status <> 'ignore' and ignore_reason is null)
  )
);

create unique index if not exists role_scout_jobs_external_job_key_unique
  on public.role_scout_jobs (external_job_key)
  where external_job_key is not null;

create unique index if not exists role_scout_jobs_source_url_unique
  on public.role_scout_jobs (source_url)
  where source_url is not null;

create index if not exists role_scout_jobs_status_updated_idx
  on public.role_scout_jobs (status, status_updated_at desc);

create index if not exists role_scout_jobs_company_updated_idx
  on public.role_scout_jobs (company_name, updated_at desc);

drop trigger if exists trg_role_scout_jobs_updated_at on public.role_scout_jobs;
create trigger trg_role_scout_jobs_updated_at
before update on public.role_scout_jobs
for each row execute function public.set_updated_at();

create table if not exists public.role_scout_job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.role_scout_jobs(id) on delete cascade,
  previous_status text
    check (previous_status is null or previous_status in ('active', 'watchlist', 'contacted', 'ignore')),
  next_status text not null
    check (next_status in ('active', 'watchlist', 'contacted', 'ignore')),
  ignore_reason text,
  changed_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists role_scout_job_status_history_job_created_idx
  on public.role_scout_job_status_history (job_id, created_at desc);

alter table public.role_scout_jobs enable row level security;
alter table public.role_scout_job_status_history enable row level security;

drop policy if exists role_scout_jobs_select on public.role_scout_jobs;
create policy role_scout_jobs_select
  on public.role_scout_jobs
  for select
  to authenticated
  using (public.can_access_scout());

drop policy if exists role_scout_jobs_insert on public.role_scout_jobs;
create policy role_scout_jobs_insert
  on public.role_scout_jobs
  for insert
  to authenticated
  with check (public.can_manage_scout());

drop policy if exists role_scout_jobs_update on public.role_scout_jobs;
create policy role_scout_jobs_update
  on public.role_scout_jobs
  for update
  to authenticated
  using (public.can_manage_scout())
  with check (public.can_manage_scout());

drop policy if exists role_scout_jobs_delete on public.role_scout_jobs;
create policy role_scout_jobs_delete
  on public.role_scout_jobs
  for delete
  to authenticated
  using (public.can_manage_scout());

drop policy if exists role_scout_job_status_history_select on public.role_scout_job_status_history;
create policy role_scout_job_status_history_select
  on public.role_scout_job_status_history
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.role_scout_jobs jobs
      where jobs.id = role_scout_job_status_history.job_id
        and public.can_access_scout()
    )
  );

drop policy if exists role_scout_job_status_history_insert on public.role_scout_job_status_history;
create policy role_scout_job_status_history_insert
  on public.role_scout_job_status_history
  for insert
  to authenticated
  with check (public.can_manage_scout());

drop policy if exists role_scout_job_status_history_delete on public.role_scout_job_status_history;
create policy role_scout_job_status_history_delete
  on public.role_scout_job_status_history
  for delete
  to authenticated
  using (public.can_manage_scout());

grant select, insert, update, delete on table public.role_scout_jobs to authenticated;
grant select, insert, delete on table public.role_scout_job_status_history to authenticated;
