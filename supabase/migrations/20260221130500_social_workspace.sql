-- Social workspace pages with private-by-default membership.
-- Run after:
--   sql/permissions_admin_member.sql

create table if not exists public.social_pages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_pages_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.social_page_members (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.social_pages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_page_members_role_check check (role in ('member', 'manager')),
  constraint social_page_members_unique_page_user unique (page_id, user_id)
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.social_pages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_posts_body_not_blank check (length(trim(body)) > 0)
);

create table if not exists public.social_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  storage_path text not null,
  url text not null,
  filename text,
  mime_type text,
  size_bytes bigint,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint social_post_images_storage_path_not_blank check (length(trim(storage_path)) > 0),
  constraint social_post_images_url_not_blank check (length(trim(url)) > 0)
);

create table if not exists public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_post_comments_body_not_blank check (length(trim(body)) > 0)
);

create index if not exists idx_social_pages_created_by
  on public.social_pages(created_by, created_at desc);

create index if not exists idx_social_page_members_page_role
  on public.social_page_members(page_id, role, user_id);

create index if not exists idx_social_page_members_user_page
  on public.social_page_members(user_id, page_id);

create index if not exists idx_social_posts_page_created
  on public.social_posts(page_id, created_at desc);

create index if not exists idx_social_posts_user_created
  on public.social_posts(user_id, created_at desc);

create index if not exists idx_social_post_images_post_position
  on public.social_post_images(post_id, position, created_at);

create index if not exists idx_social_post_comments_post_created
  on public.social_post_comments(post_id, created_at);

create or replace function public.can_access_social_page(social_page_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and public.can_view_page('social')
    and exists (
      select 1
      from public.social_pages sp
      where sp.id = social_page_uuid
        and (
          public.is_admin()
          or sp.created_by in ((select auth_uid from me), (select app_uid from me))
          or exists (
            select 1
            from public.social_page_members m
            where m.page_id = sp.id
              and m.user_id in ((select auth_uid from me), (select app_uid from me))
          )
        )
    );
$$;

create or replace function public.can_manage_social_page(social_page_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and public.can_edit_page('social')
    and exists (
      select 1
      from public.social_pages sp
      where sp.id = social_page_uuid
        and (
          public.is_admin()
          or sp.created_by in ((select auth_uid from me), (select app_uid from me))
          or exists (
            select 1
            from public.social_page_members m
            where m.page_id = sp.id
              and m.user_id in ((select auth_uid from me), (select app_uid from me))
              and m.role = 'manager'
          )
        )
    );
$$;

create or replace function public.can_access_social_post(social_post_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.social_posts p
      where p.id = social_post_uuid
        and public.can_access_social_page(p.page_id)
    );
$$;

create or replace function public.can_manage_social_post(social_post_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and public.can_edit_page('social')
    and exists (
      select 1
      from public.social_posts p
      where p.id = social_post_uuid
        and (
          p.user_id in ((select auth_uid from me), (select app_uid from me))
          or public.can_manage_social_page(p.page_id)
        )
    );
$$;

create or replace function public.can_manage_social_comment(social_comment_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and public.can_edit_page('social')
    and exists (
      select 1
      from public.social_post_comments c
      join public.social_posts p on p.id = c.post_id
      where c.id = social_comment_uuid
        and (
          c.user_id in ((select auth_uid from me), (select app_uid from me))
          or public.can_manage_social_page(p.page_id)
        )
    );
$$;

grant execute on function public.can_access_social_page(uuid) to anon, authenticated;
grant execute on function public.can_manage_social_page(uuid) to anon, authenticated;
grant execute on function public.can_access_social_post(uuid) to anon, authenticated;
grant execute on function public.can_manage_social_post(uuid) to anon, authenticated;
grant execute on function public.can_manage_social_comment(uuid) to anon, authenticated;

alter table public.social_pages enable row level security;
alter table public.social_page_members enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_images enable row level security;
alter table public.social_post_comments enable row level security;

drop policy if exists social_pages_select on public.social_pages;
create policy social_pages_select
  on public.social_pages
  for select
  to authenticated
  using (public.can_access_social_page(id));

drop policy if exists social_pages_insert on public.social_pages;
create policy social_pages_insert
  on public.social_pages
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.can_edit_page('social')
    and (
      created_by = auth.uid()
      or created_by = public.current_app_user_id()
      or exists (
        select 1
        from public.users u
        where u.id = created_by
          and lower(u.email::text) = lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''))
      )
    )
  );

drop policy if exists social_pages_update on public.social_pages;
create policy social_pages_update
  on public.social_pages
  for update
  to authenticated
  using (public.can_manage_social_page(id))
  with check (public.can_manage_social_page(id));

drop policy if exists social_pages_delete on public.social_pages;
create policy social_pages_delete
  on public.social_pages
  for delete
  to authenticated
  using (public.can_manage_social_page(id));

drop policy if exists social_page_members_select on public.social_page_members;
create policy social_page_members_select
  on public.social_page_members
  for select
  to authenticated
  using (public.can_access_social_page(page_id));

drop policy if exists social_page_members_insert on public.social_page_members;
create policy social_page_members_insert
  on public.social_page_members
  for insert
  to authenticated
  with check (public.can_manage_social_page(page_id));

drop policy if exists social_page_members_update on public.social_page_members;
create policy social_page_members_update
  on public.social_page_members
  for update
  to authenticated
  using (public.can_manage_social_page(page_id))
  with check (public.can_manage_social_page(page_id));

drop policy if exists social_page_members_delete on public.social_page_members;
create policy social_page_members_delete
  on public.social_page_members
  for delete
  to authenticated
  using (public.can_manage_social_page(page_id));

drop policy if exists social_posts_select on public.social_posts;
create policy social_posts_select
  on public.social_posts
  for select
  to authenticated
  using (public.can_access_social_page(page_id));

drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert
  on public.social_posts
  for insert
  to authenticated
  with check (
    public.can_access_social_page(page_id)
    and public.can_edit_page('social')
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

drop policy if exists social_posts_update on public.social_posts;
create policy social_posts_update
  on public.social_posts
  for update
  to authenticated
  using (public.can_manage_social_post(id))
  with check (public.can_manage_social_post(id));

drop policy if exists social_posts_delete on public.social_posts;
create policy social_posts_delete
  on public.social_posts
  for delete
  to authenticated
  using (public.can_manage_social_post(id));

drop policy if exists social_post_images_select on public.social_post_images;
create policy social_post_images_select
  on public.social_post_images
  for select
  to authenticated
  using (public.can_access_social_post(post_id));

drop policy if exists social_post_images_insert on public.social_post_images;
create policy social_post_images_insert
  on public.social_post_images
  for insert
  to authenticated
  with check (public.can_manage_social_post(post_id));

drop policy if exists social_post_images_update on public.social_post_images;
create policy social_post_images_update
  on public.social_post_images
  for update
  to authenticated
  using (public.can_manage_social_post(post_id))
  with check (public.can_manage_social_post(post_id));

drop policy if exists social_post_images_delete on public.social_post_images;
create policy social_post_images_delete
  on public.social_post_images
  for delete
  to authenticated
  using (public.can_manage_social_post(post_id));

drop policy if exists social_post_comments_select on public.social_post_comments;
create policy social_post_comments_select
  on public.social_post_comments
  for select
  to authenticated
  using (public.can_access_social_post(post_id));

drop policy if exists social_post_comments_insert on public.social_post_comments;
create policy social_post_comments_insert
  on public.social_post_comments
  for insert
  to authenticated
  with check (
    public.can_access_social_post(post_id)
    and public.can_edit_page('social')
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

drop policy if exists social_post_comments_update on public.social_post_comments;
create policy social_post_comments_update
  on public.social_post_comments
  for update
  to authenticated
  using (public.can_manage_social_comment(id))
  with check (public.can_manage_social_comment(id));

drop policy if exists social_post_comments_delete on public.social_post_comments;
create policy social_post_comments_delete
  on public.social_post_comments
  for delete
  to authenticated
  using (public.can_manage_social_comment(id));

grant select, insert, update, delete on table public.social_pages to authenticated;
grant select, insert, update, delete on table public.social_page_members to authenticated;
grant select, insert, update, delete on table public.social_posts to authenticated;
grant select, insert, update, delete on table public.social_post_images to authenticated;
grant select, insert, update, delete on table public.social_post_comments to authenticated;

-- Image storage bucket: {social_page_id}/{uploader_user_id}/{timestamp}-{random}-{filename}
insert into storage.buckets (id, name, public)
values ('social-post-images', 'social-post-images', true)
on conflict (id) do update
set public = excluded.public;

grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

drop policy if exists social_post_bucket_select on storage.objects;
create policy social_post_bucket_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'social-post-images'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_access_social_page(split_part(name, '/', 1)::uuid)
  );

drop policy if exists social_post_bucket_insert on storage.objects;
create policy social_post_bucket_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'social-post-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 2) = auth.uid()::text
    and public.can_edit_page('social')
    and public.can_access_social_page(split_part(name, '/', 1)::uuid)
  );

drop policy if exists social_post_bucket_update on storage.objects;
create policy social_post_bucket_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'social-post-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  )
  with check (
    bucket_id = 'social-post-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  );

drop policy if exists social_post_bucket_delete on storage.objects;
create policy social_post_bucket_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'social-post-images'
    and auth.uid() is not null
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (owner = auth.uid() or public.is_admin())
  );
