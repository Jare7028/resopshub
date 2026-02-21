-- Add threaded social comments (single reply level) and post view tracking.

alter table public.social_post_comments
  add column if not exists parent_comment_id uuid references public.social_post_comments(id) on delete cascade;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_post_comments_parent_not_self'
  ) then
    alter table public.social_post_comments
      add constraint social_post_comments_parent_not_self
      check (parent_comment_id is null or parent_comment_id <> id);
  end if;
end
$$;

create index if not exists idx_social_post_comments_post_parent_created
  on public.social_post_comments(post_id, parent_comment_id, created_at);

create or replace function public.social_comment_parent_guard()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  parent_post_id uuid;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select c.post_id
    into parent_post_id
  from public.social_post_comments c
  where c.id = new.parent_comment_id;

  if parent_post_id is null then
    raise exception 'Parent comment not found';
  end if;

  if parent_post_id <> new.post_id then
    raise exception 'Parent comment must belong to the same post';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_social_comment_parent_guard on public.social_post_comments;
create trigger trg_social_comment_parent_guard
before insert or update of post_id, parent_comment_id
on public.social_post_comments
for each row
execute function public.social_comment_parent_guard();

create table if not exists public.social_post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  viewed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_post_views_unique_post_user unique (post_id, user_id)
);

create index if not exists idx_social_post_views_post_viewed
  on public.social_post_views(post_id, viewed_at desc);

create index if not exists idx_social_post_views_user_viewed
  on public.social_post_views(user_id, viewed_at desc);

alter table public.social_post_views enable row level security;

drop policy if exists social_post_views_select on public.social_post_views;
create policy social_post_views_select
  on public.social_post_views
  for select
  to authenticated
  using (public.can_access_social_post(post_id));

drop policy if exists social_post_views_insert on public.social_post_views;
create policy social_post_views_insert
  on public.social_post_views
  for insert
  to authenticated
  with check (
    public.can_access_social_post(post_id)
    and (
      user_id = auth.uid()
      or user_id = public.current_app_user_id()
      or exists (
        select 1
        from public.users u
        where u.id = user_id
          and lower(u.email::text) = lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''))
      )
    )
  );

drop policy if exists social_post_views_update on public.social_post_views;
create policy social_post_views_update
  on public.social_post_views
  for update
  to authenticated
  using (
    public.can_access_social_post(post_id)
    and (
      user_id = auth.uid()
      or user_id = public.current_app_user_id()
      or public.is_admin()
      or exists (
        select 1
        from public.users u
        where u.id = user_id
          and lower(u.email::text) = lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''))
      )
    )
  )
  with check (
    public.can_access_social_post(post_id)
    and (
      user_id = auth.uid()
      or user_id = public.current_app_user_id()
      or public.is_admin()
      or exists (
        select 1
        from public.users u
        where u.id = user_id
          and lower(u.email::text) = lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''))
      )
    )
  );

drop policy if exists social_post_views_delete on public.social_post_views;
create policy social_post_views_delete
  on public.social_post_views
  for delete
  to authenticated
  using (public.can_manage_social_post(post_id));

grant select, insert, update, delete on table public.social_post_views to authenticated;
