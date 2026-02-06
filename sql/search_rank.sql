-- Search columns for full-text search.
alter table personal_pages
  add column if not exists content_text text;

alter table tasks
  add column if not exists content_text text;

alter table personal_pages
  drop column if exists search_vector;

alter table personal_pages
  add column if not exists search_vector tsvector;

alter table tasks
  drop column if exists search_vector;

alter table tasks
  add column if not exists search_vector tsvector;

create index if not exists personal_pages_search_vector_idx
  on personal_pages using gin (search_vector);

create index if not exists tasks_search_vector_idx
  on tasks using gin (search_vector);

create or replace function public.update_search_vector()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'personal_pages' then
    new.search_vector := to_tsvector(
      'english',
      concat_ws(' ', coalesce(new.title, ''), coalesce(new.content_text, ''))
    );
  elsif tg_table_name = 'tasks' then
    new.search_vector := to_tsvector(
      'english',
      concat_ws(' ', coalesce(new.title, ''), coalesce(new.content_text, ''))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists personal_pages_search_vector_update on personal_pages;
create trigger personal_pages_search_vector_update
before insert or update of title, content_text on personal_pages
for each row
execute function public.update_search_vector();

drop trigger if exists tasks_search_vector_update on tasks;
create trigger tasks_search_vector_update
before insert or update of title, content_text on tasks
for each row
execute function public.update_search_vector();

update personal_pages
set search_vector = to_tsvector(
  'english',
  concat_ws(' ', coalesce(title, ''), coalesce(content_text, ''))
);

update tasks
set search_vector = to_tsvector(
  'english',
  concat_ws(' ', coalesce(title, ''), coalesce(content_text, ''))
);

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text not null,
  search_type text not null default 'all',
  section_id uuid references personal_sections (id) on delete set null,
  client_id uuid references clients (id) on delete set null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- NULL-safe uniqueness for optional filters.
drop index if exists public.search_history_unique;
create unique index search_history_unique
  on public.search_history (
    user_id,
    query,
    search_type,
    coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.search_history enable row level security;

drop policy if exists search_history_select_own on public.search_history;
create policy search_history_select_own
  on public.search_history
  for select
  using (auth.uid() = user_id);

drop policy if exists search_history_insert_own on public.search_history;
create policy search_history_insert_own
  on public.search_history
  for insert
  with check (auth.uid() = user_id);

drop policy if exists search_history_update_own on public.search_history;
create policy search_history_update_own
  on public.search_history
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists search_history_delete_own on public.search_history;
create policy search_history_delete_own
  on public.search_history
  for delete
  using (auth.uid() = user_id);

create or replace function public.search_notes(
  query_text text,
  filter_type text default 'all',
  filter_section_id uuid default null,
  filter_client_id uuid default null,
  result_limit int default 50
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  content_text text,
  rank real,
  section_title text,
  client_name text,
  project_name text,
  updated_at timestamptz,
  last_edited_at timestamptz
)
language sql
stable
security invoker
as $$
  with search_query as (
    select websearch_to_tsquery('english', nullif(btrim(query_text), '')) as q
    where nullif(btrim(query_text), '') is not null
  ),
  personal_results as (
    select
      'personal'::text as result_type,
      p.id as result_id,
      p.title,
      p.content_text,
      ts_rank_cd(p.search_vector, search_query.q) as rank,
      s.title as section_title,
      null::text as client_name,
      null::text as project_name,
      p.updated_at,
      p.last_edited_at
    from personal_pages p
    left join personal_sections s on s.id = p.section_id
    cross join search_query
    where (filter_type in ('all', 'personal'))
      and (filter_section_id is null or p.section_id = filter_section_id)
      and p.search_vector @@ search_query.q
  ),
  task_results as (
    select
      'task'::text as result_type,
      t.id as result_id,
      t.title,
      t.content_text,
      ts_rank_cd(t.search_vector, search_query.q) as rank,
      null::text as section_title,
      c.name as client_name,
      pr.name as project_name,
      t.updated_at,
      t.last_edited_at
    from tasks t
    left join clients c on c.id = t.client_id
    left join projects pr on pr.id = t.project_id
    cross join search_query
    where (filter_type in ('all', 'task'))
      and (filter_client_id is null or t.client_id = filter_client_id)
      and t.search_vector @@ search_query.q
  )
  select *
  from (
    select * from personal_results
    union all
    select * from task_results
  ) combined
  order by rank desc nulls last,
    last_edited_at desc nulls last,
    updated_at desc nulls last
  limit coalesce(result_limit, 50);
$$;
