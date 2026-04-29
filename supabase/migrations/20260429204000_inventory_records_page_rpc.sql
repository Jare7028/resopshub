create index if not exists inventory_records_created_id_idx
  on public.inventory_records(created_at desc, id);

create or replace function public.inventory_records_page(
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
    select least(greatest(coalesce(p_limit, 100), 1), 500) as row_limit
  ),
  scoped_records as (
    select r.id, r.full_name, r.client_id, r.created_at
    from public.inventory_records r
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

grant execute on function public.inventory_records_page(integer) to authenticated;
