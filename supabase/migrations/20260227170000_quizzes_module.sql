-- Quizzes module foundation with auto-marking and audit-safe versioning.

insert into public.page_permissions (key, label, nav_href, sort_order)
values ('quizzes', 'Quizzes', '/quizzes', 58)
on conflict (key) do update
set
  label = excluded.label,
  nav_href = excluded.nav_href,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_page_permissions (
  user_id,
  page_key,
  access_level,
  updated_by_user_id
)
select
  u.id,
  'quizzes',
  'edit',
  null::uuid
from public.users u
where u.role::text = 'member'
on conflict (user_id, page_key) do nothing;

insert into public.permission_definitions (key, label, description, scope_type)
values
  ('quizzes.manage', 'Quizzes Manage', 'Create, publish, and configure quizzes.', 'client'),
  ('quizzes.assign', 'Quizzes Assign', 'Assign quizzes to employees.', 'client'),
  ('quizzes.review', 'Quizzes Review', 'Review and score manual quiz responses.', 'client'),
  ('quizzes.view_reports', 'Quizzes View Reports', 'View quiz outcomes and analytics.', 'client'),
  ('quizzes.regrade', 'Quizzes Regrade', 'Regrade submitted quizzes using a new answer key.', 'client')
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  scope_type = excluded.scope_type,
  updated_at = now();

create table if not exists public.quiz_question_bank_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  prompt text not null,
  question_type text not null
    check (question_type in ('single_choice', 'multi_select', 'true_false', 'short_answer', 'scenario')),
  difficulty text
    check (difficulty in ('easy', 'medium', 'hard')),
  tags text[] not null default '{}'::text[],
  is_active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_question_bank_items_prompt_not_blank check (length(trim(prompt)) > 0)
);

create table if not exists public.quiz_question_bank_options (
  id uuid primary key default gen_random_uuid(),
  question_item_id uuid not null references public.quiz_question_bank_items(id) on delete cascade,
  option_text text not null,
  position integer not null default 1 check (position >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_question_bank_options_text_not_blank check (length(trim(option_text)) > 0),
  unique (question_item_id, position)
);

create table if not exists public.quiz_question_bank_answer_keys (
  id uuid primary key default gen_random_uuid(),
  question_item_id uuid not null references public.quiz_question_bank_items(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  scoring_mode text not null default 'all_or_nothing'
    check (scoring_mode in ('all_or_nothing', 'partial_credit')),
  correct_option_ids uuid[] not null default '{}'::uuid[],
  accepted_text_answers text[] not null default '{}'::text[],
  explanation text,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_item_id, version_number)
);

create unique index if not exists quiz_question_bank_answer_keys_active_unique
  on public.quiz_question_bank_answer_keys(question_item_id)
  where is_active;

create table if not exists public.quiz_definitions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  passing_score_percent numeric(5,2) not null default 70.00
    check (passing_score_percent >= 0 and passing_score_percent <= 100),
  max_attempts integer not null default 1 check (max_attempts >= 1),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds > 0),
  retake_cooldown_seconds integer not null default 0 check (retake_cooldown_seconds >= 0),
  feedback_mode text not null default 'after_submission'
    check (feedback_mode in ('none', 'after_each_question', 'after_submission')),
  multi_select_scoring_mode text not null default 'all_or_nothing'
    check (multi_select_scoring_mode in ('all_or_nothing', 'partial_credit')),
  randomize_question_order boolean not null default false,
  randomize_option_order boolean not null default true,
  allow_backtracking boolean not null default true,
  published_version_number integer not null default 0 check (published_version_number >= 0),
  published_at timestamptz,
  published_by_user_id uuid references public.users(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_definitions_title_not_blank check (length(trim(title)) > 0)
);

create table if not exists public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_definitions(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  lifecycle_status text not null default 'draft'
    check (lifecycle_status in ('draft', 'published', 'retired')),
  title text not null,
  description text,
  settings_json jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  published_by_user_id uuid references public.users(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_versions_title_not_blank check (length(trim(title)) > 0),
  unique (quiz_id, version_number)
);

create table if not exists public.quiz_version_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_version_id uuid not null references public.quiz_versions(id) on delete cascade,
  question_bank_item_id uuid references public.quiz_question_bank_items(id) on delete set null,
  position integer not null check (position >= 1),
  prompt text not null,
  question_type text not null
    check (question_type in ('single_choice', 'multi_select', 'true_false', 'short_answer', 'scenario')),
  points numeric(10,2) not null default 1.00 check (points >= 0),
  scoring_mode text not null default 'all_or_nothing'
    check (scoring_mode in ('all_or_nothing', 'partial_credit')),
  option_snapshot_json jsonb not null default '[]'::jsonb,
  answer_key_snapshot_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  manual_review_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_version_questions_prompt_not_blank check (length(trim(prompt)) > 0),
  unique (quiz_version_id, position)
);

create table if not exists public.quiz_answer_key_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_version_id uuid not null references public.quiz_versions(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  answer_key_snapshot_json jsonb not null default '{}'::jsonb,
  reason text,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_version_id, version_number)
);

create unique index if not exists quiz_answer_key_versions_active_unique
  on public.quiz_answer_key_versions(quiz_version_id)
  where is_active;

create table if not exists public.quiz_assignments (
  id uuid primary key default gen_random_uuid(),
  quiz_version_id uuid not null references public.quiz_versions(id) on delete cascade,
  assigned_user_id uuid not null references public.users(id) on delete cascade,
  assigned_by_user_id uuid references public.users(id) on delete set null,
  assignment_mode text not null default 'required'
    check (assignment_mode in ('required', 'optional')),
  available_from timestamptz,
  due_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_assignments_window_check check (expires_at is null or due_at is null or expires_at >= due_at),
  unique (quiz_version_id, assigned_user_id)
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.quiz_assignments(id) on delete set null,
  quiz_version_id uuid not null references public.quiz_versions(id),
  answer_key_version_id uuid references public.quiz_answer_key_versions(id),
  user_id uuid not null references public.users(id),
  attempt_number integer not null check (attempt_number >= 1),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'auto_scored', 'partially_scored', 'final_scored', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  auto_scored_at timestamptz,
  final_scored_at timestamptz,
  time_spent_seconds integer check (time_spent_seconds is null or time_spent_seconds >= 0),
  total_points numeric(10,2) not null default 0 check (total_points >= 0),
  earned_points numeric(10,2) not null default 0 check (earned_points >= 0 and earned_points <= total_points),
  score_percent numeric(5,2) check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  passed boolean,
  requires_manual_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_version_id, user_id, attempt_number)
);

create unique index if not exists quiz_attempts_assignment_attempt_unique
  on public.quiz_attempts(assignment_id, attempt_number)
  where assignment_id is not null;

create table if not exists public.quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  quiz_version_question_id uuid not null references public.quiz_version_questions(id),
  selected_option_ids uuid[] not null default '{}'::uuid[],
  answer_text text,
  answer_boolean boolean,
  auto_graded boolean not null default false,
  needs_manual_review boolean not null default false,
  is_correct boolean,
  points_possible numeric(10,2) not null default 0 check (points_possible >= 0),
  points_earned numeric(10,2) not null default 0 check (points_earned >= 0 and points_earned <= points_possible),
  feedback_text text,
  graded_by_user_id uuid references public.users(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, quiz_version_question_id)
);

create table if not exists public.quiz_manual_review_tasks (
  id uuid primary key default gen_random_uuid(),
  attempt_answer_id uuid not null references public.quiz_attempt_answers(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'completed')),
  assigned_reviewer_user_id uuid references public.users(id) on delete set null,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  review_notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_answer_id)
);

create table if not exists public.quiz_score_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  event_type text not null
    check (event_type in ('submission', 'auto_score', 'manual_score', 'regrade', 'override')),
  actor_user_id uuid references public.users(id) on delete set null,
  before_score_json jsonb not null default '{}'::jsonb,
  after_score_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_audit_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  quiz_id uuid references public.quiz_definitions(id) on delete set null,
  quiz_version_id uuid references public.quiz_versions(id) on delete set null,
  attempt_id uuid references public.quiz_attempts(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint quiz_audit_events_action_not_blank check (length(trim(action)) > 0)
);

create index if not exists quiz_question_bank_items_client_active_idx
  on public.quiz_question_bank_items(client_id, is_active, created_at desc);

create index if not exists quiz_question_bank_options_question_position_idx
  on public.quiz_question_bank_options(question_item_id, position);

create index if not exists quiz_question_bank_answer_keys_question_created_idx
  on public.quiz_question_bank_answer_keys(question_item_id, created_at desc);

create index if not exists quiz_definitions_client_status_idx
  on public.quiz_definitions(client_id, status, created_at desc);

create index if not exists quiz_versions_quiz_status_idx
  on public.quiz_versions(quiz_id, lifecycle_status, version_number desc);

create index if not exists quiz_version_questions_version_position_idx
  on public.quiz_version_questions(quiz_version_id, position);

create index if not exists quiz_answer_key_versions_version_created_idx
  on public.quiz_answer_key_versions(quiz_version_id, created_at desc);

create index if not exists quiz_assignments_user_due_idx
  on public.quiz_assignments(assigned_user_id, due_at, created_at desc);

create index if not exists quiz_assignments_version_due_idx
  on public.quiz_assignments(quiz_version_id, due_at);

create index if not exists quiz_attempts_user_status_started_idx
  on public.quiz_attempts(user_id, status, started_at desc);

create index if not exists quiz_attempts_version_user_idx
  on public.quiz_attempts(quiz_version_id, user_id, attempt_number desc);

create index if not exists quiz_attempt_answers_attempt_idx
  on public.quiz_attempt_answers(attempt_id, quiz_version_question_id);

create index if not exists quiz_attempt_answers_manual_review_idx
  on public.quiz_attempt_answers(needs_manual_review, auto_graded)
  where needs_manual_review;

create index if not exists quiz_manual_review_tasks_status_assignee_idx
  on public.quiz_manual_review_tasks(status, assigned_reviewer_user_id, created_at);

create index if not exists quiz_score_events_client_created_idx
  on public.quiz_score_events(client_id, created_at desc);

create index if not exists quiz_score_events_attempt_created_idx
  on public.quiz_score_events(attempt_id, created_at desc);

create index if not exists quiz_audit_events_client_created_idx
  on public.quiz_audit_events(client_id, created_at desc);

create index if not exists quiz_audit_events_quiz_created_idx
  on public.quiz_audit_events(quiz_id, created_at desc);

drop trigger if exists trg_quiz_question_bank_items_updated_at on public.quiz_question_bank_items;
create trigger trg_quiz_question_bank_items_updated_at
before update on public.quiz_question_bank_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_question_bank_options_updated_at on public.quiz_question_bank_options;
create trigger trg_quiz_question_bank_options_updated_at
before update on public.quiz_question_bank_options
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_question_bank_answer_keys_updated_at on public.quiz_question_bank_answer_keys;
create trigger trg_quiz_question_bank_answer_keys_updated_at
before update on public.quiz_question_bank_answer_keys
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_definitions_updated_at on public.quiz_definitions;
create trigger trg_quiz_definitions_updated_at
before update on public.quiz_definitions
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_versions_updated_at on public.quiz_versions;
create trigger trg_quiz_versions_updated_at
before update on public.quiz_versions
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_version_questions_updated_at on public.quiz_version_questions;
create trigger trg_quiz_version_questions_updated_at
before update on public.quiz_version_questions
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_answer_key_versions_updated_at on public.quiz_answer_key_versions;
create trigger trg_quiz_answer_key_versions_updated_at
before update on public.quiz_answer_key_versions
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_assignments_updated_at on public.quiz_assignments;
create trigger trg_quiz_assignments_updated_at
before update on public.quiz_assignments
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_attempts_updated_at on public.quiz_attempts;
create trigger trg_quiz_attempts_updated_at
before update on public.quiz_attempts
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_attempt_answers_updated_at on public.quiz_attempt_answers;
create trigger trg_quiz_attempt_answers_updated_at
before update on public.quiz_attempt_answers
for each row execute function public.set_updated_at();

drop trigger if exists trg_quiz_manual_review_tasks_updated_at on public.quiz_manual_review_tasks;
create trigger trg_quiz_manual_review_tasks_updated_at
before update on public.quiz_manual_review_tasks
for each row execute function public.set_updated_at();

create or replace function public.quiz_current_user_matches(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with me as (
    select auth.uid() as auth_uid, public.current_app_user_id() as app_uid
  )
  select auth.uid() is not null
    and p_user_id is not null
    and p_user_id in ((select auth_uid from me), (select app_uid from me));
$$;

create or replace function public.quiz_client_id_for_quiz(p_quiz_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select q.client_id
  from public.quiz_definitions q
  where q.id = p_quiz_id
  limit 1;
$$;

create or replace function public.quiz_client_id_for_version(p_quiz_version_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select q.client_id
  from public.quiz_versions v
  join public.quiz_definitions q on q.id = v.quiz_id
  where v.id = p_quiz_version_id
  limit 1;
$$;

create or replace function public.quiz_client_id_for_assignment(p_assignment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select q.client_id
  from public.quiz_assignments a
  join public.quiz_versions v on v.id = a.quiz_version_id
  join public.quiz_definitions q on q.id = v.quiz_id
  where a.id = p_assignment_id
  limit 1;
$$;

create or replace function public.quiz_client_id_for_attempt(p_attempt_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select q.client_id
  from public.quiz_attempts a
  join public.quiz_versions v on v.id = a.quiz_version_id
  join public.quiz_definitions q on q.id = v.quiz_id
  where a.id = p_attempt_id
  limit 1;
$$;

create or replace function public.quiz_client_id_for_attempt_answer(p_attempt_answer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select q.client_id
  from public.quiz_attempt_answers aa
  join public.quiz_attempts a on a.id = aa.attempt_id
  join public.quiz_versions v on v.id = a.quiz_version_id
  join public.quiz_definitions q on q.id = v.quiz_id
  where aa.id = p_attempt_answer_id
  limit 1;
$$;

create or replace function public.quiz_can_view_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_view_page('quizzes')
    and public.can_access_client(client_uuid);
$$;

create or replace function public.quiz_can_manage_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('quizzes.manage', 'client', client_uuid)
    );
$$;

create or replace function public.quiz_can_assign_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('quizzes.assign', 'client', client_uuid)
      or public.has_permission('quizzes.manage', 'client', client_uuid)
    );
$$;

create or replace function public.quiz_can_review_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('quizzes.review', 'client', client_uuid)
      or public.has_permission('quizzes.manage', 'client', client_uuid)
    );
$$;

create or replace function public.quiz_can_view_reports_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.quiz_can_view_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('quizzes.view_reports', 'client', client_uuid)
      or public.has_permission('quizzes.review', 'client', client_uuid)
      or public.has_permission('quizzes.manage', 'client', client_uuid)
    );
$$;

create or replace function public.quiz_can_regrade_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes')
    and public.can_access_client(client_uuid)
    and (
      public.is_admin()
      or public.has_permission('quizzes.regrade', 'client', client_uuid)
      or public.has_permission('quizzes.manage', 'client', client_uuid)
    );
$$;

create or replace function public.quiz_can_view_quiz(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(public.quiz_can_view_client(public.quiz_client_id_for_quiz(p_quiz_id)), false);
$$;

create or replace function public.quiz_can_manage_quiz(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(public.quiz_can_manage_client(public.quiz_client_id_for_quiz(p_quiz_id)), false);
$$;

create or replace function public.quiz_can_view_version(p_quiz_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(public.quiz_can_view_client(public.quiz_client_id_for_version(p_quiz_version_id)), false);
$$;

create or replace function public.quiz_can_manage_version(p_quiz_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(public.quiz_can_manage_client(public.quiz_client_id_for_version(p_quiz_version_id)), false);
$$;

create or replace function public.quiz_can_assign_version(p_quiz_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(public.quiz_can_assign_client(public.quiz_client_id_for_version(p_quiz_version_id)), false);
$$;

create or replace function public.quiz_can_take_version(p_quiz_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with version_row as (
    select
      q.client_id,
      v.lifecycle_status
    from public.quiz_versions v
    join public.quiz_definitions q on q.id = v.quiz_id
    where v.id = p_quiz_version_id
  )
  select auth.uid() is not null
    and public.can_view_page('quizzes')
    and exists (
      select 1
      from version_row vr
      where public.quiz_can_view_client(vr.client_id)
        and (
          vr.lifecycle_status = 'published'
          or public.quiz_can_manage_client(vr.client_id)
        )
    );
$$;

create or replace function public.quiz_can_access_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with assignment_row as (
    select
      a.assigned_user_id,
      q.client_id
    from public.quiz_assignments a
    join public.quiz_versions v on v.id = a.quiz_version_id
    join public.quiz_definitions q on q.id = v.quiz_id
    where a.id = p_assignment_id
  )
  select auth.uid() is not null
    and exists (
      select 1
      from assignment_row r
      where public.quiz_current_user_matches(r.assigned_user_id)
        or public.quiz_can_assign_client(r.client_id)
        or public.quiz_can_view_reports_client(r.client_id)
        or public.quiz_can_manage_client(r.client_id)
    );
$$;

create or replace function public.quiz_can_view_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with attempt_row as (
    select
      a.user_id,
      q.client_id
    from public.quiz_attempts a
    join public.quiz_versions v on v.id = a.quiz_version_id
    join public.quiz_definitions q on q.id = v.quiz_id
    where a.id = p_attempt_id
  )
  select auth.uid() is not null
    and exists (
      select 1
      from attempt_row r
      where public.quiz_current_user_matches(r.user_id)
        or public.quiz_can_review_client(r.client_id)
        or public.quiz_can_view_reports_client(r.client_id)
        or public.quiz_can_manage_client(r.client_id)
    );
$$;

create or replace function public.quiz_can_manage_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  with attempt_row as (
    select
      a.user_id,
      q.client_id
    from public.quiz_attempts a
    join public.quiz_versions v on v.id = a.quiz_version_id
    join public.quiz_definitions q on q.id = v.quiz_id
    where a.id = p_attempt_id
  )
  select auth.uid() is not null
    and exists (
      select 1
      from attempt_row r
      where (public.quiz_current_user_matches(r.user_id) and public.can_edit_page('quizzes'))
        or public.quiz_can_review_client(r.client_id)
        or public.quiz_can_manage_client(r.client_id)
    );
$$;

create or replace function public.quiz_can_review_attempt_answer(p_attempt_answer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and (
      public.quiz_can_review_client(public.quiz_client_id_for_attempt_answer(p_attempt_answer_id))
      or public.quiz_can_manage_client(public.quiz_client_id_for_attempt_answer(p_attempt_answer_id))
    );
$$;

create or replace function public.quiz_log_audit_event(
  p_quiz_id uuid,
  p_quiz_version_id uuid,
  p_attempt_id uuid,
  p_action text,
  p_before_json jsonb default '{}'::jsonb,
  p_after_json jsonb default '{}'::jsonb,
  p_metadata_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  target_client_id uuid;
begin
  if length(trim(coalesce(p_action, ''))) = 0 then
    raise exception 'Action is required';
  end if;

  select q.client_id
  into target_client_id
  from public.quiz_definitions q
  where q.id = p_quiz_id
  limit 1;

  if target_client_id is null then
    raise exception 'Quiz not found';
  end if;

  insert into public.quiz_audit_events (
    client_id,
    quiz_id,
    quiz_version_id,
    attempt_id,
    actor_user_id,
    action,
    before_json,
    after_json,
    metadata_json
  )
  values (
    target_client_id,
    p_quiz_id,
    p_quiz_version_id,
    p_attempt_id,
    actor_id,
    trim(p_action),
    coalesce(p_before_json, '{}'::jsonb),
    coalesce(p_after_json, '{}'::jsonb),
    coalesce(p_metadata_json, '{}'::jsonb)
  );
end;
$$;

create or replace function public.quiz_log_score_event(
  p_attempt_id uuid,
  p_event_type text,
  p_before_score_json jsonb default '{}'::jsonb,
  p_after_score_json jsonb default '{}'::jsonb,
  p_metadata_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  target_client_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
begin
  if normalized_event_type not in ('submission', 'auto_score', 'manual_score', 'regrade', 'override') then
    raise exception 'Invalid score event type';
  end if;

  select q.client_id
  into target_client_id
  from public.quiz_attempts a
  join public.quiz_versions v on v.id = a.quiz_version_id
  join public.quiz_definitions q on q.id = v.quiz_id
  where a.id = p_attempt_id
  limit 1;

  if target_client_id is null then
    raise exception 'Attempt not found';
  end if;

  insert into public.quiz_score_events (
    client_id,
    attempt_id,
    event_type,
    actor_user_id,
    before_score_json,
    after_score_json,
    metadata_json
  )
  values (
    target_client_id,
    p_attempt_id,
    normalized_event_type,
    actor_id,
    coalesce(p_before_score_json, '{}'::jsonb),
    coalesce(p_after_score_json, '{}'::jsonb),
    coalesce(p_metadata_json, '{}'::jsonb)
  );
end;
$$;

alter table public.quiz_question_bank_items enable row level security;
alter table public.quiz_question_bank_options enable row level security;
alter table public.quiz_question_bank_answer_keys enable row level security;
alter table public.quiz_definitions enable row level security;
alter table public.quiz_versions enable row level security;
alter table public.quiz_version_questions enable row level security;
alter table public.quiz_answer_key_versions enable row level security;
alter table public.quiz_assignments enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_answers enable row level security;
alter table public.quiz_manual_review_tasks enable row level security;
alter table public.quiz_score_events enable row level security;
alter table public.quiz_audit_events enable row level security;

drop policy if exists quiz_question_bank_items_select on public.quiz_question_bank_items;
create policy quiz_question_bank_items_select
  on public.quiz_question_bank_items
  for select
  to authenticated
  using (public.quiz_can_view_client(client_id));

drop policy if exists quiz_question_bank_items_insert on public.quiz_question_bank_items;
create policy quiz_question_bank_items_insert
  on public.quiz_question_bank_items
  for insert
  to authenticated
  with check (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_question_bank_items_update on public.quiz_question_bank_items;
create policy quiz_question_bank_items_update
  on public.quiz_question_bank_items
  for update
  to authenticated
  using (public.quiz_can_manage_client(client_id))
  with check (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_question_bank_items_delete on public.quiz_question_bank_items;
create policy quiz_question_bank_items_delete
  on public.quiz_question_bank_items
  for delete
  to authenticated
  using (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_question_bank_options_select on public.quiz_question_bank_options;
create policy quiz_question_bank_options_select
  on public.quiz_question_bank_options
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_options.question_item_id
        and public.quiz_can_view_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_options_insert on public.quiz_question_bank_options;
create policy quiz_question_bank_options_insert
  on public.quiz_question_bank_options
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_options.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_options_update on public.quiz_question_bank_options;
create policy quiz_question_bank_options_update
  on public.quiz_question_bank_options
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_options.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  )
  with check (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_options.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_options_delete on public.quiz_question_bank_options;
create policy quiz_question_bank_options_delete
  on public.quiz_question_bank_options
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_options.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_answer_keys_select on public.quiz_question_bank_answer_keys;
create policy quiz_question_bank_answer_keys_select
  on public.quiz_question_bank_answer_keys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_answer_keys.question_item_id
        and public.quiz_can_view_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_answer_keys_insert on public.quiz_question_bank_answer_keys;
create policy quiz_question_bank_answer_keys_insert
  on public.quiz_question_bank_answer_keys
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_answer_keys.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_answer_keys_update on public.quiz_question_bank_answer_keys;
create policy quiz_question_bank_answer_keys_update
  on public.quiz_question_bank_answer_keys
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_answer_keys.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  )
  with check (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_answer_keys.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_question_bank_answer_keys_delete on public.quiz_question_bank_answer_keys;
create policy quiz_question_bank_answer_keys_delete
  on public.quiz_question_bank_answer_keys
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_question_bank_items q
      where q.id = quiz_question_bank_answer_keys.question_item_id
        and public.quiz_can_manage_client(q.client_id)
    )
  );

drop policy if exists quiz_definitions_select on public.quiz_definitions;
create policy quiz_definitions_select
  on public.quiz_definitions
  for select
  to authenticated
  using (public.quiz_can_view_client(client_id));

drop policy if exists quiz_definitions_insert on public.quiz_definitions;
create policy quiz_definitions_insert
  on public.quiz_definitions
  for insert
  to authenticated
  with check (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_definitions_update on public.quiz_definitions;
create policy quiz_definitions_update
  on public.quiz_definitions
  for update
  to authenticated
  using (public.quiz_can_manage_client(client_id))
  with check (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_definitions_delete on public.quiz_definitions;
create policy quiz_definitions_delete
  on public.quiz_definitions
  for delete
  to authenticated
  using (public.quiz_can_manage_client(client_id));

drop policy if exists quiz_versions_select on public.quiz_versions;
create policy quiz_versions_select
  on public.quiz_versions
  for select
  to authenticated
  using (public.quiz_can_view_version(id));

drop policy if exists quiz_versions_insert on public.quiz_versions;
create policy quiz_versions_insert
  on public.quiz_versions
  for insert
  to authenticated
  with check (public.quiz_can_manage_quiz(quiz_id));

drop policy if exists quiz_versions_update on public.quiz_versions;
create policy quiz_versions_update
  on public.quiz_versions
  for update
  to authenticated
  using (public.quiz_can_manage_quiz(quiz_id))
  with check (public.quiz_can_manage_quiz(quiz_id));

drop policy if exists quiz_versions_delete on public.quiz_versions;
create policy quiz_versions_delete
  on public.quiz_versions
  for delete
  to authenticated
  using (public.quiz_can_manage_quiz(quiz_id));

drop policy if exists quiz_version_questions_select on public.quiz_version_questions;
create policy quiz_version_questions_select
  on public.quiz_version_questions
  for select
  to authenticated
  using (public.quiz_can_view_version(quiz_version_id));

drop policy if exists quiz_version_questions_insert on public.quiz_version_questions;
create policy quiz_version_questions_insert
  on public.quiz_version_questions
  for insert
  to authenticated
  with check (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_version_questions_update on public.quiz_version_questions;
create policy quiz_version_questions_update
  on public.quiz_version_questions
  for update
  to authenticated
  using (public.quiz_can_manage_version(quiz_version_id))
  with check (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_version_questions_delete on public.quiz_version_questions;
create policy quiz_version_questions_delete
  on public.quiz_version_questions
  for delete
  to authenticated
  using (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_answer_key_versions_select on public.quiz_answer_key_versions;
create policy quiz_answer_key_versions_select
  on public.quiz_answer_key_versions
  for select
  to authenticated
  using (public.quiz_can_view_version(quiz_version_id));

drop policy if exists quiz_answer_key_versions_insert on public.quiz_answer_key_versions;
create policy quiz_answer_key_versions_insert
  on public.quiz_answer_key_versions
  for insert
  to authenticated
  with check (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_answer_key_versions_update on public.quiz_answer_key_versions;
create policy quiz_answer_key_versions_update
  on public.quiz_answer_key_versions
  for update
  to authenticated
  using (public.quiz_can_manage_version(quiz_version_id))
  with check (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_answer_key_versions_delete on public.quiz_answer_key_versions;
create policy quiz_answer_key_versions_delete
  on public.quiz_answer_key_versions
  for delete
  to authenticated
  using (public.quiz_can_manage_version(quiz_version_id));

drop policy if exists quiz_assignments_select on public.quiz_assignments;
create policy quiz_assignments_select
  on public.quiz_assignments
  for select
  to authenticated
  using (public.quiz_can_access_assignment(id));

drop policy if exists quiz_assignments_insert on public.quiz_assignments;
create policy quiz_assignments_insert
  on public.quiz_assignments
  for insert
  to authenticated
  with check (public.quiz_can_assign_version(quiz_version_id));

drop policy if exists quiz_assignments_update on public.quiz_assignments;
create policy quiz_assignments_update
  on public.quiz_assignments
  for update
  to authenticated
  using (public.quiz_can_assign_version(quiz_version_id))
  with check (public.quiz_can_assign_version(quiz_version_id));

drop policy if exists quiz_assignments_delete on public.quiz_assignments;
create policy quiz_assignments_delete
  on public.quiz_assignments
  for delete
  to authenticated
  using (public.quiz_can_assign_version(quiz_version_id));

drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select
  on public.quiz_attempts
  for select
  to authenticated
  using (public.quiz_can_view_attempt(id));

drop policy if exists quiz_attempts_insert on public.quiz_attempts;
create policy quiz_attempts_insert
  on public.quiz_attempts
  for insert
  to authenticated
  with check (
    public.quiz_current_user_matches(user_id)
    and public.quiz_can_take_version(quiz_version_id)
    and (
      assignment_id is null
      or exists (
        select 1
        from public.quiz_assignments a
        where a.id = quiz_attempts.assignment_id
          and a.quiz_version_id = quiz_attempts.quiz_version_id
          and (
            a.assigned_user_id = quiz_attempts.user_id
            or public.quiz_can_assign_version(a.quiz_version_id)
          )
      )
    )
  );

drop policy if exists quiz_attempts_update on public.quiz_attempts;
create policy quiz_attempts_update
  on public.quiz_attempts
  for update
  to authenticated
  using (public.quiz_can_manage_attempt(id))
  with check (public.quiz_can_manage_attempt(id));

drop policy if exists quiz_attempts_delete_block on public.quiz_attempts;
create policy quiz_attempts_delete_block
  on public.quiz_attempts
  for delete
  to authenticated
  using (false);

drop policy if exists quiz_attempt_answers_select on public.quiz_attempt_answers;
create policy quiz_attempt_answers_select
  on public.quiz_attempt_answers
  for select
  to authenticated
  using (public.quiz_can_view_attempt(attempt_id));

drop policy if exists quiz_attempt_answers_insert on public.quiz_attempt_answers;
create policy quiz_attempt_answers_insert
  on public.quiz_attempt_answers
  for insert
  to authenticated
  with check (
    public.quiz_can_manage_attempt(attempt_id)
    and exists (
      select 1
      from public.quiz_attempts a
      join public.quiz_version_questions q on q.quiz_version_id = a.quiz_version_id
      where a.id = quiz_attempt_answers.attempt_id
        and q.id = quiz_attempt_answers.quiz_version_question_id
    )
  );

drop policy if exists quiz_attempt_answers_update on public.quiz_attempt_answers;
create policy quiz_attempt_answers_update
  on public.quiz_attempt_answers
  for update
  to authenticated
  using (public.quiz_can_manage_attempt(attempt_id))
  with check (
    public.quiz_can_manage_attempt(attempt_id)
    and exists (
      select 1
      from public.quiz_attempts a
      join public.quiz_version_questions q on q.quiz_version_id = a.quiz_version_id
      where a.id = quiz_attempt_answers.attempt_id
        and q.id = quiz_attempt_answers.quiz_version_question_id
    )
  );

drop policy if exists quiz_attempt_answers_delete_block on public.quiz_attempt_answers;
create policy quiz_attempt_answers_delete_block
  on public.quiz_attempt_answers
  for delete
  to authenticated
  using (false);

drop policy if exists quiz_manual_review_tasks_select on public.quiz_manual_review_tasks;
create policy quiz_manual_review_tasks_select
  on public.quiz_manual_review_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempt_answers aa
      where aa.id = quiz_manual_review_tasks.attempt_answer_id
        and (
          public.quiz_can_review_attempt_answer(aa.id)
          or public.quiz_can_view_reports_client(public.quiz_client_id_for_attempt_answer(aa.id))
        )
    )
  );

drop policy if exists quiz_manual_review_tasks_insert on public.quiz_manual_review_tasks;
create policy quiz_manual_review_tasks_insert
  on public.quiz_manual_review_tasks
  for insert
  to authenticated
  with check (public.quiz_can_review_attempt_answer(attempt_answer_id));

drop policy if exists quiz_manual_review_tasks_update on public.quiz_manual_review_tasks;
create policy quiz_manual_review_tasks_update
  on public.quiz_manual_review_tasks
  for update
  to authenticated
  using (public.quiz_can_review_attempt_answer(attempt_answer_id))
  with check (public.quiz_can_review_attempt_answer(attempt_answer_id));

drop policy if exists quiz_manual_review_tasks_delete on public.quiz_manual_review_tasks;
create policy quiz_manual_review_tasks_delete
  on public.quiz_manual_review_tasks
  for delete
  to authenticated
  using (public.quiz_can_review_attempt_answer(attempt_answer_id));

drop policy if exists quiz_score_events_select on public.quiz_score_events;
create policy quiz_score_events_select
  on public.quiz_score_events
  for select
  to authenticated
  using (
    public.quiz_can_view_attempt(attempt_id)
    or public.quiz_can_view_reports_client(client_id)
  );

drop policy if exists quiz_score_events_insert_block on public.quiz_score_events;
create policy quiz_score_events_insert_block
  on public.quiz_score_events
  for insert
  to authenticated
  with check (false);

drop policy if exists quiz_score_events_update_block on public.quiz_score_events;
create policy quiz_score_events_update_block
  on public.quiz_score_events
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists quiz_score_events_delete_block on public.quiz_score_events;
create policy quiz_score_events_delete_block
  on public.quiz_score_events
  for delete
  to authenticated
  using (false);

drop policy if exists quiz_audit_events_select on public.quiz_audit_events;
create policy quiz_audit_events_select
  on public.quiz_audit_events
  for select
  to authenticated
  using (public.quiz_can_view_reports_client(client_id));

drop policy if exists quiz_audit_events_insert_block on public.quiz_audit_events;
create policy quiz_audit_events_insert_block
  on public.quiz_audit_events
  for insert
  to authenticated
  with check (false);

drop policy if exists quiz_audit_events_update_block on public.quiz_audit_events;
create policy quiz_audit_events_update_block
  on public.quiz_audit_events
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists quiz_audit_events_delete_block on public.quiz_audit_events;
create policy quiz_audit_events_delete_block
  on public.quiz_audit_events
  for delete
  to authenticated
  using (false);

grant select, insert, update, delete on public.quiz_question_bank_items to authenticated;
grant select, insert, update, delete on public.quiz_question_bank_options to authenticated;
grant select, insert, update, delete on public.quiz_question_bank_answer_keys to authenticated;
grant select, insert, update, delete on public.quiz_definitions to authenticated;
grant select, insert, update, delete on public.quiz_versions to authenticated;
grant select, insert, update, delete on public.quiz_version_questions to authenticated;
grant select, insert, update, delete on public.quiz_answer_key_versions to authenticated;
grant select, insert, update, delete on public.quiz_assignments to authenticated;
grant select, insert, update, delete on public.quiz_attempts to authenticated;
grant select, insert, update, delete on public.quiz_attempt_answers to authenticated;
grant select, insert, update, delete on public.quiz_manual_review_tasks to authenticated;
grant select on public.quiz_score_events to authenticated;
grant select on public.quiz_audit_events to authenticated;

grant execute on function public.quiz_current_user_matches(uuid) to anon, authenticated;
grant execute on function public.quiz_client_id_for_quiz(uuid) to anon, authenticated;
grant execute on function public.quiz_client_id_for_version(uuid) to anon, authenticated;
grant execute on function public.quiz_client_id_for_assignment(uuid) to anon, authenticated;
grant execute on function public.quiz_client_id_for_attempt(uuid) to anon, authenticated;
grant execute on function public.quiz_client_id_for_attempt_answer(uuid) to anon, authenticated;
grant execute on function public.quiz_can_view_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_manage_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_assign_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_review_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_view_reports_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_regrade_client(uuid) to anon, authenticated;
grant execute on function public.quiz_can_view_quiz(uuid) to anon, authenticated;
grant execute on function public.quiz_can_manage_quiz(uuid) to anon, authenticated;
grant execute on function public.quiz_can_view_version(uuid) to anon, authenticated;
grant execute on function public.quiz_can_manage_version(uuid) to anon, authenticated;
grant execute on function public.quiz_can_assign_version(uuid) to anon, authenticated;
grant execute on function public.quiz_can_take_version(uuid) to anon, authenticated;
grant execute on function public.quiz_can_access_assignment(uuid) to anon, authenticated;
grant execute on function public.quiz_can_view_attempt(uuid) to anon, authenticated;
grant execute on function public.quiz_can_manage_attempt(uuid) to anon, authenticated;
grant execute on function public.quiz_can_review_attempt_answer(uuid) to anon, authenticated;
grant execute on function public.quiz_log_audit_event(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.quiz_log_score_event(uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;
