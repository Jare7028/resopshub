-- Per-user chat conversation list preferences.
alter table public.chat_conversation_members
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_muted boolean not null default false;

create index if not exists idx_chat_members_user_pinned_muted_created
  on public.chat_conversation_members (user_id, is_pinned desc, is_muted asc, created_at desc);
