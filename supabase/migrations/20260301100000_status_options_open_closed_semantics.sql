-- Align status option semantics:
-- - open statuses are visible by default
-- - closed statuses are hidden by default and count as completed

update public.status_options
set
  is_visible = true,
  counts_as_completed = false
where entity_type = 'task'
  and lower(value) in ('to_do', 'in_progress', 'blocked');

update public.status_options
set
  is_visible = false,
  counts_as_completed = true
where entity_type = 'task'
  and lower(value) in ('completed', 'cancelled');

update public.status_options
set
  is_visible = true,
  counts_as_completed = false
where entity_type = 'project'
  and lower(value) in ('planned', 'active', 'on_hold');

update public.status_options
set
  is_visible = false,
  counts_as_completed = true
where entity_type = 'project'
  and lower(value) in ('completed', 'cancelled');

update public.status_options
set
  is_visible = true,
  counts_as_completed = false
where entity_type = 'feature_suggestion'
  and lower(value) in ('idea', 'needs_checking', 'planned');

update public.status_options
set
  is_visible = false,
  counts_as_completed = true
where entity_type = 'feature_suggestion'
  and lower(value) in ('completed', 'rejected');
