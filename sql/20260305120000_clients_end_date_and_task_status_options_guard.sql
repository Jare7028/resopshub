-- Keep clients schema aligned with app queries and guard task status options.
alter table if exists public.clients
  add column if not exists end_date date;

do $$
declare
  has_status_options boolean;
  has_task_status_type boolean;
begin
  select to_regclass('public.status_options') is not null into has_status_options;
  if not has_status_options then
    return;
  end if;

  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'task_status'
      and t.typtype = 'e'
  ) into has_task_status_type;

  if not has_task_status_type then
    return;
  end if;

  delete from public.status_options
  where entity_type = 'task'
    and not (value = any(enum_range(null::public.task_status)::text[]));

  alter table public.status_options
    drop constraint if exists status_options_task_value_matches_enum_check;

  alter table public.status_options
    add constraint status_options_task_value_matches_enum_check
    check (
      entity_type <> 'task'
      or value = any(enum_range(null::public.task_status)::text[])
    );
end
$$;