-- Allow subtask inserts when the user can access the parent task.
-- Run once in Supabase SQL editor for existing environments.
-- Safe to re-run.

drop policy if exists tasks_insert_with_parent_access on public.tasks;
create policy tasks_insert_with_parent_access
  on public.tasks
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and parent_task_id is not null
    and coalesce(created_by_user_id, auth.uid()) in (auth.uid(), public.current_app_user_id())
    and public.can_access_task(parent_task_id)
  );

