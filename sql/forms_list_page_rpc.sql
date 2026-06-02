-- Fast paged Forms list with open-submission counts.
-- Run after sql/forms.sql.

create index if not exists idx_forms_status_updated_at
  on public.forms(status, updated_at desc);

create index if not exists idx_form_submissions_open_form_id
  on public.form_submissions(form_id)
  where status not in ('completed', 'rejected');

create or replace function public.forms_list_page(
  p_statuses text[] default '{}'::text[],
  p_query text default '',
  p_sort_key text default 'updated_at',
  p_sort_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  description text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  open_submissions bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select
      case
        when lower(coalesce(p_sort_key, '')) in ('title', 'status', 'open_submissions', 'updated_at')
          then lower(p_sort_key)
        else 'updated_at'
      end as sort_key,
      case when lower(coalesce(p_sort_dir, '')) = 'asc' then 'asc' else 'desc' end as sort_dir,
      least(greatest(coalesce(p_limit, 50), 1), 100) as row_limit,
      greatest(coalesce(p_offset, 0), 0) as row_offset,
      nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'), '') as query_text
  ),
  open_counts as (
    select
      form_submissions.form_id,
      count(*)::bigint as open_submissions
    from public.form_submissions
    where form_submissions.status not in ('completed', 'rejected')
    group by form_submissions.form_id
  ),
  filtered as (
    select
      forms.id,
      forms.title,
      forms.description,
      forms.status,
      forms.created_at,
      forms.updated_at,
      coalesce(open_counts.open_submissions, 0)::bigint as open_submissions
    from public.forms
    cross join settings
    left join open_counts on open_counts.form_id = forms.id
    where (
      coalesce(array_length(p_statuses, 1), 0) = 0
      or forms.status = any(coalesce(p_statuses, '{}'::text[]))
    )
      and (
        settings.query_text is null
        or position(lower(settings.query_text) in lower(coalesce(forms.title, ''))) > 0
        or position(lower(settings.query_text) in lower(coalesce(forms.description, ''))) > 0
      )
  ),
  counted as (
    select
      filtered.*,
      count(*) over()::bigint as total_count
    from filtered
  )
  select
    counted.id,
    counted.title,
    counted.description,
    counted.status,
    counted.created_at,
    counted.updated_at,
    counted.open_submissions,
    counted.total_count
  from counted
  cross join settings
  order by
    case when settings.sort_key = 'title' and settings.sort_dir = 'asc' then lower(counted.title) end asc nulls last,
    case when settings.sort_key = 'title' and settings.sort_dir = 'desc' then lower(counted.title) end desc nulls last,
    case when settings.sort_key = 'status' and settings.sort_dir = 'asc' then counted.status end asc nulls last,
    case when settings.sort_key = 'status' and settings.sort_dir = 'desc' then counted.status end desc nulls last,
    case when settings.sort_key = 'open_submissions' and settings.sort_dir = 'asc' then counted.open_submissions end asc nulls last,
    case when settings.sort_key = 'open_submissions' and settings.sort_dir = 'desc' then counted.open_submissions end desc nulls last,
    case when settings.sort_key = 'updated_at' and settings.sort_dir = 'asc' then counted.updated_at end asc nulls last,
    case when settings.sort_key = 'updated_at' and settings.sort_dir = 'desc' then counted.updated_at end desc nulls last,
    lower(counted.title) asc,
    counted.id asc
  limit (select row_limit from settings)
  offset (select row_offset from settings);
$$;

grant execute on function public.forms_list_page(text[], text, text, text, integer, integer)
  to authenticated;
