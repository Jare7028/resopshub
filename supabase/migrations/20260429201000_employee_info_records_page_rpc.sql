create index if not exists employee_info_records_created_id_idx
  on public.employee_info_records(created_at desc, id);

create or replace function public.employee_info_records_page(
  p_restrict_client_scope boolean default false,
  p_allowed_client_ids uuid[] default '{}'::uuid[],
  p_role_column_id uuid default null,
  p_allowed_role_tokens text[] default '{}'::text[],
  p_limit integer default 100
)
returns table(
  id uuid,
  full_name text,
  client_id uuid,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select
      coalesce(p_restrict_client_scope, false) as restrict_client_scope,
      coalesce(p_allowed_client_ids, '{}'::uuid[]) as allowed_client_ids,
      p_role_column_id as role_column_id,
      coalesce(p_allowed_role_tokens, '{}'::text[]) as allowed_role_tokens,
      least(greatest(coalesce(p_limit, 100), 1), 500) as row_limit
  ),
  scoped_records as (
    select r.id, r.full_name, r.client_id, r.created_at
    from public.employee_info_records r
    cross join settings s
    where (
        not s.restrict_client_scope
        or r.client_id = any(s.allowed_client_ids)
      )
      and (
        s.role_column_id is null
        or coalesce(array_length(s.allowed_role_tokens, 1), 0) = 0
        or exists (
          select 1
          from public.employee_info_values v
          where v.record_id = r.id
            and v.column_id = s.role_column_id
            and lower(
              regexp_replace(
                trim(coalesce(v.option_value, v.text_value, '')),
                '[[:space:]]+',
                ' ',
                'g'
              )
            ) = any(s.allowed_role_tokens)
        )
      )
  ),
  counted as (
    select count(*)::bigint as total_count
    from scoped_records
  )
  select
    sr.id,
    sr.full_name,
    sr.client_id,
    sr.created_at,
    counted.total_count
  from scoped_records sr
  cross join counted
  order by sr.created_at desc nulls last, sr.id asc
  limit (select row_limit from settings);
$$;

grant execute on function public.employee_info_records_page(
  boolean,
  uuid[],
  uuid,
  text[],
  integer
) to authenticated;
