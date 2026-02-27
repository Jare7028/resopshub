-- User-defined sidebar navigation ordering.

create table if not exists public.user_sidebar_link_order (
  user_id uuid not null references public.users(id) on delete cascade,
  page_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, page_key)
);

create index if not exists idx_user_sidebar_link_order_user_sort
  on public.user_sidebar_link_order (user_id, sort_order, page_key);

create or replace function public.touch_user_sidebar_link_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_sidebar_link_order_updated_at on public.user_sidebar_link_order;
create trigger trg_user_sidebar_link_order_updated_at
  before update on public.user_sidebar_link_order
  for each row
  execute procedure public.touch_user_sidebar_link_order_updated_at();

alter table public.user_sidebar_link_order enable row level security;

do $$
begin
  create policy "Users can view their own sidebar order"
    on public.user_sidebar_link_order
    for select
    using (user_id = auth.uid() or user_id = public.current_app_user_id());
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Users can insert their own sidebar order"
    on public.user_sidebar_link_order
    for insert
    with check (user_id = auth.uid() or user_id = public.current_app_user_id());
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Users can update their own sidebar order"
    on public.user_sidebar_link_order
    for update
    using (user_id = auth.uid() or user_id = public.current_app_user_id())
    with check (user_id = auth.uid() or user_id = public.current_app_user_id());
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Users can delete their own sidebar order"
    on public.user_sidebar_link_order
    for delete
    using (user_id = auth.uid() or user_id = public.current_app_user_id());
exception
  when duplicate_object then null;
end;
$$;

grant select, insert, update, delete on public.user_sidebar_link_order to authenticated;
