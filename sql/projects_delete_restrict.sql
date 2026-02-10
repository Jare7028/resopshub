-- Restrict project deletion to admins or the project creator.
-- Apply in Supabase SQL editor.

alter table public.projects enable row level security;

drop policy if exists projects_delete on public.projects;
create policy projects_delete
  on public.projects
  for delete
  to authenticated
  using (
    public.is_admin()
    or created_by_user_id = auth.uid()
  );

