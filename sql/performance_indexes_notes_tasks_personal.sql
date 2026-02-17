-- Performance indexes for high-traffic notes/tasks/personal queries.
-- Run after:
--   sql/notes_metadata.sql
--   sql/task_assignees.sql
--   sql/watchers.sql
--   sql/personal.sql
--   sql/personal_templates_and_page_order.sql

create index if not exists idx_tasks_root_assignee_created_at
  on public.tasks(assignee_user_id, created_at desc)
  where parent_task_id is null;

create index if not exists idx_tasks_root_creator_created_at
  on public.tasks(created_by_user_id, created_at desc)
  where parent_task_id is null;

create index if not exists idx_tasks_parent_created_at
  on public.tasks(parent_task_id, created_at desc);

create index if not exists idx_tasks_parent_open_created_at
  on public.tasks(parent_task_id, created_at)
  where status not in ('completed', 'cancelled');

create index if not exists idx_tasks_parent_due_date
  on public.tasks(parent_task_id, due_date)
  where due_date is not null;

create index if not exists idx_tasks_status_parent_title
  on public.tasks(status, parent_task_id, title);

create index if not exists idx_tasks_root_project_created_at
  on public.tasks(project_id, created_at desc)
  where parent_task_id is null;

create index if not exists idx_tasks_root_project_open
  on public.tasks(project_id)
  where parent_task_id is null
    and status not in ('completed', 'cancelled');

create index if not exists idx_tasks_root_client_created_at
  on public.tasks(client_id, created_at desc)
  where parent_task_id is null;

create index if not exists idx_notes_user_last_edited_at
  on public.notes(user_id, last_edited_at desc);

create index if not exists idx_notes_last_edited_at
  on public.notes(last_edited_at desc);

create index if not exists idx_personal_sections_owner_sort_order
  on public.personal_sections(owner_id, sort_order);

create index if not exists idx_personal_pages_owner_section_sort_order
  on public.personal_pages(owner_id, section_id, sort_order);

create index if not exists idx_personal_pages_updated_at
  on public.personal_pages(updated_at desc);

create index if not exists idx_personal_pages_share_mode_updated_at
  on public.personal_pages(share_mode, updated_at desc);

create index if not exists idx_personal_section_members_section_created_at
  on public.personal_section_members(section_id, created_at);

create index if not exists idx_personal_page_members_page_created_at
  on public.personal_page_members(page_id, created_at);
