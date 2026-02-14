-- Store non-task mention assignments (e.g. client notes, personal pages).
-- Run once in Supabase SQL editor. Safe to re-run.

create table if not exists public.text_mention_assignees (
  source_type text not null check (source_type in ('client_note', 'personal_page')),
  source_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  mentioned_by_user_id uuid,
  created_at timestamptz not null default now(),
  primary key (source_type, source_id, user_id)
);

create index if not exists text_mention_assignees_user_created_idx
  on public.text_mention_assignees (user_id, created_at desc);

alter table public.text_mention_assignees enable row level security;

drop policy if exists text_mention_assignees_select on public.text_mention_assignees;
create policy text_mention_assignees_select
  on public.text_mention_assignees
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or user_id in (auth.uid(), public.current_app_user_id())
    )
  );

grant select on public.text_mention_assignees to authenticated;
