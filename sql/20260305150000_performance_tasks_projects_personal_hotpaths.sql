-- Performance indexes for the most-used areas:
-- /tasks, /projects, /personal

-- Speed up assignee filter lookups that read task ids by user id.
do $$
begin
  if to_regclass('public.task_assignees') is not null then
    execute '
      create index if not exists idx_task_assignees_user_task_id
      on public.task_assignees(user_id, task_id)
    ';
  end if;
end $$;

-- Speed up project membership lookups by user id.
do $$
begin
  if to_regclass('public.project_users') is not null then
    execute '
      create index if not exists idx_project_users_user_project_id
      on public.project_users(user_id, project_id)
    ';
  end if;
end $$;

-- Speed up project watcher lookups by user id.
do $$
begin
  if to_regclass('public.project_watchers') is not null then
    execute '
      create index if not exists idx_project_watchers_user_project_id
      on public.project_watchers(user_id, project_id)
    ';
  end if;
end $$;

-- Speed up non-admin project visibility queries ordered by newest.
do $$
begin
  if to_regclass('public.projects') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'projects'
        and column_name = 'created_by_user_id'
    )
  then
    execute '
      create index if not exists idx_projects_creator_created_at
      on public.projects(created_by_user_id, created_at desc)
    ';
  end if;
end $$;

-- Speed up personal page linked-client note list ordered by recent edits.
do $$
begin
  if to_regclass('public.notes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'notes'
        and column_name = 'source_personal_page_id'
    )
  then
    execute '
      create index if not exists idx_notes_source_personal_page_last_edited_at
      on public.notes(source_personal_page_id, last_edited_at desc)
    ';
  end if;
end $$;
