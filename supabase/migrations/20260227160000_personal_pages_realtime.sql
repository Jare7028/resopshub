-- Ensure linked Personal/Client notes can receive realtime row updates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.personal_pages';
    exception
      when duplicate_object then
        null;
    end;
  end if;
end;
$$;
