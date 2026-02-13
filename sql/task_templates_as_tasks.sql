-- Mirror task templates into real tasks so template editing can use /tasks/:id.
-- Run after sql/templates.sql.

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'task_status'
      and n.nspname = 'public'
  ) then
    begin
      execute 'alter type public.task_status add value if not exists ''template''';
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

insert into public.status_options (entity_type, value, position)
select 'task', 'template', 999
where not exists (
  select 1
  from public.status_options so
  where so.entity_type = 'task'
    and lower(so.value) = 'template'
);

insert into public.tasks (
  id,
  title,
  description,
  status,
  priority,
  due_time,
  recurrence_frequency,
  recurrence_lead_days,
  content,
  content_text,
  created_at
)
select
  tt.id,
  tt.title,
  tt.description,
  'template',
  tt.priority,
  tt.due_time,
  tt.recurrence_frequency,
  coalesce(tt.recurrence_lead_days, 7),
  '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  '',
  tt.created_at
from public.task_templates tt
left join public.tasks t on t.id = tt.id
where t.id is null;

insert into public.tasks (
  id,
  parent_task_id,
  title,
  description,
  status,
  priority,
  content,
  content_text,
  created_at
)
select
  ts.id,
  ts.task_template_id,
  ts.title,
  ts.description,
  ts.status,
  ts.priority,
  '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  '',
  ts.created_at
from public.task_template_subtasks ts
left join public.tasks t on t.id = ts.id
where t.id is null;

insert into public.task_assignees (task_id, user_id)
select ta.task_template_id, ta.user_id
from public.task_template_assignees ta
join public.tasks t on t.id = ta.task_template_id
on conflict (task_id, user_id) do nothing;

insert into public.task_assignees (task_id, user_id)
select tsa.task_template_subtask_id, tsa.user_id
from public.task_template_subtask_assignees tsa
join public.tasks t on t.id = tsa.task_template_subtask_id
on conflict (task_id, user_id) do nothing;

update public.tasks t
set assignee_user_id = src.user_id
from (
  select task_template_id as task_id, min(user_id) as user_id
  from public.task_template_assignees
  group by task_template_id
) src
where t.id = src.task_id
  and t.status::text = 'template';

update public.tasks t
set assignee_user_id = src.user_id
from (
  select task_template_subtask_id as task_id, min(user_id) as user_id
  from public.task_template_subtask_assignees
  group by task_template_subtask_id
) src
where t.id = src.task_id
  and t.assignee_user_id is null;

insert into public.custom_fields (entity_type, entity_id, key, label, field_kind, position)
select
  'task' as entity_type,
  src.entity_id,
  src.key,
  src.label,
  src.field_kind,
  src.position
from public.custom_fields src
left join public.custom_fields dst
  on dst.entity_type = 'task'
 and dst.entity_id = src.entity_id
 and dst.key = src.key
where src.entity_type = 'task_template'
  and dst.id is null;

insert into public.custom_field_options (field_id, value, position)
select
  dst.id as field_id,
  opt.value,
  opt.position
from public.custom_fields src
join public.custom_fields dst
  on dst.entity_type = 'task'
 and dst.entity_id = src.entity_id
 and dst.key = src.key
join public.custom_field_options opt on opt.field_id = src.id
left join public.custom_field_options existing
  on existing.field_id = dst.id
 and lower(existing.value) = lower(opt.value)
where src.entity_type = 'task_template'
  and existing.field_id is null;

insert into public.custom_field_values (entity_type, entity_id, field_id, text_value, option_value)
select
  'task' as entity_type,
  src_values.entity_id,
  dst.id as field_id,
  src_values.text_value,
  src_values.option_value
from public.custom_field_values src_values
join public.custom_fields src
  on src.id = src_values.field_id
 and src.entity_type = 'task_template'
 and src_values.entity_type = 'task_template'
join public.custom_fields dst
  on dst.entity_type = 'task'
 and dst.entity_id = src_values.entity_id
 and dst.key = src.key
left join public.custom_field_values existing
  on existing.entity_type = 'task'
 and existing.entity_id = src_values.entity_id
 and existing.field_id = dst.id
where existing.field_id is null;

-- Also run sql/tasks_assigned_only_visibility.sql so template tasks are readable by authenticated users.
