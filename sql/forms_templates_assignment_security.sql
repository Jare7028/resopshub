-- Harden forms/templates access to assignment + ownership.
-- Run after:
--   sql/rls_identity_fix.sql
--   sql/forms.sql
--   sql/forms_task_templates.sql
--   sql/templates.sql

create or replace function public.can_manage_form(form_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.forms f
    where f.id = form_uuid
      and (
        public.is_admin()
        or f.created_by in ((select auth_uid from me), (select app_uid from me))
      )
  );
$$;

create or replace function public.can_access_form(form_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.forms f
    where f.id = form_uuid
      and (
        public.is_admin()
        or f.created_by in ((select auth_uid from me), (select app_uid from me))
        or exists (
          select 1
          from public.form_submission_actions fsa
          where fsa.form_id = f.id
            and fsa.enabled is not false
            and fsa.assignee_user_id in ((select auth_uid from me), (select app_uid from me))
        )
        or exists (
          select 1
          from public.form_submission_task_templates fst
          join public.task_template_assignees tta
            on tta.task_template_id = fst.task_template_id
          where fst.form_id = f.id
            and fst.enabled is not false
            and tta.user_id in ((select auth_uid from me), (select app_uid from me))
        )
      )
  );
$$;

create or replace function public.can_access_form_submission(submission_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.form_submissions s
    where s.id = submission_uuid
      and (
        public.can_access_form(s.form_id)
        or s.submitted_by in ((select auth_uid from me), (select app_uid from me))
      )
  );
$$;

create or replace function public.can_manage_form_submission(submission_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.form_submissions s
    where s.id = submission_uuid
      and (
        public.can_manage_form(s.form_id)
        or s.submitted_by in ((select auth_uid from me), (select app_uid from me))
      )
  );
$$;

create or replace function public.can_access_task_template(task_template_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.task_templates tt
    where tt.id = task_template_uuid
      and (
        public.is_admin()
        or tt.created_by in ((select auth_uid from me), (select app_uid from me))
        or exists (
          select 1
          from public.task_template_assignees tta
          where tta.task_template_id = tt.id
            and tta.user_id in ((select auth_uid from me), (select app_uid from me))
        )
      )
  );
$$;

create or replace function public.can_manage_task_template(task_template_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.task_templates tt
    where tt.id = task_template_uuid
      and (
        public.is_admin()
        or tt.created_by in ((select auth_uid from me), (select app_uid from me))
      )
  );
$$;

create or replace function public.can_access_project_template(project_template_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.project_templates pt
    where pt.id = project_template_uuid
      and (
        public.is_admin()
        or pt.created_by in ((select auth_uid from me), (select app_uid from me))
        or exists (
          select 1
          from public.project_template_tasks ptt
          where ptt.project_template_id = pt.id
            and public.can_access_task_template(ptt.task_template_id)
        )
      )
  );
$$;

create or replace function public.can_manage_project_template(project_template_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null and exists (
    select 1
    from public.project_templates pt
    where pt.id = project_template_uuid
      and (
        public.is_admin()
        or pt.created_by in ((select auth_uid from me), (select app_uid from me))
      )
  );
$$;

grant execute on function public.can_manage_form(uuid) to authenticated;
grant execute on function public.can_access_form(uuid) to authenticated;
grant execute on function public.can_access_form_submission(uuid) to authenticated;
grant execute on function public.can_manage_form_submission(uuid) to authenticated;
grant execute on function public.can_access_task_template(uuid) to authenticated;
grant execute on function public.can_manage_task_template(uuid) to authenticated;
grant execute on function public.can_access_project_template(uuid) to authenticated;
grant execute on function public.can_manage_project_template(uuid) to authenticated;

alter table public.forms enable row level security;
alter table public.form_submission_actions enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_submission_comments enable row level security;
alter table public.form_submission_action_tasks enable row level security;
alter table public.form_submission_task_templates enable row level security;
alter table public.form_submission_template_tasks enable row level security;

alter table public.task_templates enable row level security;
alter table public.project_templates enable row level security;
alter table public.task_template_subtasks enable row level security;
alter table public.task_template_assignees enable row level security;
alter table public.task_template_subtask_assignees enable row level security;
alter table public.project_template_tasks enable row level security;

drop policy if exists forms_select on public.forms;
create policy forms_select
  on public.forms
  for select
  to authenticated
  using (public.can_access_form(id));

drop policy if exists forms_insert on public.forms;
create policy forms_insert
  on public.forms
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and coalesce(created_by, public.current_app_user_id()) in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists forms_update on public.forms;
create policy forms_update
  on public.forms
  for update
  to authenticated
  using (public.can_manage_form(id))
  with check (public.can_manage_form(id));

drop policy if exists forms_delete on public.forms;
create policy forms_delete
  on public.forms
  for delete
  to authenticated
  using (public.can_manage_form(id));

drop policy if exists form_submission_actions_select on public.form_submission_actions;
create policy form_submission_actions_select
  on public.form_submission_actions
  for select
  to authenticated
  using (
    public.can_access_form(form_id)
    or assignee_user_id in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists form_submission_actions_insert on public.form_submission_actions;
create policy form_submission_actions_insert
  on public.form_submission_actions
  for insert
  to authenticated
  with check (public.can_manage_form(form_id));

drop policy if exists form_submission_actions_update on public.form_submission_actions;
create policy form_submission_actions_update
  on public.form_submission_actions
  for update
  to authenticated
  using (public.can_manage_form(form_id))
  with check (public.can_manage_form(form_id));

drop policy if exists form_submission_actions_delete on public.form_submission_actions;
create policy form_submission_actions_delete
  on public.form_submission_actions
  for delete
  to authenticated
  using (public.can_manage_form(form_id));

drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select
  on public.form_submissions
  for select
  to authenticated
  using (public.can_access_form_submission(id));

drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert
  on public.form_submissions
  for insert
  to authenticated
  with check (
    public.can_access_form(form_id)
    and coalesce(submitted_by, public.current_app_user_id()) in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists form_submissions_update on public.form_submissions;
create policy form_submissions_update
  on public.form_submissions
  for update
  to authenticated
  using (public.can_manage_form_submission(id))
  with check (public.can_manage_form_submission(id));

drop policy if exists form_submissions_delete on public.form_submissions;
create policy form_submissions_delete
  on public.form_submissions
  for delete
  to authenticated
  using (public.can_manage_form_submission(id));

drop policy if exists form_submission_comments_select on public.form_submission_comments;
create policy form_submission_comments_select
  on public.form_submission_comments
  for select
  to authenticated
  using (public.can_access_form_submission(submission_id));

drop policy if exists form_submission_comments_insert on public.form_submission_comments;
create policy form_submission_comments_insert
  on public.form_submission_comments
  for insert
  to authenticated
  with check (
    public.can_access_form_submission(submission_id)
    and user_id in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists form_submission_comments_update on public.form_submission_comments;
create policy form_submission_comments_update
  on public.form_submission_comments
  for update
  to authenticated
  using (
    public.can_access_form_submission(submission_id)
    and (public.is_admin() or user_id in (auth.uid(), public.current_app_user_id()))
  )
  with check (
    public.can_access_form_submission(submission_id)
    and (public.is_admin() or user_id in (auth.uid(), public.current_app_user_id()))
  );

drop policy if exists form_submission_comments_delete on public.form_submission_comments;
create policy form_submission_comments_delete
  on public.form_submission_comments
  for delete
  to authenticated
  using (
    public.can_access_form_submission(submission_id)
    and (public.is_admin() or user_id in (auth.uid(), public.current_app_user_id()))
  );

drop policy if exists form_submission_action_tasks_select on public.form_submission_action_tasks;
create policy form_submission_action_tasks_select
  on public.form_submission_action_tasks
  for select
  to authenticated
  using (public.can_access_form_submission(submission_id));

drop policy if exists form_submission_action_tasks_insert on public.form_submission_action_tasks;
create policy form_submission_action_tasks_insert
  on public.form_submission_action_tasks
  for insert
  to authenticated
  with check (
    public.can_access_form_submission(submission_id)
    and exists (
      select 1
      from public.form_submissions s
      join public.form_submission_actions a
        on a.id = form_submission_action_tasks.action_id
       and a.form_id = s.form_id
      where s.id = form_submission_action_tasks.submission_id
    )
  );

drop policy if exists form_submission_action_tasks_delete on public.form_submission_action_tasks;
create policy form_submission_action_tasks_delete
  on public.form_submission_action_tasks
  for delete
  to authenticated
  using (public.can_manage_form_submission(submission_id));

drop policy if exists form_submission_task_templates_select on public.form_submission_task_templates;
create policy form_submission_task_templates_select
  on public.form_submission_task_templates
  for select
  to authenticated
  using (public.can_access_form(form_id) or public.can_access_task_template(task_template_id));

drop policy if exists form_submission_task_templates_insert on public.form_submission_task_templates;
create policy form_submission_task_templates_insert
  on public.form_submission_task_templates
  for insert
  to authenticated
  with check (
    public.can_manage_form(form_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists form_submission_task_templates_update on public.form_submission_task_templates;
create policy form_submission_task_templates_update
  on public.form_submission_task_templates
  for update
  to authenticated
  using (public.can_manage_form(form_id))
  with check (
    public.can_manage_form(form_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists form_submission_task_templates_delete on public.form_submission_task_templates;
create policy form_submission_task_templates_delete
  on public.form_submission_task_templates
  for delete
  to authenticated
  using (public.can_manage_form(form_id));

drop policy if exists form_submission_template_tasks_select on public.form_submission_template_tasks;
create policy form_submission_template_tasks_select
  on public.form_submission_template_tasks
  for select
  to authenticated
  using (public.can_access_form_submission(submission_id));

drop policy if exists form_submission_template_tasks_insert on public.form_submission_template_tasks;
create policy form_submission_template_tasks_insert
  on public.form_submission_template_tasks
  for insert
  to authenticated
  with check (
    public.can_access_form_submission(submission_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists form_submission_template_tasks_delete on public.form_submission_template_tasks;
create policy form_submission_template_tasks_delete
  on public.form_submission_template_tasks
  for delete
  to authenticated
  using (public.can_manage_form_submission(submission_id));

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select
  on public.task_templates
  for select
  to authenticated
  using (public.can_access_task_template(id));

drop policy if exists task_templates_insert on public.task_templates;
create policy task_templates_insert
  on public.task_templates
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and coalesce(created_by, public.current_app_user_id()) in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists task_templates_update on public.task_templates;
create policy task_templates_update
  on public.task_templates
  for update
  to authenticated
  using (public.can_manage_task_template(id))
  with check (public.can_manage_task_template(id));

drop policy if exists task_templates_delete on public.task_templates;
create policy task_templates_delete
  on public.task_templates
  for delete
  to authenticated
  using (public.can_manage_task_template(id));

drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select
  on public.project_templates
  for select
  to authenticated
  using (public.can_access_project_template(id));

drop policy if exists project_templates_insert on public.project_templates;
create policy project_templates_insert
  on public.project_templates
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and coalesce(created_by, public.current_app_user_id()) in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists project_templates_update on public.project_templates;
create policy project_templates_update
  on public.project_templates
  for update
  to authenticated
  using (public.can_manage_project_template(id))
  with check (public.can_manage_project_template(id));

drop policy if exists project_templates_delete on public.project_templates;
create policy project_templates_delete
  on public.project_templates
  for delete
  to authenticated
  using (public.can_manage_project_template(id));

drop policy if exists task_template_subtasks_select on public.task_template_subtasks;
create policy task_template_subtasks_select
  on public.task_template_subtasks
  for select
  to authenticated
  using (public.can_access_task_template(task_template_id));

drop policy if exists task_template_subtasks_insert on public.task_template_subtasks;
create policy task_template_subtasks_insert
  on public.task_template_subtasks
  for insert
  to authenticated
  with check (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_subtasks_update on public.task_template_subtasks;
create policy task_template_subtasks_update
  on public.task_template_subtasks
  for update
  to authenticated
  using (public.can_manage_task_template(task_template_id))
  with check (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_subtasks_delete on public.task_template_subtasks;
create policy task_template_subtasks_delete
  on public.task_template_subtasks
  for delete
  to authenticated
  using (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_assignees_select on public.task_template_assignees;
create policy task_template_assignees_select
  on public.task_template_assignees
  for select
  to authenticated
  using (
    public.can_access_task_template(task_template_id)
    or user_id in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists task_template_assignees_insert on public.task_template_assignees;
create policy task_template_assignees_insert
  on public.task_template_assignees
  for insert
  to authenticated
  with check (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_assignees_update on public.task_template_assignees;
create policy task_template_assignees_update
  on public.task_template_assignees
  for update
  to authenticated
  using (public.can_manage_task_template(task_template_id))
  with check (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_assignees_delete on public.task_template_assignees;
create policy task_template_assignees_delete
  on public.task_template_assignees
  for delete
  to authenticated
  using (public.can_manage_task_template(task_template_id));

drop policy if exists task_template_subtask_assignees_select on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_select
  on public.task_template_subtask_assignees
  for select
  to authenticated
  using (
    public.can_access_task_template((
      select tts.task_template_id
      from public.task_template_subtasks tts
      where tts.id = task_template_subtask_assignees.task_template_subtask_id
    ))
    or user_id in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists task_template_subtask_assignees_insert on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_insert
  on public.task_template_subtask_assignees
  for insert
  to authenticated
  with check (
    public.can_manage_task_template((
      select tts.task_template_id
      from public.task_template_subtasks tts
      where tts.id = task_template_subtask_assignees.task_template_subtask_id
    ))
  );

drop policy if exists task_template_subtask_assignees_update on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_update
  on public.task_template_subtask_assignees
  for update
  to authenticated
  using (
    public.can_manage_task_template((
      select tts.task_template_id
      from public.task_template_subtasks tts
      where tts.id = task_template_subtask_assignees.task_template_subtask_id
    ))
  )
  with check (
    public.can_manage_task_template((
      select tts.task_template_id
      from public.task_template_subtasks tts
      where tts.id = task_template_subtask_assignees.task_template_subtask_id
    ))
  );

drop policy if exists task_template_subtask_assignees_delete on public.task_template_subtask_assignees;
create policy task_template_subtask_assignees_delete
  on public.task_template_subtask_assignees
  for delete
  to authenticated
  using (
    public.can_manage_task_template((
      select tts.task_template_id
      from public.task_template_subtasks tts
      where tts.id = task_template_subtask_assignees.task_template_subtask_id
    ))
  );

drop policy if exists project_template_tasks_select on public.project_template_tasks;
create policy project_template_tasks_select
  on public.project_template_tasks
  for select
  to authenticated
  using (
    public.can_access_project_template(project_template_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists project_template_tasks_insert on public.project_template_tasks;
create policy project_template_tasks_insert
  on public.project_template_tasks
  for insert
  to authenticated
  with check (
    public.can_manage_project_template(project_template_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists project_template_tasks_update on public.project_template_tasks;
create policy project_template_tasks_update
  on public.project_template_tasks
  for update
  to authenticated
  using (public.can_manage_project_template(project_template_id))
  with check (
    public.can_manage_project_template(project_template_id)
    and public.can_access_task_template(task_template_id)
  );

drop policy if exists project_template_tasks_delete on public.project_template_tasks;
create policy project_template_tasks_delete
  on public.project_template_tasks
  for delete
  to authenticated
  using (public.can_manage_project_template(project_template_id));
