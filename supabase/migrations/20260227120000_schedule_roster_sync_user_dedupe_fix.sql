-- Prevent schedule roster sync from inserting duplicate rows for the same user
-- when multiple employee-info records resolve to one app user.

create or replace function public.schedule_sync_roster_for_client(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  role_column_id uuid;
  upserted_count integer := 0;
  deactivated_count integer := 0;
begin
  if not public.schedule_can_edit_client(p_client_id) then
    raise exception 'Not authorized to sync schedule roster';
  end if;

  select c.id
  into role_column_id
  from public.employee_info_columns c
  where c.column_kind <> 'formula'
    and (
      public.schedule_normalize_role_token(c.key) in ('role', 'employee_role', 'job_role')
      or public.schedule_normalize_role_token(c.label) in ('role', 'employee_role', 'job_role')
    )
  order by c.position asc, c.created_at asc
  limit 1;

  with unique_user_name as (
    select
      lower(trim(coalesce(u.full_name, ''))) as name_key,
      min(u.id::text)::uuid as user_id,
      count(*) as user_count
    from public.users u
    where length(trim(coalesce(u.full_name, ''))) > 0
    group by lower(trim(coalesce(u.full_name, '')))
  ),
  employee_scope as (
    select
      r.id as record_id,
      r.full_name,
      coalesce(
        r.user_id,
        case when uu.user_count = 1 then uu.user_id else null end
      ) as resolved_user_id,
      (r.user_id is not null) as has_explicit_user_link,
      coalesce(v.option_value, v.text_value, '') as role_text
    from public.employee_info_records r
    left join unique_user_name uu
      on uu.name_key = lower(trim(coalesce(r.full_name, '')))
    left join public.employee_info_values v
      on v.record_id = r.id
     and v.column_id = role_column_id
    where r.client_id = p_client_id
  ),
  update_employee_links as (
    update public.employee_info_records r
    set
      user_id = es.resolved_user_id,
      updated_at = now()
    from employee_scope es
    where r.id = es.record_id
      and r.user_id is distinct from es.resolved_user_id
      and es.resolved_user_id is not null
    returning r.id
  ),
  chosen_employee_rows_with_user as (
    select distinct on (es.resolved_user_id)
      es.record_id,
      es.full_name,
      es.resolved_user_id,
      es.role_text
    from employee_scope es
    where es.resolved_user_id is not null
    order by
      es.resolved_user_id,
      es.has_explicit_user_link desc,
      es.record_id
  ),
  chosen_employee_rows_without_user as (
    select
      es.record_id,
      es.full_name,
      es.role_text
    from employee_scope es
    where es.resolved_user_id is null
  ),
  cleanup_employee_record_conflicts as (
    delete from public.schedule_roster_entries sre
    using chosen_employee_rows_with_user chosen
    where sre.client_id = p_client_id
      and sre.employee_info_record_id = chosen.record_id
      and (sre.user_id is distinct from chosen.resolved_user_id)
    returning sre.id
  ),
  upsert_employee_rows_with_user as (
    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      employee_info_record_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    select
      p_client_id,
      chosen.resolved_user_id,
      chosen.record_id,
      chosen.full_name,
      u.email,
      public.schedule_role_token_from_text(chosen.role_text),
      public.schedule_role_label_from_token(public.schedule_role_token_from_text(chosen.role_text)),
      'employee_info',
      true,
      actor_id
    from chosen_employee_rows_with_user chosen
    left join public.users u on u.id = chosen.resolved_user_id
    on conflict (client_id, user_id)
    do update set
      employee_info_record_id = excluded.employee_info_record_id,
      display_name = excluded.display_name,
      email = excluded.email,
      role_token = excluded.role_token,
      role_label = excluded.role_label,
      source = 'employee_info',
      active = true,
      updated_at = now()
    returning id
  ),
  upsert_employee_rows_without_user as (
    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      employee_info_record_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    select
      p_client_id,
      null,
      chosen.record_id,
      chosen.full_name,
      null,
      public.schedule_role_token_from_text(chosen.role_text),
      public.schedule_role_label_from_token(public.schedule_role_token_from_text(chosen.role_text)),
      'employee_info',
      true,
      actor_id
    from chosen_employee_rows_without_user chosen
    on conflict (client_id, employee_info_record_id)
    do update set
      user_id = excluded.user_id,
      display_name = excluded.display_name,
      email = excluded.email,
      role_token = excluded.role_token,
      role_label = excluded.role_label,
      source = 'employee_info',
      active = true,
      updated_at = now()
    returning id
  ),
  upsert_client_memberships as (
    insert into public.schedule_roster_entries (
      client_id,
      user_id,
      employee_info_record_id,
      display_name,
      email,
      role_token,
      role_label,
      source,
      active,
      created_by_user_id
    )
    select
      p_client_id,
      u.id,
      null,
      coalesce(nullif(trim(u.full_name), ''), u.email, 'Team member'),
      u.email,
      'agent',
      'Agent',
      'client_membership',
      true,
      actor_id
    from public.client_users cu
    join public.users u on u.id = cu.user_id
    where cu.client_id = p_client_id
    on conflict (client_id, user_id)
    do update set
      display_name = excluded.display_name,
      email = excluded.email,
      active = true,
      source = case
        when public.schedule_roster_entries.source = 'employee_info' then public.schedule_roster_entries.source
        else excluded.source
      end,
      updated_at = now()
    returning id
  )
  select
    coalesce((select count(*) from upsert_employee_rows_with_user), 0)
      + coalesce((select count(*) from upsert_employee_rows_without_user), 0)
      + coalesce((select count(*) from upsert_client_memberships), 0)
  into upserted_count;

  with stale as (
    update public.schedule_roster_entries sre
    set
      active = false,
      updated_at = now()
    where sre.client_id = p_client_id
      and sre.source = 'employee_info'
      and sre.employee_info_record_id is not null
      and not exists (
        select 1
        from public.employee_info_records r
        where r.id = sre.employee_info_record_id
          and r.client_id = p_client_id
      )
    returning sre.id
  )
  select coalesce(count(*), 0) into deactivated_count from stale;

  return jsonb_build_object(
    'upserted', upserted_count,
    'deactivated', deactivated_count
  );
end;
$$;

grant execute on function public.schedule_sync_roster_for_client(uuid) to anon, authenticated;
