create table if not exists public.help_guides (
  slug text primary key,
  guide jsonb not null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists help_guides_updated_at_idx on public.help_guides(updated_at desc);

create or replace function public.set_help_guides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_help_guides_updated_at on public.help_guides;
create trigger trg_help_guides_updated_at
before update on public.help_guides
for each row
execute procedure public.set_help_guides_updated_at();

alter table public.help_guides enable row level security;

drop policy if exists help_guides_select_authenticated on public.help_guides;
create policy help_guides_select_authenticated
on public.help_guides
for select
using (auth.role() = 'authenticated');

drop policy if exists help_guides_insert_admin on public.help_guides;
create policy help_guides_insert_admin
on public.help_guides
for insert
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists help_guides_update_admin on public.help_guides;
create policy help_guides_update_admin
on public.help_guides
for update
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

drop policy if exists help_guides_delete_admin on public.help_guides;
create policy help_guides_delete_admin
on public.help_guides
for delete
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

