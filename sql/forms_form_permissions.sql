-- Per-form user access assignments (view/edit).
-- Run after:
--   sql/forms.sql
--   sql/forms_templates_assignment_security.sql

create table if not exists public.form_user_permissions (
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  access_level text not null default 'view',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (form_id, user_id),
  constraint form_user_permissions_access_level_check
    check (access_level in ('view', 'edit'))
);

drop trigger if exists trg_form_user_permissions_updated_at on public.form_user_permissions;
create trigger trg_form_user_permissions_updated_at
before update on public.form_user_permissions
for each row execute function public.set_updated_at();

create index if not exists idx_form_user_permissions_user_access_form
  on public.form_user_permissions(user_id, access_level, form_id);

create index if not exists idx_form_user_permissions_form_access_user
  on public.form_user_permissions(form_id, access_level, user_id);

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
        or exists (
          select 1
          from public.form_user_permissions fup
          where fup.form_id = f.id
            and fup.user_id in ((select auth_uid from me), (select app_uid from me))
            and fup.access_level = 'edit'
        )
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
          from public.form_user_permissions fup
          where fup.form_id = f.id
            and fup.user_id in ((select auth_uid from me), (select app_uid from me))
            and fup.access_level in ('view', 'edit')
        )
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

grant execute on function public.can_manage_form(uuid) to authenticated;
grant execute on function public.can_access_form(uuid) to authenticated;

alter table public.form_user_permissions enable row level security;

drop policy if exists form_user_permissions_select on public.form_user_permissions;
create policy form_user_permissions_select
  on public.form_user_permissions
  for select
  to authenticated
  using (
    public.can_manage_form(form_id)
    or user_id in (auth.uid(), public.current_app_user_id())
  );

drop policy if exists form_user_permissions_insert on public.form_user_permissions;
create policy form_user_permissions_insert
  on public.form_user_permissions
  for insert
  to authenticated
  with check (public.can_manage_form(form_id));

drop policy if exists form_user_permissions_update on public.form_user_permissions;
create policy form_user_permissions_update
  on public.form_user_permissions
  for update
  to authenticated
  using (public.can_manage_form(form_id))
  with check (public.can_manage_form(form_id));

drop policy if exists form_user_permissions_delete on public.form_user_permissions;
create policy form_user_permissions_delete
  on public.form_user_permissions
  for delete
  to authenticated
  using (public.can_manage_form(form_id));

grant select, insert, update, delete on table public.form_user_permissions to authenticated;
