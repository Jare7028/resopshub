alter table tasks
  add column if not exists start_date date;

alter table tasks
  alter column start_date set default current_date;

update tasks
set start_date = coalesce(start_date, created_at::date, current_date)
where start_date is null;
