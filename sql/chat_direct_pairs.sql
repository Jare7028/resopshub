-- Canonical direct-chat pair mapping.
-- Run this after sql/chat.sql.

create table if not exists public.chat_direct_pairs (
  conversation_id uuid primary key references public.chat_conversations(id) on delete cascade,
  user_low_id uuid not null references public.users(id) on delete cascade,
  user_high_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_direct_pairs_distinct_users check (user_low_id <> user_high_id),
  constraint chat_direct_pairs_ordered_users check (user_low_id::text < user_high_id::text)
);

create unique index if not exists chat_direct_pairs_user_pair_key
  on public.chat_direct_pairs (user_low_id, user_high_id);

alter table public.chat_direct_pairs enable row level security;

drop policy if exists chat_direct_pairs_select on public.chat_direct_pairs;
create policy chat_direct_pairs_select
  on public.chat_direct_pairs
  for select
  to authenticated
  using (public.can_access_chat_conversation(conversation_id));

drop policy if exists chat_direct_pairs_insert on public.chat_direct_pairs;
create policy chat_direct_pairs_insert
  on public.chat_direct_pairs
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.can_access_chat_conversation(conversation_id)
    and (
      user_low_id = auth.uid()
      or user_high_id = auth.uid()
      or public.is_admin()
    )
  );

grant select, insert on table public.chat_direct_pairs to authenticated;

with direct_member_pairs as (
  select
    c.id as conversation_id,
    c.created_at,
    min(m.user_id::text) as user_low_id_text,
    max(m.user_id::text) as user_high_id_text,
    count(*) as member_count
  from public.chat_conversations c
  join public.chat_conversation_members m on m.conversation_id = c.id
  where c.type = 'direct'
  group by c.id, c.created_at
),
ranked_pairs as (
  select
    conversation_id,
    user_low_id_text::uuid as user_low_id,
    user_high_id_text::uuid as user_high_id,
    row_number() over (
      partition by user_low_id_text, user_high_id_text
      order by created_at desc, conversation_id desc
    ) as pair_rank
  from direct_member_pairs
  where member_count = 2
)
insert into public.chat_direct_pairs (conversation_id, user_low_id, user_high_id)
select conversation_id, user_low_id, user_high_id
from ranked_pairs
where pair_rank = 1
on conflict (user_low_id, user_high_id) do nothing;
