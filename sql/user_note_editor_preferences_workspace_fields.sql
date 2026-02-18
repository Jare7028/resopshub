-- Optional workspace defaults in user_note_editor_preferences.
-- Additive migration for /personal workspace redesign.

alter table public.user_note_editor_preferences
  add column if not exists default_zoom_percent int;

alter table public.user_note_editor_preferences
  add column if not exists default_ribbon_tab text;

update public.user_note_editor_preferences
set default_zoom_percent = 100
where default_zoom_percent is null;

update public.user_note_editor_preferences
set default_ribbon_tab = 'home'
where default_ribbon_tab is null;

alter table public.user_note_editor_preferences
  alter column default_zoom_percent set default 100;

alter table public.user_note_editor_preferences
  alter column default_ribbon_tab set default 'home';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_note_editor_preferences_default_zoom_percent_range'
  ) then
    alter table public.user_note_editor_preferences
      add constraint user_note_editor_preferences_default_zoom_percent_range
      check (default_zoom_percent between 20 and 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_note_editor_preferences_default_ribbon_tab_check'
  ) then
    alter table public.user_note_editor_preferences
      add constraint user_note_editor_preferences_default_ribbon_tab_check
      check (default_ribbon_tab in ('home', 'insert', 'layout', 'review', 'view'));
  end if;
end
$$;
