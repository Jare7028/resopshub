create or replace function public.schedule_upsert_job_code(
  p_job_code_id uuid default null,
  p_code text default null,
  p_label text default null,
  p_color_hex text default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := public.current_app_user_id();
  target_id uuid;
  normalized_code text := upper(trim(coalesce(p_code, '')));
  normalized_label text := trim(coalesce(p_label, ''));
  normalized_color text := upper(trim(coalesce(p_color_hex, '#2563EB')));
begin
  if not public.schedule_can_manage_job_codes() then
    raise exception 'Not authorized to manage job codes';
  end if;

  if normalized_code = '' then
    raise exception 'Job code is required';
  end if;
  if normalized_label = '' then
    raise exception 'Job code label is required';
  end if;
  if normalized_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Job code color must be a 6-digit hex value (e.g. #2563EB)';
  end if;

  if p_job_code_id is null then
    insert into public.schedule_job_codes (
      code,
      label,
      color_hex,
      sort_order,
      is_active,
      created_by_user_id
    )
    values (
      normalized_code,
      normalized_label,
      normalized_color,
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true),
      actor_id
    )
    on conflict (code)
    do update set
      label = excluded.label,
      color_hex = excluded.color_hex,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = now()
    returning id into target_id;
  else
    update public.schedule_job_codes
    set
      code = normalized_code,
      label = normalized_label,
      color_hex = normalized_color,
      sort_order = coalesce(p_sort_order, 0),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_job_code_id
    returning id into target_id;
  end if;

  if target_id is null then
    raise exception 'Job code update failed';
  end if;

  return target_id;
end;
$$;

create or replace function public.schedule_delete_job_code(p_job_code_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  in_use boolean := false;
begin
  if not public.schedule_can_manage_job_codes() then
    raise exception 'Not authorized to delete job codes';
  end if;

  select exists (
    select 1
    from public.schedule_shifts s
    where s.job_code_id = p_job_code_id
  )
  into in_use;

  if in_use then
    update public.schedule_job_codes
    set
      is_active = false,
      updated_at = now()
    where id = p_job_code_id;
    return true;
  end if;

  delete from public.schedule_job_codes
  where id = p_job_code_id;

  return true;
end;
$$;

grant execute on function public.schedule_upsert_job_code(uuid, text, text, text, integer, boolean) to anon, authenticated;
grant execute on function public.schedule_delete_job_code(uuid) to anon, authenticated;
