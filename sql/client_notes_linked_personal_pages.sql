-- Link client notes to personal pages so linked notes can stay in sync.
-- Run after sql/personal.sql and sql/client_notes_pages.sql.

alter table public.notes
  add column if not exists source_personal_page_id uuid
    references public.personal_pages(id) on delete set null;

create index if not exists notes_source_personal_page_id_idx
  on public.notes(source_personal_page_id);
