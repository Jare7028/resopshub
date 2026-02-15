-- User note editor preferences.
-- Apply in Supabase SQL editor.

create table if not exists public.user_note_editor_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  personal_context_menu_favorites text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_note_editor_preferences enable row level security;

drop policy if exists user_note_editor_preferences_select_own on public.user_note_editor_preferences;
create policy user_note_editor_preferences_select_own
  on public.user_note_editor_preferences
  for select
  using (auth.uid() = user_id);

drop policy if exists user_note_editor_preferences_insert_own on public.user_note_editor_preferences;
create policy user_note_editor_preferences_insert_own
  on public.user_note_editor_preferences
  for insert
  with check (auth.uid() = user_id);

drop policy if exists user_note_editor_preferences_update_own on public.user_note_editor_preferences;
create policy user_note_editor_preferences_update_own
  on public.user_note_editor_preferences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_note_editor_preferences to authenticated;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_user_note_editor_preferences_updated_at on public.user_note_editor_preferences;
create trigger set_user_note_editor_preferences_updated_at
before update on public.user_note_editor_preferences
for each row
execute function public.set_updated_at();
