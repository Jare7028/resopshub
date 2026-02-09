-- Client note pages support (apply in Supabase SQL editor).
-- Adds a title + TipTap JSON content for client notes, while keeping `content` as a plain-text preview.

alter table notes
  add column if not exists title text,
  add column if not exists content_json jsonb,
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_user_id uuid;

-- Backfill existing rows.
update notes
set title = coalesce(
  nullif(title, ''),
  nullif(left(regexp_replace(coalesce(content, ''), '[[:space:]]+', ' ', 'g'), 80), ''),
  'Untitled'
)
where title is null or title = '';

update notes
set last_edited_at = coalesce(last_edited_at, created_at, now())
where last_edited_at is null;

-- Defaults for new rows.
alter table notes
  alter column title set default 'Untitled';

alter table notes
  alter column last_edited_at set default now();

-- Enforce basic invariants after backfill.
alter table notes
  alter column title set not null;

alter table notes
  alter column last_edited_at set not null;

create index if not exists notes_client_last_edited_at_idx
  on notes (client_id, last_edited_at desc);
