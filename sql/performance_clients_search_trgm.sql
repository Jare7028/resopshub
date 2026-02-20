-- Speeds up ILIKE '%...%' searches on clients.name.
-- Safe to run multiple times.

create extension if not exists pg_trgm;

do $$
begin
  if to_regclass('public.clients') is not null then
    execute '
      create index if not exists clients_name_trgm_idx
      on public.clients using gin (name gin_trgm_ops)
    ';
  end if;
end
$$;
