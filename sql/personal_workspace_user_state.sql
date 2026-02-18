-- Personal workspace per-user per-page view state and favorites.
-- Additive migration for /personal workspace redesign.

create table if not exists public.personal_page_user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null references public.personal_pages(id) on delete cascade,
  is_favorite boolean not null default false,
  last_opened_at timestamptz,
  zoom_percent int not null default 100,
  last_ribbon_tab text not null default 'home',
  sidebar_collapsed boolean not null default false,
  focus_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_page_user_state_zoom_percent_range'
  ) then
    alter table public.personal_page_user_state
      add constraint personal_page_user_state_zoom_percent_range
      check (zoom_percent between 20 and 1000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_page_user_state_last_ribbon_tab_check'
  ) then
    alter table public.personal_page_user_state
      add constraint personal_page_user_state_last_ribbon_tab_check
      check (last_ribbon_tab in ('home', 'insert', 'layout', 'review', 'view'));
  end if;
end
$$;

create index if not exists personal_page_user_state_user_last_opened_idx
  on public.personal_page_user_state(user_id, last_opened_at desc);

create index if not exists personal_page_user_state_user_favorite_idx
  on public.personal_page_user_state(user_id, is_favorite);

alter table public.personal_page_user_state enable row level security;

drop policy if exists personal_page_user_state_select_own on public.personal_page_user_state;
create policy personal_page_user_state_select_own
  on public.personal_page_user_state
  for select
  using (auth.uid() = user_id and public.is_page_member(page_id));

drop policy if exists personal_page_user_state_insert_own on public.personal_page_user_state;
create policy personal_page_user_state_insert_own
  on public.personal_page_user_state
  for insert
  with check (auth.uid() = user_id and public.is_page_member(page_id));

drop policy if exists personal_page_user_state_update_own on public.personal_page_user_state;
create policy personal_page_user_state_update_own
  on public.personal_page_user_state
  for update
  using (auth.uid() = user_id and public.is_page_member(page_id))
  with check (auth.uid() = user_id and public.is_page_member(page_id));

drop policy if exists personal_page_user_state_delete_own on public.personal_page_user_state;
create policy personal_page_user_state_delete_own
  on public.personal_page_user_state
  for delete
  using (auth.uid() = user_id and public.is_page_member(page_id));

grant select, insert, update, delete on public.personal_page_user_state to authenticated;

create or replace function public.set_personal_page_user_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_personal_page_user_state_updated_at on public.personal_page_user_state;
create trigger set_personal_page_user_state_updated_at
before update on public.personal_page_user_state
for each row
execute function public.set_personal_page_user_state_updated_at();
