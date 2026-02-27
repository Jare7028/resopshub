-- Quiz attempt and auto-marking RPCs.

create or replace function public.quiz_normalize_uuid_array(p_values uuid[])
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  from unnest(coalesce(p_values, '{}'::uuid[])) as value;
$$;

create or replace function public.quiz_uuid_array_equals(p_left uuid[], p_right uuid[])
returns boolean
language sql
immutable
as $$
  select public.quiz_normalize_uuid_array(p_left) = public.quiz_normalize_uuid_array(p_right);
$$;

create or replace function public.quiz_partial_credit_fraction(
  p_selected uuid[],
  p_correct uuid[]
)
returns numeric
language plpgsql
immutable
as $$
declare
  selected_norm uuid[] := public.quiz_normalize_uuid_array(p_selected);
  correct_norm uuid[] := public.quiz_normalize_uuid_array(p_correct);
  correct_count integer := cardinality(correct_norm);
  true_positive integer := 0;
  false_positive integer := 0;
  raw_fraction numeric := 0;
begin
  if correct_count = 0 then
    return 0;
  end if;

  select count(*)
  into true_positive
  from unnest(selected_norm) as selected_value
  where selected_value = any(correct_norm);

  select count(*)
  into false_positive
  from unnest(selected_norm) as selected_value
  where not (selected_value = any(correct_norm));

  raw_fraction := (true_positive - false_positive)::numeric / correct_count::numeric;
  return greatest(0, least(1, raw_fraction));
end;
$$;

create or replace function public.quiz_start_attempt(
  p_quiz_version_id uuid default null,
  p_assignment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  assignment_row public.quiz_assignments%rowtype;
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  latest_scored_at timestamptz;
  next_attempt_number integer;
  existing_attempt_id uuid;
  active_answer_key_version_id uuid;
  cooldown_until timestamptz;
  now_utc timestamptz := timezone('utc', now());
  target_version_id uuid := p_quiz_version_id;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_assignment_id is null and p_quiz_version_id is null then
    raise exception 'Either assignment_id or quiz_version_id is required';
  end if;

  if p_assignment_id is not null then
    select *
    into assignment_row
    from public.quiz_assignments
    where id = p_assignment_id
    limit 1;

    if assignment_row.id is null then
      raise exception 'Assignment not found';
    end if;

    if not public.quiz_current_user_matches(assignment_row.assigned_user_id) then
      raise exception 'Assignment is not for the current user';
    end if;

    target_version_id := assignment_row.quiz_version_id;
  end if;

  if target_version_id is null then
    raise exception 'Quiz version is required';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = target_version_id
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

  if not public.quiz_can_take_version(version_row.id) then
    raise exception 'Not authorized to start this quiz';
  end if;

  if version_row.lifecycle_status <> 'published' and not public.quiz_can_manage_version(version_row.id) then
    raise exception 'Quiz version is not published';
  end if;

  select a.id
  into existing_attempt_id
  from public.quiz_attempts a
  where a.quiz_version_id = version_row.id
    and a.user_id = actor_id
    and a.status = 'in_progress'
  order by a.started_at desc
  limit 1;

  if existing_attempt_id is not null then
    return existing_attempt_id;
  end if;

  select coalesce(max(a.attempt_number), 0) + 1
  into next_attempt_number
  from public.quiz_attempts a
  where a.quiz_version_id = version_row.id
    and a.user_id = actor_id;

  if next_attempt_number > quiz_row.max_attempts then
    raise exception 'Maximum attempts reached for this quiz';
  end if;

  if next_attempt_number > 1 and quiz_row.retake_cooldown_seconds > 0 then
    select coalesce(a.completed_at, a.final_scored_at, a.auto_scored_at, a.submitted_at)
    into latest_scored_at
    from public.quiz_attempts a
    where a.quiz_version_id = version_row.id
      and a.user_id = actor_id
      and a.attempt_number = next_attempt_number - 1
    limit 1;

    if latest_scored_at is not null then
      cooldown_until := latest_scored_at + make_interval(secs => quiz_row.retake_cooldown_seconds);
      if now_utc < cooldown_until then
        raise exception 'Retake cooldown active until %', cooldown_until;
      end if;
    end if;
  end if;

  select id
  into active_answer_key_version_id
  from public.quiz_answer_key_versions
  where quiz_version_id = version_row.id
    and is_active
  order by version_number desc
  limit 1;

  if active_answer_key_version_id is null then
    select id
    into active_answer_key_version_id
    from public.quiz_answer_key_versions
    where quiz_version_id = version_row.id
    order by version_number desc
    limit 1;
  end if;

  insert into public.quiz_attempts (
    assignment_id,
    quiz_version_id,
    answer_key_version_id,
    user_id,
    attempt_number,
    status,
    started_at
  )
  values (
    assignment_row.id,
    version_row.id,
    active_answer_key_version_id,
    actor_id,
    next_attempt_number,
    'in_progress',
    now_utc
  )
  returning id into existing_attempt_id;

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    existing_attempt_id,
    'attempt.started',
    '{}'::jsonb,
    jsonb_build_object(
      'attempt_number', next_attempt_number,
      'assignment_id', assignment_row.id
    ),
    '{}'::jsonb
  );

  return existing_attempt_id;
end;
$$;

create or replace function public.quiz_save_attempt_answer(
  p_attempt_id uuid,
  p_quiz_version_question_id uuid,
  p_selected_option_ids uuid[] default '{}'::uuid[],
  p_answer_text text default null,
  p_answer_boolean boolean default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  attempt_row public.quiz_attempts%rowtype;
  question_row public.quiz_version_questions%rowtype;
  normalized_selected_option_ids uuid[] := public.quiz_normalize_uuid_array(p_selected_option_ids);
  normalized_answer_text text := nullif(trim(coalesce(p_answer_text, '')), '');
  requires_manual_review boolean;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
  limit 1;

  if attempt_row.id is null then
    raise exception 'Attempt not found';
  end if;

  if not public.quiz_current_user_matches(attempt_row.user_id) then
    raise exception 'Not authorized to answer this attempt';
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'Attempt is not editable';
  end if;

  select *
  into question_row
  from public.quiz_version_questions
  where id = p_quiz_version_question_id
    and quiz_version_id = attempt_row.quiz_version_id
  limit 1;

  if question_row.id is null then
    raise exception 'Question not found for this attempt';
  end if;

  requires_manual_review :=
    question_row.manual_review_required
    or question_row.question_type in ('short_answer', 'scenario');

  insert into public.quiz_attempt_answers (
    attempt_id,
    quiz_version_question_id,
    selected_option_ids,
    answer_text,
    answer_boolean,
    auto_graded,
    needs_manual_review,
    is_correct,
    points_possible,
    points_earned,
    feedback_text,
    graded_by_user_id,
    graded_at
  )
  values (
    attempt_row.id,
    question_row.id,
    normalized_selected_option_ids,
    normalized_answer_text,
    p_answer_boolean,
    false,
    requires_manual_review,
    null,
    question_row.points,
    0,
    null,
    null,
    null
  )
  on conflict (attempt_id, quiz_version_question_id) do update
  set
    selected_option_ids = excluded.selected_option_ids,
    answer_text = excluded.answer_text,
    answer_boolean = excluded.answer_boolean,
    auto_graded = false,
    needs_manual_review = excluded.needs_manual_review,
    is_correct = null,
    points_possible = excluded.points_possible,
    points_earned = 0,
    feedback_text = null,
    graded_by_user_id = null,
    graded_at = null,
    updated_at = now();

  perform public.quiz_log_audit_event(
    (select q.id from public.quiz_versions v join public.quiz_definitions q on q.id = v.quiz_id where v.id = attempt_row.quiz_version_id limit 1),
    attempt_row.quiz_version_id,
    attempt_row.id,
    'attempt.answer_saved',
    '{}'::jsonb,
    jsonb_build_object(
      'quiz_version_question_id', question_row.id,
      'requires_manual_review', requires_manual_review
    ),
    '{}'::jsonb
  );
end;
$$;

create or replace function public.quiz_submit_attempt(
  p_attempt_id uuid,
  p_time_spent_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  attempt_row public.quiz_attempts%rowtype;
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  question_row public.quiz_version_questions%rowtype;
  answer_row public.quiz_attempt_answers%rowtype;
  selected_option_ids uuid[] := '{}'::uuid[];
  correct_option_ids uuid[] := '{}'::uuid[];
  accepted_text_answers text[] := '{}'::text[];
  scoring_mode text := 'all_or_nothing';
  answer_text_normalized text := '';
  correct_boolean boolean := null;
  points_fraction numeric := 0;
  points_earned numeric := 0;
  is_correct_auto boolean := null;
  auto_feedback_text text := null;
  total_points numeric := 0;
  earned_points numeric := 0;
  score_percent numeric := 0;
  has_manual_review boolean := false;
  pending_manual_count integer := 0;
  final_status text := 'auto_scored';
  passed_value boolean := null;
  now_utc timestamptz := timezone('utc', now());
  before_score_json jsonb;
  after_score_json jsonb;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_time_spent_seconds is not null and p_time_spent_seconds < 0 then
    raise exception 'time_spent_seconds must be non-negative';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
  limit 1;

  if attempt_row.id is null then
    raise exception 'Attempt not found';
  end if;

  if attempt_row.status not in ('in_progress', 'submitted', 'partially_scored', 'auto_scored') then
    raise exception 'Attempt cannot be submitted in status %', attempt_row.status;
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = attempt_row.quiz_version_id
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

  if not public.quiz_current_user_matches(attempt_row.user_id)
    and not public.quiz_can_review_client(quiz_row.client_id)
    and not public.quiz_can_manage_client(quiz_row.client_id) then
    raise exception 'Not authorized to submit this attempt';
  end if;

  before_score_json := jsonb_build_object(
    'status', attempt_row.status,
    'total_points', attempt_row.total_points,
    'earned_points', attempt_row.earned_points,
    'score_percent', attempt_row.score_percent,
    'passed', attempt_row.passed,
    'requires_manual_review', attempt_row.requires_manual_review
  );

  for question_row in
    select *
    from public.quiz_version_questions
    where quiz_version_id = version_row.id
    order by position, id
  loop
    select *
    into answer_row
    from public.quiz_attempt_answers
    where attempt_id = attempt_row.id
      and quiz_version_question_id = question_row.id
    limit 1;

    if answer_row.id is null then
      insert into public.quiz_attempt_answers (
        attempt_id,
        quiz_version_question_id,
        selected_option_ids,
        answer_text,
        answer_boolean,
        auto_graded,
        needs_manual_review,
        is_correct,
        points_possible,
        points_earned,
        feedback_text
      )
      values (
        attempt_row.id,
        question_row.id,
        '{}'::uuid[],
        null,
        null,
        false,
        question_row.manual_review_required or question_row.question_type in ('short_answer', 'scenario'),
        null,
        question_row.points,
        0,
        null
      )
      returning * into answer_row;
    end if;

    if question_row.manual_review_required or question_row.question_type in ('short_answer', 'scenario') then
      update public.quiz_attempt_answers
      set
        auto_graded = false,
        needs_manual_review = true,
        is_correct = null,
        points_possible = question_row.points,
        graded_by_user_id = null,
        graded_at = null,
        updated_at = now()
      where id = answer_row.id;

      insert into public.quiz_manual_review_tasks (
        attempt_answer_id,
        status,
        completed_at,
        created_at,
        updated_at
      )
      values (
        answer_row.id,
        'pending',
        null,
        now(),
        now()
      )
      on conflict (attempt_answer_id) do update
      set
        status = 'pending',
        completed_at = null,
        updated_at = now();

      continue;
    end if;

    scoring_mode := lower(trim(coalesce(question_row.answer_key_snapshot_json ->> 'scoring_mode', question_row.scoring_mode, 'all_or_nothing')));
    if scoring_mode not in ('all_or_nothing', 'partial_credit') then
      scoring_mode := 'all_or_nothing';
    end if;

    auto_feedback_text := nullif(trim(coalesce(question_row.answer_key_snapshot_json ->> 'explanation', '')), '');
    correct_option_ids := '{}'::uuid[];
    accepted_text_answers := '{}'::text[];
    correct_boolean := null;

    select coalesce(array_agg(raw_value::uuid), '{}'::uuid[])
    into correct_option_ids
    from jsonb_array_elements_text(coalesce(question_row.answer_key_snapshot_json -> 'correct_option_ids', '[]'::jsonb)) as raw(raw_value)
    where raw_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    select coalesce(array_agg(lower(trim(raw_text))), '{}'::text[])
    into accepted_text_answers
    from jsonb_array_elements_text(coalesce(question_row.answer_key_snapshot_json -> 'accepted_text_answers', '[]'::jsonb)) as raw(raw_text)
    where length(trim(raw_text)) > 0;

    if question_row.answer_key_snapshot_json ? 'correct_boolean'
      and lower(coalesce(question_row.answer_key_snapshot_json ->> 'correct_boolean', '')) in ('true', 'false') then
      correct_boolean := (question_row.answer_key_snapshot_json ->> 'correct_boolean')::boolean;
    end if;

    selected_option_ids := public.quiz_normalize_uuid_array(coalesce(answer_row.selected_option_ids, '{}'::uuid[]));
    correct_option_ids := public.quiz_normalize_uuid_array(correct_option_ids);
    answer_text_normalized := lower(trim(coalesce(answer_row.answer_text, '')));
    points_fraction := 0;

    if question_row.question_type = 'single_choice' then
      if cardinality(correct_option_ids) > 0 and public.quiz_uuid_array_equals(selected_option_ids, correct_option_ids) then
        points_fraction := 1;
      end if;
    elsif question_row.question_type = 'multi_select' then
      if cardinality(correct_option_ids) > 0 then
        if scoring_mode = 'partial_credit' then
          points_fraction := public.quiz_partial_credit_fraction(selected_option_ids, correct_option_ids);
        elsif public.quiz_uuid_array_equals(selected_option_ids, correct_option_ids) then
          points_fraction := 1;
        end if;
      end if;
    elsif question_row.question_type = 'true_false' then
      if correct_boolean is not null and answer_row.answer_boolean is not null then
        points_fraction := case when answer_row.answer_boolean = correct_boolean then 1 else 0 end;
      elsif cardinality(correct_option_ids) > 0 and public.quiz_uuid_array_equals(selected_option_ids, correct_option_ids) then
        points_fraction := 1;
      end if;
    elsif question_row.question_type in ('short_answer', 'scenario') then
      if answer_text_normalized <> '' and answer_text_normalized = any(accepted_text_answers) then
        points_fraction := 1;
      end if;
    end if;

    points_earned := round(coalesce(question_row.points, 0)::numeric * points_fraction, 2);
    if coalesce(question_row.points, 0)::numeric = 0 then
      is_correct_auto := points_fraction >= 1;
    else
      is_correct_auto := points_earned >= question_row.points;
    end if;

    update public.quiz_attempt_answers
    set
      auto_graded = true,
      needs_manual_review = false,
      is_correct = is_correct_auto,
      points_possible = question_row.points,
      points_earned = points_earned,
      feedback_text = auto_feedback_text,
      graded_by_user_id = null,
      graded_at = now(),
      updated_at = now()
    where id = answer_row.id;

    update public.quiz_manual_review_tasks
    set
      status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
    where attempt_answer_id = answer_row.id
      and status <> 'completed';
  end loop;

  select
    coalesce(sum(aa.points_possible), 0),
    coalesce(sum(aa.points_earned), 0),
    coalesce(bool_or(aa.needs_manual_review), false),
    count(*) filter (where aa.needs_manual_review)
  into
    total_points,
    earned_points,
    has_manual_review,
    pending_manual_count
  from public.quiz_attempt_answers aa
  where aa.attempt_id = attempt_row.id;

  if total_points > 0 then
    score_percent := round((earned_points / total_points) * 100, 2);
  else
    score_percent := 0;
  end if;

  if has_manual_review then
    final_status := 'partially_scored';
    passed_value := null;
  else
    final_status := 'auto_scored';
    passed_value := score_percent >= quiz_row.passing_score_percent;
  end if;

  update public.quiz_attempts
  set
    status = final_status,
    submitted_at = coalesce(submitted_at, now_utc),
    auto_scored_at = now_utc,
    final_scored_at = case when has_manual_review then null else now_utc end,
    completed_at = case when has_manual_review then null else now_utc end,
    time_spent_seconds = coalesce(p_time_spent_seconds, time_spent_seconds),
    total_points = total_points,
    earned_points = earned_points,
    score_percent = score_percent,
    passed = passed_value,
    requires_manual_review = has_manual_review,
    updated_at = now()
  where id = attempt_row.id;

  after_score_json := jsonb_build_object(
    'status', final_status,
    'total_points', total_points,
    'earned_points', earned_points,
    'score_percent', score_percent,
    'passed', passed_value,
    'requires_manual_review', has_manual_review,
    'pending_manual_count', pending_manual_count
  );

  perform public.quiz_log_score_event(
    attempt_row.id,
    'submission',
    before_score_json,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('submitted_at', now_utc)
  );

  perform public.quiz_log_score_event(
    attempt_row.id,
    'auto_score',
    before_score_json,
    after_score_json,
    jsonb_build_object('pending_manual_count', pending_manual_count)
  );

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    attempt_row.id,
    'attempt.submitted',
    before_score_json,
    after_score_json,
    jsonb_build_object('pending_manual_count', pending_manual_count)
  );

  return after_score_json;
end;
$$;

create or replace function public.quiz_review_attempt_answer(
  p_attempt_answer_id uuid,
  p_points_earned numeric,
  p_feedback_text text default null,
  p_mark_correct boolean default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  answer_row public.quiz_attempt_answers%rowtype;
  attempt_row public.quiz_attempts%rowtype;
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  clamped_points numeric;
  mark_is_correct boolean;
  normalized_feedback text := nullif(trim(coalesce(p_feedback_text, '')), '');
  before_score_json jsonb;
  after_score_json jsonb;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_points_earned is null then
    raise exception 'points_earned is required';
  end if;

  select *
  into answer_row
  from public.quiz_attempt_answers
  where id = p_attempt_answer_id
  limit 1;

  if answer_row.id is null then
    raise exception 'Attempt answer not found';
  end if;

  if not public.quiz_can_review_attempt_answer(answer_row.id) then
    raise exception 'Not authorized to review this answer';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = answer_row.attempt_id
  limit 1;

  if attempt_row.id is null then
    raise exception 'Attempt not found';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = attempt_row.quiz_version_id
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

  if p_points_earned < 0 or p_points_earned > answer_row.points_possible then
    raise exception 'points_earned must be between 0 and %', answer_row.points_possible;
  end if;

  clamped_points := round(p_points_earned, 2);
  mark_is_correct := coalesce(
    p_mark_correct,
    case
      when answer_row.points_possible = 0 then true
      else clamped_points >= answer_row.points_possible
    end
  );

  before_score_json := jsonb_build_object(
    'attempt_answer_id', answer_row.id,
    'points_earned', answer_row.points_earned,
    'is_correct', answer_row.is_correct,
    'needs_manual_review', answer_row.needs_manual_review
  );

  update public.quiz_attempt_answers
  set
    auto_graded = false,
    needs_manual_review = false,
    points_earned = clamped_points,
    is_correct = mark_is_correct,
    feedback_text = coalesce(normalized_feedback, feedback_text),
    graded_by_user_id = actor_id,
    graded_at = now(),
    updated_at = now()
  where id = answer_row.id;

  insert into public.quiz_manual_review_tasks (
    attempt_answer_id,
    status,
    reviewed_by_user_id,
    review_notes,
    completed_at,
    created_at,
    updated_at
  )
  values (
    answer_row.id,
    'completed',
    actor_id,
    normalized_feedback,
    now(),
    now(),
    now()
  )
  on conflict (attempt_answer_id) do update
  set
    status = 'completed',
    reviewed_by_user_id = actor_id,
    review_notes = coalesce(excluded.review_notes, quiz_manual_review_tasks.review_notes),
    completed_at = now(),
    updated_at = now();

  after_score_json := jsonb_build_object(
    'attempt_answer_id', answer_row.id,
    'points_earned', clamped_points,
    'is_correct', mark_is_correct,
    'needs_manual_review', false
  );

  perform public.quiz_log_score_event(
    attempt_row.id,
    'manual_score',
    before_score_json,
    after_score_json,
    jsonb_build_object('attempt_answer_id', answer_row.id)
  );

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    attempt_row.id,
    'attempt_answer.reviewed',
    before_score_json,
    after_score_json,
    jsonb_build_object('attempt_answer_id', answer_row.id)
  );
end;
$$;

create or replace function public.quiz_finalize_attempt_scoring(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  actor_id uuid := coalesce(public.current_app_user_id(), auth.uid());
  attempt_row public.quiz_attempts%rowtype;
  version_row public.quiz_versions%rowtype;
  quiz_row public.quiz_definitions%rowtype;
  unresolved_manual_count integer := 0;
  total_points numeric := 0;
  earned_points numeric := 0;
  score_percent numeric := 0;
  passed_value boolean;
  now_utc timestamptz := timezone('utc', now());
  before_score_json jsonb;
  after_score_json jsonb;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
  limit 1;

  if attempt_row.id is null then
    raise exception 'Attempt not found';
  end if;

  select *
  into version_row
  from public.quiz_versions
  where id = attempt_row.quiz_version_id
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

  if not public.quiz_can_review_client(quiz_row.client_id)
    and not public.quiz_can_manage_client(quiz_row.client_id) then
    raise exception 'Not authorized to finalize this attempt';
  end if;

  select count(*)
  into unresolved_manual_count
  from public.quiz_attempt_answers aa
  where aa.attempt_id = attempt_row.id
    and aa.needs_manual_review;

  if unresolved_manual_count > 0 then
    raise exception 'Manual review is still pending for % answer(s)', unresolved_manual_count;
  end if;

  select
    coalesce(sum(points_possible), 0),
    coalesce(sum(points_earned), 0)
  into
    total_points,
    earned_points
  from public.quiz_attempt_answers
  where attempt_id = attempt_row.id;

  if total_points > 0 then
    score_percent := round((earned_points / total_points) * 100, 2);
  else
    score_percent := 0;
  end if;

  passed_value := score_percent >= quiz_row.passing_score_percent;

  before_score_json := jsonb_build_object(
    'status', attempt_row.status,
    'total_points', attempt_row.total_points,
    'earned_points', attempt_row.earned_points,
    'score_percent', attempt_row.score_percent,
    'passed', attempt_row.passed,
    'requires_manual_review', attempt_row.requires_manual_review
  );

  update public.quiz_attempts
  set
    status = 'final_scored',
    total_points = total_points,
    earned_points = earned_points,
    score_percent = score_percent,
    passed = passed_value,
    requires_manual_review = false,
    final_scored_at = now_utc,
    completed_at = now_utc,
    updated_at = now()
  where id = attempt_row.id;

  after_score_json := jsonb_build_object(
    'status', 'final_scored',
    'total_points', total_points,
    'earned_points', earned_points,
    'score_percent', score_percent,
    'passed', passed_value,
    'requires_manual_review', false
  );

  perform public.quiz_log_score_event(
    attempt_row.id,
    'manual_score',
    before_score_json,
    after_score_json,
    jsonb_build_object('finalized_by', actor_id)
  );

  perform public.quiz_log_audit_event(
    quiz_row.id,
    version_row.id,
    attempt_row.id,
    'attempt.finalized',
    before_score_json,
    after_score_json,
    jsonb_build_object('finalized_by', actor_id)
  );

  return after_score_json;
end;
$$;

grant execute on function public.quiz_normalize_uuid_array(uuid[]) to anon, authenticated;
grant execute on function public.quiz_uuid_array_equals(uuid[], uuid[]) to anon, authenticated;
grant execute on function public.quiz_partial_credit_fraction(uuid[], uuid[]) to anon, authenticated;
grant execute on function public.quiz_start_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.quiz_save_attempt_answer(uuid, uuid, uuid[], text, boolean) to anon, authenticated;
grant execute on function public.quiz_submit_attempt(uuid, integer) to anon, authenticated;
grant execute on function public.quiz_review_attempt_answer(uuid, numeric, text, boolean) to anon, authenticated;
grant execute on function public.quiz_finalize_attempt_scoring(uuid) to anon, authenticated;
