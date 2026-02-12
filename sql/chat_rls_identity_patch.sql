-- Align chat RLS with app user identity (public.users.id) as well as auth.uid().

drop policy if exists chat_conversations_insert on public.chat_conversations;
create policy chat_conversations_insert
  on public.chat_conversations
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      created_by = auth.uid()
      or created_by = public.current_app_user_id()
    )
  );

drop policy if exists chat_conversation_members_insert on public.chat_conversation_members;
create policy chat_conversation_members_insert
  on public.chat_conversation_members
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or user_id = public.current_app_user_id()
      or public.can_access_chat_conversation(conversation_id)
      or public.is_admin()
    )
  );

