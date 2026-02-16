-- Performance indexes for assignment-aware forms/templates access checks.
-- Run after:
--   sql/forms.sql
--   sql/forms_task_templates.sql
--   sql/templates.sql
--   sql/forms_templates_assignment_security.sql

create index if not exists idx_form_submissions_open_form_id
  on public.form_submissions(form_id)
  where status not in ('completed', 'rejected');

create index if not exists idx_form_submission_actions_assignee_enabled_form
  on public.form_submission_actions(assignee_user_id, form_id)
  where enabled is not false;

create index if not exists idx_form_submission_task_templates_template_enabled_form
  on public.form_submission_task_templates(task_template_id, form_id)
  where enabled is not false;

create index if not exists idx_form_submission_template_tasks_task_template_id
  on public.form_submission_template_tasks(task_template_id);

create index if not exists idx_project_template_tasks_task_template_id
  on public.project_template_tasks(task_template_id);
