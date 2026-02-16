-- Aggregate unread chat counts in a single query.
-- Run after sql/chat.sql.

create or replace function public.chat_unread_counts()
returns table (
  conversation_id uuid,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.conversation_id,
    coalesce(count(msg.id), 0)::bigint as unread_count
  from public.chat_conversation_members m
  left join public.chat_messages msg
    on msg.conversation_id = m.conversation_id
   and msg.sender_id <> m.user_id
   and (m.last_read_at is null or msg.created_at > m.last_read_at)
   and msg.deleted_at is null
  where m.user_id = auth.uid()
  group by m.conversation_id
$$;

grant execute on function public.chat_unread_counts() to authenticated;
