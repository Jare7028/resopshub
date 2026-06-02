do $$
begin
  if to_regclass('public.social_pages') is null
    or to_regclass('public.social_page_members') is null
    or to_regclass('public.social_posts') is null
    or to_regclass('public.social_page_reads') is null
  then
    raise notice 'Skipping social_landing_page because Social tables are not installed.';
    return;
  end if;

  execute $sql$
    create index if not exists idx_social_pages_updated_at
      on public.social_pages(updated_at desc, id)
  $sql$;

  execute $sql$
    create or replace function public.social_landing_page(
      p_user_id uuid default public.current_app_user_id(),
      p_limit integer default 24,
      p_offset integer default 0
    )
    returns table(
      id uuid,
      name text,
      description text,
      created_by uuid,
      created_at timestamptz,
      updated_at timestamptz,
      member_count integer,
      post_total integer,
      latest_post_at timestamptz,
      unread_count integer,
      my_role text,
      owner_label text,
      owner_avatar_url text,
      total_count bigint,
      posts_last_7d bigint,
      active_pages_last_7d bigint
    )
    language sql
    stable
    security invoker
    set search_path = public
    as $function$
      with settings as (
        select
          coalesce(p_user_id, public.current_app_user_id()) as user_id,
          least(greatest(coalesce(p_limit, 24), 1), 48) as row_limit,
          greatest(coalesce(p_offset, 0), 0) as row_offset,
          now() - interval '7 days' as recent_cutoff
      ),
      page_scope as (
        select
          sp.id,
          sp.name,
          sp.description,
          sp.created_by,
          sp.created_at,
          sp.updated_at
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
        select
          mu.page_id,
          count(distinct mu.user_id)::integer as member_count
        from member_union mu
        group by mu.page_id
      ),
      post_stats as (
        select
          p.page_id,
          count(*)::integer as post_total,
          max(p.created_at) as latest_post_at
        from public.social_posts p
        join page_scope ps on ps.id = p.page_id
        group by p.page_id
      ),
      unread_stats as (
        select
          p.page_id,
          count(*)::integer as unread_count
        from public.social_posts p
        join page_scope ps on ps.id = p.page_id
        cross join settings s
        left join public.social_page_reads r
          on r.page_id = p.page_id
         and r.user_id = s.user_id
        where r.last_read_at is null or p.created_at > r.last_read_at
        group by p.page_id
      ),
      recent_stats as (
        select
          count(p.id) filter (where p.created_at >= s.recent_cutoff)::bigint as posts_last_7d,
          count(distinct p.page_id) filter (where p.created_at >= s.recent_cutoff)::bigint as active_pages_last_7d
        from settings s
        left join page_scope ps on true
        left join public.social_posts p on p.page_id = ps.id
      ),
      counted as (
        select
          ps.*,
          coalesce(mc.member_count, 1) as member_count,
          coalesce(pt.post_total, 0) as post_total,
          pt.latest_post_at,
          coalesce(us.unread_count, 0) as unread_count,
          my_membership.role as my_role,
          coalesce(nullif(trim(owner.full_name), ''), nullif(trim(owner.email), ''), 'Unknown user') as owner_label,
          nullif(trim(owner.avatar_url), '') as owner_avatar_url,
          count(*) over()::bigint as total_count
        from page_scope ps
        cross join settings s
        left join member_counts mc on mc.page_id = ps.id
        left join post_stats pt on pt.page_id = ps.id
        left join unread_stats us on us.page_id = ps.id
        left join public.social_page_members my_membership
          on my_membership.page_id = ps.id
         and my_membership.user_id = s.user_id
        left join public.users owner on owner.id = ps.created_by
      )
      select
        counted.id,
        counted.name,
        counted.description,
        counted.created_by,
        counted.created_at,
        counted.updated_at,
        counted.member_count,
        counted.post_total,
        counted.latest_post_at,
        counted.unread_count,
        counted.my_role,
        counted.owner_label,
        counted.owner_avatar_url,
        counted.total_count,
        coalesce(rs.posts_last_7d, 0) as posts_last_7d,
        coalesce(rs.active_pages_last_7d, 0) as active_pages_last_7d
      from counted
      cross join settings s
      cross join recent_stats rs
      order by counted.updated_at desc, counted.id asc
      limit (select row_limit from settings)
      offset (select row_offset from settings);
    $function$
  $sql$;

  execute $sql$
    grant execute on function public.social_landing_page(uuid, integer, integer)
      to authenticated
  $sql$;
end $$;
