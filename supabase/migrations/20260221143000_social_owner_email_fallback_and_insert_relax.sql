-- Harden Social access checks with owner email fallback and relax insert identity checks.

create or replace function public.can_access_social_page(social_page_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select
      auth.uid() as auth_uid,
      public.current_app_user_id() as app_uid,
      lower(
        coalesce(
          auth.email(),
          auth.jwt() ->> 'email',
          (
            select au.email
            from auth.users au
            where au.id = auth.uid()
            limit 1
          ),
          ''
        )
      ) as email_norm
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
            from public.users u
            where u.id = sp.created_by
              and lower(u.email::text) = (select email_norm from me)
          )
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
    select
      auth.uid() as auth_uid,
      public.current_app_user_id() as app_uid,
      lower(
        coalesce(
          auth.email(),
          auth.jwt() ->> 'email',
          (
            select au.email
            from auth.users au
            where au.id = auth.uid()
            limit 1
          ),
          ''
        )
      ) as email_norm
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
            from public.users u
            where u.id = sp.created_by
              and lower(u.email::text) = (select email_norm from me)
          )
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

drop policy if exists social_pages_insert on public.social_pages;
create policy social_pages_insert
  on public.social_pages
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.can_edit_page('social')
  );

drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert
  on public.social_posts
  for insert
  to authenticated
  with check (
    public.can_access_social_page(page_id)
    and public.can_edit_page('social')
  );

drop policy if exists social_post_comments_insert on public.social_post_comments;
create policy social_post_comments_insert
  on public.social_post_comments
  for insert
  to authenticated
  with check (
    public.can_access_social_post(post_id)
    and public.can_edit_page('social')
  );
