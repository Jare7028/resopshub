-- Decouple quizzes from client scoping. Quizzes can now be created and managed without a client.

alter table public.quiz_definitions
  alter column client_id drop not null;

alter table public.quiz_score_events
  alter column client_id drop not null;

alter table public.quiz_audit_events
  alter column client_id drop not null;

create or replace function public.quiz_can_view_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_view_page('quizzes');
$$;

create or replace function public.quiz_can_manage_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes');
$$;

create or replace function public.quiz_can_assign_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes');
$$;

create or replace function public.quiz_can_review_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes');
$$;

create or replace function public.quiz_can_view_reports_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes');
$$;

create or replace function public.quiz_can_regrade_client(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null
    and public.can_edit_page('quizzes');
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

  if not found then
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

  if not found then
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

create or replace function public.quiz_create_definition_with_version(
  p_client_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_passing_score_percent numeric default 70,
  p_max_attempts integer default 1,
  p_time_limit_seconds integer default null,
  p_multi_select_scoring_mode text default 'all_or_nothing'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  normalized_title text := trim(coalesce(p_title, ''));
  normalized_description text := nullif(trim(coalesce(p_description, '')), '');
  normalized_multi_select_mode text := lower(trim(coalesce(p_multi_select_scoring_mode, 'all_or_nothing')));
  created_quiz_id uuid;
  created_version_id uuid;
  now_utc timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if not public.can_edit_page('quizzes') then
    raise exception 'Not authorized to manage quizzes';
  end if;

  if normalized_title = '' then
    raise exception 'Quiz title is required';
  end if;

  if p_passing_score_percent < 0 or p_passing_score_percent > 100 then
    raise exception 'passing_score_percent must be between 0 and 100';
  end if;

  if p_max_attempts < 1 then
    raise exception 'max_attempts must be at least 1';
  end if;

  if p_time_limit_seconds is not null and p_time_limit_seconds <= 0 then
    raise exception 'time_limit_seconds must be positive when provided';
  end if;

  if normalized_multi_select_mode not in ('all_or_nothing', 'partial_credit') then
    raise exception 'Invalid multi_select_scoring_mode';
  end if;

  insert into public.quiz_definitions (
    client_id,
    title,
    description,
    status,
    passing_score_percent,
    max_attempts,
    time_limit_seconds,
    multi_select_scoring_mode,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  )
  values (
    p_client_id,
    normalized_title,
    normalized_description,
    'draft',
    p_passing_score_percent,
    p_max_attempts,
    p_time_limit_seconds,
    normalized_multi_select_mode,
    actor_id,
    actor_id,
    now_utc,
    now_utc
  )
  returning id into created_quiz_id;

  insert into public.quiz_versions (
    quiz_id,
    version_number,
    lifecycle_status,
    title,
    description,
    settings_json,
    created_by_user_id,
    created_at,
    updated_at
  )
  values (
    created_quiz_id,
    1,
    'draft',
    normalized_title,
    normalized_description,
    jsonb_build_object(
      'passing_score_percent', p_passing_score_percent,
      'max_attempts', p_max_attempts,
      'time_limit_seconds', p_time_limit_seconds,
      'multi_select_scoring_mode', normalized_multi_select_mode
    ),
    actor_id,
    now_utc,
    now_utc
  )
  returning id into created_version_id;

  perform public.quiz_log_audit_event(
    created_quiz_id,
    created_version_id,
    null,
    'quiz.created',
    '{}'::jsonb,
    jsonb_build_object(
      'title', normalized_title,
      'quiz_version_id', created_version_id
    ),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'quiz_id', created_quiz_id,
    'quiz_version_id', created_version_id
  );
end;
$$;

grant execute on function public.quiz_create_definition_with_version(uuid, text, text, numeric, integer, integer, text) to anon, authenticated;
