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
    (
      select count(*)::bigint
      from public.chat_messages msg
      where msg.conversation_id = m.conversation_id
        and msg.deleted_at is null
        and msg.sender_id <> m.user_id
        and (m.last_read_at is null or msg.created_at > m.last_read_at)
    ) as unread_count
  from public.chat_conversation_members m
  where m.user_id = auth.uid()
$$;

grant execute on function public.chat_unread_counts() to authenticated;

create or replace function public.chat_total_unread_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(unread.unread_count), 0)::bigint
  from public.chat_unread_counts() unread
$$;

grant execute on function public.chat_total_unread_count() to authenticated;
