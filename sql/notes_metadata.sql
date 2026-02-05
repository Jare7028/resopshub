alter table personal_pages
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_user_id uuid;

alter table tasks
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_user_id uuid;

alter table personal_pages
  alter column last_edited_at set default now();

alter table tasks
  alter column last_edited_at set default now();

update personal_pages
set last_edited_at = coalesce(last_edited_at, now())
where last_edited_at is null;

update tasks
set last_edited_at = coalesce(last_edited_at, now())
where last_edited_at is null;
