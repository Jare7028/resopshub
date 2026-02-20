-- External share links for personal pages.
-- Run after:
--   sql/personal.sql

create table if not exists public.personal_page_share_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.personal_pages(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz,
  constraint personal_page_share_links_token_not_blank check (length(trim(token)) > 0)
);

drop trigger if exists trg_personal_page_share_links_updated_at on public.personal_page_share_links;
create trigger trg_personal_page_share_links_updated_at
before update on public.personal_page_share_links
for each row execute function public.set_updated_at();

create index if not exists idx_personal_page_share_links_page_id_created_at
  on public.personal_page_share_links(page_id, created_at desc);

create index if not exists idx_personal_page_share_links_token_is_active
  on public.personal_page_share_links(token, is_active);

create or replace function public.resolve_personal_page_share_link(p_token text)
returns table (
  page_id uuid,
  page_title text,
  page_content jsonb,
  page_updated_at timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_token text := trim(coalesce(p_token, ''));
begin
  if v_token = '' then
    return;
  end if;

  update public.personal_page_share_links
  set last_used_at = timezone('utc', now())
  where token = v_token
    and is_active
    and (expires_at is null or expires_at > timezone('utc', now()));

  return query
  select
    p.id,
    p.title,
    p.content,
    p.updated_at
  from public.personal_page_share_links l
  join public.personal_pages p on p.id = l.page_id
  where l.token = v_token
    and l.is_active
    and (l.expires_at is null or l.expires_at > timezone('utc', now()))
  limit 1;
end;
$$;

grant execute on function public.resolve_personal_page_share_link(text) to anon, authenticated;

alter table public.personal_page_share_links enable row level security;

drop policy if exists personal_page_share_links_select on public.personal_page_share_links;
create policy personal_page_share_links_select
  on public.personal_page_share_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.personal_pages p
      where p.id = page_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists personal_page_share_links_insert on public.personal_page_share_links;
create policy personal_page_share_links_insert
  on public.personal_page_share_links
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.personal_pages p
      where p.id = page_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists personal_page_share_links_update on public.personal_page_share_links;
create policy personal_page_share_links_update
  on public.personal_page_share_links
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.personal_pages p
      where p.id = page_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.personal_pages p
      where p.id = page_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists personal_page_share_links_delete on public.personal_page_share_links;
create policy personal_page_share_links_delete
  on public.personal_page_share_links
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.personal_pages p
      where p.id = page_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on table public.personal_page_share_links to authenticated;

