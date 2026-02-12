-- Add status and end date fields for client requirements board/gantt views.
alter table public.requirements
  add column if not exists status text not null default 'to_do';

alter table public.requirements
  add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'requirements_status_check'
  ) then
    alter table public.requirements
      add constraint requirements_status_check
      check (status in ('to_do','in_progress','blocked','completed','cancelled'));
  end if;
end $$;

