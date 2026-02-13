-- Add template status to task_status enum.
-- Run this first, in its own SQL execution, then run task_templates_as_tasks.sql.

alter type public.task_status add value if not exists 'template';
