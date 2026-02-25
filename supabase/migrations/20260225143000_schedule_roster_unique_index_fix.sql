-- Fix schedule roster upsert conflicts.
-- ON CONFLICT inference does not match partial unique indexes without predicates.
-- Replace partial unique indexes with standard unique indexes so existing RPCs work.

drop index if exists public.schedule_roster_entries_client_user_unique;
drop index if exists public.schedule_roster_entries_client_employee_record_unique;

create unique index if not exists schedule_roster_entries_client_user_unique
  on public.schedule_roster_entries(client_id, user_id);

create unique index if not exists schedule_roster_entries_client_employee_record_unique
  on public.schedule_roster_entries(client_id, employee_info_record_id);
