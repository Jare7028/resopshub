-- Chat message emoji reactions.
-- Apply in Supabase SQL editor.

create table if not exists public.chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists chat_message_reactions_message_id_idx
  on public.chat_message_reactions (message_id, created_at);

create index if not exists chat_message_reactions_user_id_idx
  on public.chat_message_reactions (user_id, created_at);

alter table public.chat_message_reactions enable row level security;

drop policy if exists chat_message_reactions_select on public.chat_message_reactions;
create policy chat_message_reactions_select
  on public.chat_message_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_reactions.message_id
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_reactions_insert on public.chat_message_reactions;
create policy chat_message_reactions_insert
  on public.chat_message_reactions
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and user_id = auth.uid()
    and exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_reactions.message_id
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_reactions_delete on public.chat_message_reactions;
create policy chat_message_reactions_delete
  on public.chat_message_reactions
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
  );

grant select, insert, delete on table public.chat_message_reactions to authenticated;

