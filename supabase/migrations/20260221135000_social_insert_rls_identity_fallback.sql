-- Harden Social insert RLS against auth/app identity mismatch.

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
