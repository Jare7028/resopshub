-- Recurring task support (apply in Supabase SQL editor).
alter table tasks
  add column if not exists recurrence_rule text;

alter table tasks
  add column if not exists recurrence_next_date date;

alter table tasks
  add column if not exists recurrence_timezone text;

create index if not exists tasks_recurrence_next_date_idx
  on tasks (recurrence_next_date)
  where recurrence_rule is not null;
