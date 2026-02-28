-- Reusable assignment groups for member selection across the app.

create table if not exists public.assignment_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assignment_groups_name_not_blank check (length(trim(name)) > 0)
);

create unique index if not exists assignment_groups_name_lower_unique_idx
  on public.assignment_groups (lower(name));

create table if not exists public.assignment_group_members (
  group_id uuid not null references public.assignment_groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, user_id)
);

create index if not exists assignment_group_members_user_id_idx
  on public.assignment_group_members (user_id, group_id);

drop trigger if exists trg_assignment_groups_updated_at on public.assignment_groups;
create trigger trg_assignment_groups_updated_at
before update on public.assignment_groups
for each row execute function public.set_updated_at();

create or replace function public.can_manage_assignment_groups()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('settings');
$$;

alter table public.assignment_groups enable row level security;
alter table public.assignment_group_members enable row level security;

drop policy if exists assignment_groups_select on public.assignment_groups;
create policy assignment_groups_select
  on public.assignment_groups
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists assignment_groups_insert on public.assignment_groups;
create policy assignment_groups_insert
  on public.assignment_groups
  for insert
  to authenticated
  with check (public.can_manage_assignment_groups());

drop policy if exists assignment_groups_update on public.assignment_groups;
create policy assignment_groups_update
  on public.assignment_groups
  for update
  to authenticated
  using (public.can_manage_assignment_groups())
  with check (public.can_manage_assignment_groups());

drop policy if exists assignment_groups_delete on public.assignment_groups;
create policy assignment_groups_delete
  on public.assignment_groups
  for delete
  to authenticated
  using (public.can_manage_assignment_groups());

drop policy if exists assignment_group_members_select on public.assignment_group_members;
create policy assignment_group_members_select
  on public.assignment_group_members
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists assignment_group_members_insert on public.assignment_group_members;
create policy assignment_group_members_insert
  on public.assignment_group_members
  for insert
  to authenticated
  with check (public.can_manage_assignment_groups());

drop policy if exists assignment_group_members_update on public.assignment_group_members;
create policy assignment_group_members_update
  on public.assignment_group_members
  for update
  to authenticated
  using (public.can_manage_assignment_groups())
  with check (public.can_manage_assignment_groups());

drop policy if exists assignment_group_members_delete on public.assignment_group_members;
create policy assignment_group_members_delete
  on public.assignment_group_members
  for delete
  to authenticated
  using (public.can_manage_assignment_groups());

grant select, insert, update, delete on public.assignment_groups to authenticated;
grant select, insert, update, delete on public.assignment_group_members to authenticated;
grant execute on function public.can_manage_assignment_groups() to anon, authenticated;
