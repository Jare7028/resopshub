-- Debug helper for persistent "new row violates row-level security policy for table tasks".
-- Run in Supabase SQL editor and share the results.

-- 1) Active INSERT policies on tasks (this shows what your live DB is actually enforcing).
select
  polname,
  polcmd,
  polpermissive,
  pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
where polrelid = 'public.tasks'::regclass
  and polcmd = 'a'
order by polname;

-- 2) Current access helper definitions used by task RLS.
select
  p.proname,
  p.oid::regprocedure::text as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('can_access_task', 'can_access_task_base', 'current_app_user_id')
order by p.proname;

-- 3) Templates that do not have mirrored rows in tasks.
select count(*) as templates_missing_task_mirror
from public.task_templates tt
left join public.tasks t on t.id = tt.id
where t.id is null;

-- 4) Subtask templates whose parent task_template is missing a mirrored task row.
select count(*) as subtask_templates_with_unmirrored_parent
from public.task_template_subtasks ts
left join public.tasks parent_task on parent_task.id = ts.task_template_id
where parent_task.id is null;

