-- Recurring task support (apply in Supabase SQL editor).
alter table tasks
  add column if not exists recurrence_frequency text;

alter table tasks
  add column if not exists recurrence_interval int;

alter table tasks
  add column if not exists recurrence_weekdays int[];

alter table tasks
  add column if not exists recurrence_month_day int;

alter table tasks
  add column if not exists recurrence_month_week int;

alter table tasks
  add column if not exists recurrence_month_weekday int;

alter table tasks
  add column if not exists recurrence_start_date date;

alter table tasks
  add column if not exists recurrence_end_date date;

alter table tasks
  add column if not exists recurrence_lead_days int;

alter table tasks
  add column if not exists recurrence_next_date date;

alter table tasks
  add column if not exists recurrence_timezone text;

alter table tasks
  add column if not exists due_time time;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_recurrence_frequency_check'
  ) then
    alter table tasks
      add constraint tasks_recurrence_frequency_check
      check (
        recurrence_frequency is null
        or recurrence_frequency in ('daily', 'weekly', 'monthly', 'yearly')
      );
  end if;
end $$;

create index if not exists tasks_recurrence_next_date_idx
  on tasks (recurrence_next_date)
  where recurrence_frequency is not null;
