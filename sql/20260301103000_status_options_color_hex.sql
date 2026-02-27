-- Add per-status color customisation for task, project, and feature suggestion statuses.

alter table if exists public.status_options
  add column if not exists color_hex text;

alter table if exists public.status_options
  drop constraint if exists status_options_color_hex_check;

alter table if exists public.status_options
  add constraint status_options_color_hex_check
  check (
    color_hex is null
    or color_hex ~ '^#[0-9A-Fa-f]{6}$'
  );

update public.status_options s
set color_hex = v.color_hex
from (
  values
    ('task', 'to_do', '#64748b'),
    ('task', 'backlog', '#64748b'),
    ('task', 'in_progress', '#3b82f6'),
    ('task', 'blocked', '#f59e0b'),
    ('task', 'completed', '#10b981'),
    ('task', 'cancelled', '#f43f5e'),
    ('task', 'template', '#6366f1'),
    ('project', 'planned', '#64748b'),
    ('project', 'active', '#3b82f6'),
    ('project', 'on_hold', '#f59e0b'),
    ('project', 'completed', '#10b981'),
    ('project', 'cancelled', '#f43f5e'),
    ('feature_suggestion', 'idea', '#64748b'),
    ('feature_suggestion', 'needs_checking', '#f59e0b'),
    ('feature_suggestion', 'planned', '#3b82f6'),
    ('feature_suggestion', 'completed', '#10b981'),
    ('feature_suggestion', 'rejected', '#f43f5e')
) as v(entity_type, value, color_hex)
where s.entity_type = v.entity_type
  and lower(s.value) = lower(v.value)
  and s.color_hex is null;
