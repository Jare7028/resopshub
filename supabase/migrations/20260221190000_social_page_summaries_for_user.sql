-- Fast Social landing summaries without transferring all posts to the app.

create or replace function public.social_page_summaries_for_user(
  p_user_id uuid default public.current_app_user_id()
)
returns table (
  page_id uuid,
  member_count integer,
  post_total integer,
  latest_post_at timestamptz,
  unread_count integer
)
language sql
stable
set search_path = public
as $$
  with page_scope as (
    select sp.id, sp.created_by
    from public.social_pages sp
    where public.can_access_social_page(sp.id)
  ),
  member_union as (
    select ps.id as page_id, ps.created_by as user_id
    from page_scope ps
    union all
    select m.page_id, m.user_id
    from public.social_page_members m
    join page_scope ps on ps.id = m.page_id
  ),
  member_counts as (
    select mu.page_id, count(distinct mu.user_id)::int as member_count
    from member_union mu
    group by mu.page_id
  ),
  post_stats as (
    select p.page_id, count(*)::int as post_total, max(p.created_at) as latest_post_at
    from public.social_posts p
    join page_scope ps on ps.id = p.page_id
    group by p.page_id
  ),
  unread_stats as (
    select p.page_id, count(*)::int as unread_count
    from public.social_posts p
    join page_scope ps on ps.id = p.page_id
    left join public.social_page_reads r
      on r.page_id = p.page_id
     and r.user_id = coalesce(p_user_id, public.current_app_user_id())
    where r.last_read_at is null or p.created_at > r.last_read_at
    group by p.page_id
  )
  select
    ps.id as page_id,
    coalesce(mc.member_count, 1) as member_count,
    coalesce(pt.post_total, 0) as post_total,
    pt.latest_post_at,
    coalesce(us.unread_count, 0) as unread_count
  from page_scope ps
  left join member_counts mc on mc.page_id = ps.id
  left join post_stats pt on pt.page_id = ps.id
  left join unread_stats us on us.page_id = ps.id;
$$;

grant execute on function public.social_page_summaries_for_user(uuid) to authenticated;
