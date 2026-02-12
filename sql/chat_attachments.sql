-- Chat message image attachments and storage access.
-- Apply in Supabase SQL editor.

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists chat_message_attachments_message_id_idx
  on public.chat_message_attachments (message_id, created_at);

alter table public.chat_message_attachments enable row level security;

drop policy if exists chat_message_attachments_select on public.chat_message_attachments;
create policy chat_message_attachments_select
  on public.chat_message_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_attachments_insert on public.chat_message_attachments;
create policy chat_message_attachments_insert
  on public.chat_message_attachments
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and m.sender_id = auth.uid()
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_attachments_delete on public.chat_message_attachments;
create policy chat_message_attachments_delete
  on public.chat_message_attachments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and (m.sender_id = auth.uid() or public.is_admin())
    )
  );

grant select, insert, delete on table public.chat_message_attachments to authenticated;

-- Storage bucket for chat attachments.
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do update set public = excluded.public;

grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to authenticated;

drop policy if exists chat_attachments_select on storage.objects;
create policy chat_attachments_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and auth.uid() is not null
    and public.can_access_chat_conversation(split_part(name, '/', 1)::uuid)
  );

drop policy if exists chat_attachments_insert on storage.objects;
create policy chat_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and auth.uid() is not null
    and split_part(name, '/', 2) = auth.uid()::text
    and public.can_access_chat_conversation(split_part(name, '/', 1)::uuid)
  );

drop policy if exists chat_attachments_update on storage.objects;
create policy chat_attachments_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and auth.uid() is not null
    and (
      owner = auth.uid()
      or public.is_admin()
    )
  )
  with check (
    bucket_id = 'chat-attachments'
    and auth.uid() is not null
    and (
      owner = auth.uid()
      or public.is_admin()
    )
  );

drop policy if exists chat_attachments_delete on storage.objects;
create policy chat_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and auth.uid() is not null
    and (
      owner = auth.uid()
      or public.is_admin()
    )
  );

