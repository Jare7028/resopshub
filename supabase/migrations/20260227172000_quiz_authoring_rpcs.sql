-- Quiz authoring and assignment RPCs.

create or replace function public.quiz_create_definition_with_version(
  p_client_id uuid,
  p_title text,
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

  if p_client_id is null then
    raise exception 'client_id is required';
  end if;

  if not public.quiz_can_manage_client(p_client_id) then
    raise exception 'Not authorized to manage quizzes for this client';
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
      'client_id', p_client_id,
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

create or replace function public.quiz_add_version_question(
  p_quiz_version_id uuid,
  p_prompt text,
  p_question_type text,
  p_points numeric default 1,
  p_scoring_mode text default 'all_or_nothing',
  p_option_labels text[] default '{}'::text[],
  p_correct_option_positions integer[] default '{}'::integer[],
  p_correct_boolean boolean default null,
  p_accepted_text_answers text[] default '{}'::text[],
  p_manual_review_required boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  normalized_prompt text := trim(coalesce(p_prompt, ''));
  normalized_question_type text := lower(trim(coalesce(p_question_type, '')));
  normalized_scoring_mode text := lower(trim(coalesce(p_scoring_mode, 'all_or_nothing')));
  clean_option_labels text[] := '{}'::text[];
  clean_accepted_text_answers text[] := '{}'::text[];
  correct_positions integer[] := coalesce(p_correct_option_positions, '{}'::integer[]);
  option_snapshot_json jsonb := '[]'::jsonb;
  answer_key_snapshot_json jsonb := '{}'::jsonb;
  correct_option_ids uuid[] := '{}'::uuid[];
  next_position integer := 1;
  option_idx integer := 0;
  option_label text;
  option_id uuid;
  true_option_id uuid;
  false_option_id uuid;
  created_question_id uuid;
  manual_review_required boolean := false;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_quiz_version_id is null then
    raise exception 'quiz_version_id is required';
  end if;

  if normalized_prompt = '' then
    raise exception 'Question prompt is required';
  end if;

  if normalized_question_type not in ('single_choice', 'multi_select', 'true_false', 'short_answer', 'scenario') then
    raise exception 'Invalid question_type';
  end if;

  if p_points < 0 then
    raise exception 'points must be non-negative';
  end if;

  if normalized_scoring_mode not in ('all_or_nothing', 'partial_credit') then
    normalized_scoring_mode := 'all_or_nothing';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = p_quiz_version_id
  limit 1;

  if version_row.id is null then
    raise exception 'Quiz version not found';
  end if;

  select *
  into quiz_row
  from public.quiz_definitions
  where id = version_row.quiz_id
  limit 1;

  if quiz_row.id is null then
    raise exception 'Quiz not found';
  end if;

  if not public.quiz_can_manage_client(quiz_row.client_id) then
    raise exception 'Not authorized to manage this quiz version';
  end if;

  select coalesce(max(position), 0) + 1
  into next_position
  from public.quiz_version_questions
  where quiz_version_id = p_quiz_version_id;

  foreach option_label in array coalesce(p_option_labels, '{}'::text[])
  loop
    option_label := trim(coalesce(option_label, ''));
    if option_label <> '' then
      clean_option_labels := array_append(clean_option_labels, option_label);
    end if;
  end loop;

  select coalesce(array_agg(distinct lower(trim(answer_text))), '{}'::text[])
  into clean_accepted_text_answers
  from unnest(coalesce(p_accepted_text_answers, '{}'::text[])) as answer_text
  where length(trim(answer_text)) > 0;

  if normalized_question_type in ('single_choice', 'multi_select') then
    if cardinality(clean_option_labels) < 2 then
      raise exception 'At least 2 options are required for choice questions';
    end if;

    option_idx := 1;
    while option_idx <= cardinality(clean_option_labels) loop
      option_id := gen_random_uuid();
      option_snapshot_json := option_snapshot_json || jsonb_build_array(
        jsonb_build_object(
          'id', option_id,
          'label', clean_option_labels[option_idx],
          'position', option_idx
        )
      );

      if option_idx = any(correct_positions) then
        correct_option_ids := array_append(correct_option_ids, option_id);
      end if;
      option_idx := option_idx + 1;
    end loop;

    if normalized_question_type = 'single_choice' and cardinality(correct_option_ids) <> 1 then
      raise exception 'Single-choice questions require exactly one correct option';
    end if;

    if normalized_question_type = 'multi_select' and cardinality(correct_option_ids) = 0 then
      raise exception 'Multi-select questions require at least one correct option';
    end if;

    answer_key_snapshot_json := jsonb_build_object(
      'scoring_mode', normalized_scoring_mode,
      'correct_option_ids', to_jsonb(correct_option_ids),
      'accepted_text_answers', '[]'::jsonb
    );
    manual_review_required := false;
  elsif normalized_question_type = 'true_false' then
    if p_correct_boolean is null then
      raise exception 'true_false questions require correct_boolean';
    end if;

    true_option_id := gen_random_uuid();
    false_option_id := gen_random_uuid();
    option_snapshot_json := jsonb_build_array(
      jsonb_build_object('id', true_option_id, 'label', 'True', 'position', 1),
      jsonb_build_object('id', false_option_id, 'label', 'False', 'position', 2)
    );

    correct_option_ids := case when p_correct_boolean then array[true_option_id] else array[false_option_id] end;

    answer_key_snapshot_json := jsonb_build_object(
      'scoring_mode', 'all_or_nothing',
      'correct_boolean', p_correct_boolean,
      'correct_option_ids', to_jsonb(correct_option_ids),
      'accepted_text_answers', '[]'::jsonb
    );
    manual_review_required := false;
  else
    answer_key_snapshot_json := jsonb_build_object(
      'scoring_mode', normalized_scoring_mode,
      'correct_option_ids', '[]'::jsonb,
      'accepted_text_answers', to_jsonb(coalesce(clean_accepted_text_answers, '{}'::text[]))
    );
    manual_review_required :=
      p_manual_review_required
      or normalized_question_type = 'scenario'
      or (normalized_question_type = 'short_answer' and cardinality(clean_accepted_text_answers) = 0);
  end if;

  insert into public.quiz_version_questions (
    quiz_version_id,
    question_bank_item_id,
    position,
    prompt,
    question_type,
    points,
    scoring_mode,
    option_snapshot_json,
    answer_key_snapshot_json,
    metadata_json,
    manual_review_required,
    created_at,
    updated_at
  )
  values (
    p_quiz_version_id,
    null,
    next_position,
    normalized_prompt,
    normalized_question_type,
    p_points,
    normalized_scoring_mode,
    option_snapshot_json,
    answer_key_snapshot_json,
    '{}'::jsonb,
    manual_review_required,
    now(),
    now()
  )
  returning id into created_question_id;

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    null,
    'quiz_version.question_added',
    '{}'::jsonb,
    jsonb_build_object(
      'quiz_version_question_id', created_question_id,
      'position', next_position,
      'question_type', normalized_question_type
    ),
    '{}'::jsonb
  );

  return created_question_id;
end;
$$;

create or replace function public.quiz_publish_version(
  p_quiz_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  answer_key_version_number integer := 1;
  answer_key_version_id uuid;
  question_count integer := 0;
  answer_key_snapshot_json jsonb := '[]'::jsonb;
  now_utc timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = p_quiz_version_id
  limit 1;

  if version_row.id is null then
    raise exception 'Quiz version not found';
  end if;

  select *
  into quiz_row
  from public.quiz_definitions
  where id = version_row.quiz_id
  limit 1;

  if quiz_row.id is null then
    raise exception 'Quiz not found';
  end if;

  if not public.quiz_can_manage_client(quiz_row.client_id) then
    raise exception 'Not authorized to publish this quiz version';
  end if;

  select count(*)
  into question_count
  from public.quiz_version_questions
  where quiz_version_id = version_row.id;

  if question_count = 0 then
    raise exception 'Cannot publish a version with no questions';
  end if;

  select coalesce(max(version_number), 0) + 1
  into answer_key_version_number
  from public.quiz_answer_key_versions
  where quiz_version_id = version_row.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'quiz_version_question_id', q.id,
        'position', q.position,
        'question_type', q.question_type,
        'scoring_mode', q.scoring_mode,
        'answer_key_snapshot_json', coalesce(q.answer_key_snapshot_json, '{}'::jsonb)
      )
      order by q.position, q.id
    ),
    '[]'::jsonb
  )
  into answer_key_snapshot_json
  from public.quiz_version_questions q
  where q.quiz_version_id = version_row.id;

  update public.quiz_answer_key_versions
  set
    is_active = false,
    updated_at = now()
  where quiz_version_id = version_row.id
    and is_active;

  insert into public.quiz_answer_key_versions (
    quiz_version_id,
    version_number,
    answer_key_snapshot_json,
    reason,
    is_active,
    created_by_user_id,
    created_at,
    updated_at
  )
  values (
    version_row.id,
    answer_key_version_number,
    answer_key_snapshot_json,
    'publish',
    true,
    actor_id,
    now_utc,
    now_utc
  )
  returning id into answer_key_version_id;

  update public.quiz_versions
  set
    lifecycle_status = 'published',
    published_at = now_utc,
    published_by_user_id = actor_id,
    updated_at = now()
  where id = version_row.id;

  update public.quiz_definitions
  set
    status = 'published',
    published_version_number = greatest(published_version_number, version_row.version_number),
    published_at = now_utc,
    published_by_user_id = actor_id,
    updated_by_user_id = actor_id,
    updated_at = now()
  where id = quiz_row.id;

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    null,
    'quiz_version.published',
    '{}'::jsonb,
    jsonb_build_object(
      'answer_key_version_id', answer_key_version_id,
      'answer_key_version_number', answer_key_version_number,
      'question_count', question_count
    ),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'quiz_version_id', version_row.id,
    'answer_key_version_id', answer_key_version_id,
    'answer_key_version_number', answer_key_version_number,
    'question_count', question_count
  );
end;
$$;

create or replace function public.quiz_assign_version_to_user(
  p_quiz_version_id uuid,
  p_assigned_user_id uuid,
  p_assignment_mode text default 'required',
  p_available_from timestamptz default null,
  p_due_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  normalized_assignment_mode text := lower(trim(coalesce(p_assignment_mode, 'required')));
  assignment_id uuid;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_quiz_version_id is null then
    raise exception 'quiz_version_id is required';
  end if;

  if p_assigned_user_id is null then
    raise exception 'assigned_user_id is required';
  end if;

  if normalized_assignment_mode not in ('required', 'optional') then
    normalized_assignment_mode := 'required';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = p_quiz_version_id
  limit 1;

  if version_row.id is null then
    raise exception 'Quiz version not found';
  end if;

  select *
  into quiz_row
  from public.quiz_definitions
  where id = version_row.quiz_id
  limit 1;

  if quiz_row.id is null then
    raise exception 'Quiz not found';
  end if;

  if not public.quiz_can_assign_client(quiz_row.client_id) then
    raise exception 'Not authorized to assign this quiz';
  end if;

  if not exists (select 1 from public.users where id = p_assigned_user_id) then
    raise exception 'Assigned user does not exist';
  end if;

  insert into public.quiz_assignments (
    quiz_version_id,
    assigned_user_id,
    assigned_by_user_id,
    assignment_mode,
    available_from,
    due_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    version_row.id,
    p_assigned_user_id,
    actor_id,
    normalized_assignment_mode,
    p_available_from,
    p_due_at,
    p_expires_at,
    now(),
    now()
  )
  on conflict (quiz_version_id, assigned_user_id) do update
  set
    assigned_by_user_id = excluded.assigned_by_user_id,
    assignment_mode = excluded.assignment_mode,
    available_from = excluded.available_from,
    due_at = excluded.due_at,
    expires_at = excluded.expires_at,
    updated_at = now()
  returning id into assignment_id;

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    null,
    'quiz_assignment.upserted',
    '{}'::jsonb,
    jsonb_build_object(
      'assignment_id', assignment_id,
      'assigned_user_id', p_assigned_user_id,
      'assignment_mode', normalized_assignment_mode
    ),
    '{}'::jsonb
  );

  return assignment_id;
end;
$$;

grant execute on function public.quiz_create_definition_with_version(uuid, text, text, numeric, integer, integer, text) to anon, authenticated;
grant execute on function public.quiz_add_version_question(uuid, text, text, numeric, text, text[], integer[], boolean, text[], boolean) to anon, authenticated;
grant execute on function public.quiz_publish_version(uuid) to anon, authenticated;
grant execute on function public.quiz_assign_version_to_user(uuid, uuid, text, timestamptz, timestamptz, timestamptz) to anon, authenticated;
