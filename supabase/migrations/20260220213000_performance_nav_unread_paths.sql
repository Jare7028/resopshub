-- Performance optimizations for global nav unread lookups.
-- Run after:
--   sql/chat.sql
--   sql/chat_unread_counts.sql
--   sql/notifications.sql

do $$
begin
  if to_regclass('public.chat_conversation_members') is not null then
    execute 'create index if not exists idx_chat_conversation_members_user_conversation_last_read
      on public.chat_conversation_members (user_id, conversation_id, last_read_at)';
  end if;

  if to_regclass('public.chat_messages') is not null then
    execute 'create index if not exists idx_chat_messages_conversation_created_visible
      on public.chat_messages (conversation_id, created_at desc)
      where deleted_at is null';
  end if;

  if to_regclass('public.notifications') is not null then
    execute 'create index if not exists idx_notifications_user_unread_created_at_partial
      on public.notifications (user_id, created_at desc)
      where read_at is null';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.chat_conversation_members') is not null
     and to_regclass('public.chat_messages') is not null then
    execute $fn$
      create or replace function public.chat_unread_counts()
      returns table (
        conversation_id uuid,
        unread_count bigint
      )
      language sql
      stable
      security definer
      set search_path = public
      as $body$
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
      $body$;
    $fn$;

    execute 'grant execute on function public.chat_unread_counts() to authenticated';

    execute $fn$
      create or replace function public.chat_total_unread_count()
      returns bigint
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select coalesce(sum(unread.unread_count), 0)::bigint
        from public.chat_unread_counts() unread
      $body$;
    $fn$;

    execute 'grant execute on function public.chat_total_unread_count() to authenticated';
  end if;
end
$$;
