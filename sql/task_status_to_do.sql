-- Task status update: add "to_do" as a first-class status.
--
-- We keep the legacy enum value "backlog" for backwards compatibility.
-- The app maps "backlog" -> "to_do" for display and filtering.

alter type public.task_status
  add value if not exists 'to_do';

