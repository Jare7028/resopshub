-- Social feature pack:
-- - pinned posts
-- - page read tracking for unread counts
-- - reactions for posts and comments

alter table public.social_posts
  add column if not exists is_pinned boolean not null default false;

alter table public.social_posts
  add column if not exists pinned_at timestamptz;

create index if not exists idx_social_posts_page_pinned_created
  on public.social_posts(page_id, is_pinned desc, created_at desc);

create table if not exists public.social_page_reads (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.social_pages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_read_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_page_reads_unique_page_user unique (page_id, user_id)
);

create index if not exists idx_social_page_reads_user_last_read
  on public.social_page_reads(user_id, last_read_at desc);

create table if not exists public.social_post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_post_reactions_emoji_not_blank check (length(trim(emoji)) > 0),
  constraint social_post_reactions_unique_post_user_emoji unique (post_id, user_id, emoji)
);

create index if not exists idx_social_post_reactions_post_created
  on public.social_post_reactions(post_id, created_at desc);

create table if not exists public.social_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.social_post_comments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_comment_reactions_emoji_not_blank check (length(trim(emoji)) > 0),
  constraint social_comment_reactions_unique_comment_user_emoji unique (comment_id, user_id, emoji)
);

create index if not exists idx_social_comment_reactions_comment_created
  on public.social_comment_reactions(comment_id, created_at desc);

alter table public.social_page_reads enable row level security;
alter table public.social_post_reactions enable row level security;
alter table public.social_comment_reactions enable row level security;

drop policy if exists social_page_reads_select on public.social_page_reads;
create policy social_page_reads_select
  on public.social_page_reads
  for select
  to authenticated
  using (public.can_access_social_page(page_id));

drop policy if exists social_page_reads_insert on public.social_page_reads;
create policy social_page_reads_insert
  on public.social_page_reads
  for insert
  to authenticated
  with check (
    public.can_access_social_page(page_id)
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

drop policy if exists social_page_reads_update on public.social_page_reads;
create policy social_page_reads_update
  on public.social_page_reads
  for update
  to authenticated
  using (
    public.can_access_social_page(page_id)
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
    public.can_access_social_page(page_id)
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

drop policy if exists social_page_reads_delete on public.social_page_reads;
create policy social_page_reads_delete
  on public.social_page_reads
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_page(page_id)
  );

drop policy if exists social_post_reactions_select on public.social_post_reactions;
create policy social_post_reactions_select
  on public.social_post_reactions
  for select
  to authenticated
  using (public.can_access_social_post(post_id));

drop policy if exists social_post_reactions_insert on public.social_post_reactions;
create policy social_post_reactions_insert
  on public.social_post_reactions
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

drop policy if exists social_post_reactions_update on public.social_post_reactions;
create policy social_post_reactions_update
  on public.social_post_reactions
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_post(post_id)
  )
  with check (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_post(post_id)
  );

drop policy if exists social_post_reactions_delete on public.social_post_reactions;
create policy social_post_reactions_delete
  on public.social_post_reactions
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_post(post_id)
  );

drop policy if exists social_comment_reactions_select on public.social_comment_reactions;
create policy social_comment_reactions_select
  on public.social_comment_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.social_post_comments c
      where c.id = social_comment_reactions.comment_id
        and public.can_access_social_post(c.post_id)
    )
  );

drop policy if exists social_comment_reactions_insert on public.social_comment_reactions;
create policy social_comment_reactions_insert
  on public.social_comment_reactions
  for insert
  to authenticated
  with check (
    public.can_edit_page('social')
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
    and exists (
      select 1
      from public.social_post_comments c
      where c.id = social_comment_reactions.comment_id
        and public.can_access_social_post(c.post_id)
    )
  );

drop policy if exists social_comment_reactions_update on public.social_comment_reactions;
create policy social_comment_reactions_update
  on public.social_comment_reactions
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_comment(comment_id)
  )
  with check (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_comment(comment_id)
  );

drop policy if exists social_comment_reactions_delete on public.social_comment_reactions;
create policy social_comment_reactions_delete
  on public.social_comment_reactions
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.current_app_user_id()
    or public.can_manage_social_comment(comment_id)
  );

grant select, insert, update, delete on table public.social_page_reads to authenticated;
grant select, insert, update, delete on table public.social_post_reactions to authenticated;
grant select, insert, update, delete on table public.social_comment_reactions to authenticated;
