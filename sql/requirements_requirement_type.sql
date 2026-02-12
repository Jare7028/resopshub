-- Add requirement type for client requirements.
alter table public.requirements
  add column if not exists requirement_type text;

-- Backfill legacy billable hours values into requirement_type where empty.
update public.requirements
set requirement_type = billable_hours::text
where requirement_type is null
  and billable_hours is not null;

