-- Allow unlimited KPIs per client by relaxing the position check constraint.
-- Previously, client_kpis.position was constrained to 1..3.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'client_kpis_position_check'
      and conrelid = 'public.client_kpis'::regclass
  ) then
    alter table public.client_kpis
      drop constraint client_kpis_position_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_kpis_position_positive_check'
      and conrelid = 'public.client_kpis'::regclass
  ) then
    alter table public.client_kpis
      add constraint client_kpis_position_positive_check
      check (position >= 1);
  end if;
end $$;

