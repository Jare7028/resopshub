-- Share links for form submissions (public or login-required).
-- Run after:
--   sql/forms.sql
--   sql/forms_form_permissions.sql

create table if not exists public.form_share_links (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  token text not null unique,
  access_mode text not null default 'public',
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz,
  constraint form_share_links_token_not_blank check (length(trim(token)) > 0),
  constraint form_share_links_access_mode_check
    check (access_mode in ('public', 'authenticated'))
);

drop trigger if exists trg_form_share_links_updated_at on public.form_share_links;
create trigger trg_form_share_links_updated_at
before update on public.form_share_links
for each row execute function public.set_updated_at();

create index if not exists idx_form_share_links_form_id_created_at
  on public.form_share_links(form_id, created_at desc);

create index if not exists idx_form_share_links_token_is_active
  on public.form_share_links(token, is_active);

create or replace function public.resolve_form_share_link(p_token text)
returns table (
  form_id uuid,
  form_title text,
  form_description text,
  form_status text,
  form_fields jsonb,
  access_mode text
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    f.id,
    f.title,
    f.description,
    f.status,
    f.fields,
    l.access_mode
  from public.form_share_links l
  join public.forms f on f.id = l.form_id
  where l.token = trim(coalesce(p_token, ''))
    and l.is_active
    and (l.expires_at is null or l.expires_at > timezone('utc', now()))
  limit 1;
$$;

create or replace function public.create_form_submission_via_share_link(
  p_token text,
  p_values_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_token text := trim(coalesce(p_token, ''));
  v_form_id uuid;
  v_access_mode text;
  v_submission_id uuid;
  v_submitted_by_user_id uuid;
begin
  if v_token = '' then
    raise exception 'Invalid form link';
  end if;

  select
    l.form_id,
    l.access_mode
  into
    v_form_id,
    v_access_mode
  from public.form_share_links l
  where l.token = v_token
    and l.is_active
    and (l.expires_at is null or l.expires_at > timezone('utc', now()))
  limit 1;

  if v_form_id is null then
    raise exception 'Invalid or inactive form link';
  end if;

  if v_access_mode = 'authenticated' and auth.uid() is null then
    raise exception 'Authentication required for this form link';
  end if;

  if jsonb_typeof(coalesce(p_values_json, '{}'::jsonb)) <> 'object' then
    raise exception 'Form values payload must be a JSON object';
  end if;

  if auth.uid() is not null then
    v_submitted_by_user_id := public.current_app_user_id();
  else
    v_submitted_by_user_id := null;
  end if;

  insert into public.form_submissions (
    form_id,
    status,
    values_json,
    submitted_by
  )
  values (
    v_form_id,
    'open',
    coalesce(p_values_json, '{}'::jsonb),
    v_submitted_by_user_id
  )
  returning id into v_submission_id;

  update public.form_share_links
  set last_used_at = timezone('utc', now())
  where token = v_token;

  return v_submission_id;
end;
$$;

grant execute on function public.resolve_form_share_link(text) to anon, authenticated;
grant execute on function public.create_form_submission_via_share_link(text, jsonb) to anon, authenticated;

alter table public.form_share_links enable row level security;

drop policy if exists form_share_links_select on public.form_share_links;
create policy form_share_links_select
  on public.form_share_links
  for select
  to authenticated
  using (public.can_manage_form(form_id));

drop policy if exists form_share_links_insert on public.form_share_links;
create policy form_share_links_insert
  on public.form_share_links
  for insert
  to authenticated
  with check (public.can_manage_form(form_id));

drop policy if exists form_share_links_update on public.form_share_links;
create policy form_share_links_update
  on public.form_share_links
  for update
  to authenticated
  using (public.can_manage_form(form_id))
  with check (public.can_manage_form(form_id));

drop policy if exists form_share_links_delete on public.form_share_links;
create policy form_share_links_delete
  on public.form_share_links
  for delete
  to authenticated
  using (public.can_manage_form(form_id));

grant select, insert, update, delete on table public.form_share_links to authenticated;
