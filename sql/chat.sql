-- Team chat (direct + group) with structured app links.
-- Apply in Supabase SQL editor.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  last_read_at timestamptz not null default now(),
  is_pinned boolean not null default false,
  is_muted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.chat_conversation_members
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_muted boolean not null default false;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.chat_message_links (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  entity_type text not null check (entity_type in ('task', 'project', 'feature_suggestion', 'note', 'client')),
  entity_id uuid not null,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_conversation_members_user_id_idx
  on public.chat_conversation_members (user_id, created_at desc);

create index if not exists idx_chat_members_user_pinned_muted_created
  on public.chat_conversation_members (user_id, is_pinned desc, is_muted asc, created_at desc);

create index if not exists chat_messages_conversation_created_at_idx
  on public.chat_messages (conversation_id, created_at desc);

create index if not exists chat_message_links_message_id_idx
  on public.chat_message_links (message_id);

create or replace function public.can_access_chat_conversation(conversation_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = conversation_uuid
      and m.user_id = auth.uid()
  ) or public.is_admin();
$$;

grant execute on function public.can_access_chat_conversation(uuid) to anon, authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_links enable row level security;

drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select
  on public.chat_conversations
  for select
  to authenticated
  using (public.can_access_chat_conversation(id));

drop policy if exists chat_conversations_insert on public.chat_conversations;
create policy chat_conversations_insert
  on public.chat_conversations
  for insert
  to authenticated
  with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists chat_conversations_update on public.chat_conversations;
create policy chat_conversations_update
  on public.chat_conversations
  for update
  to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
  )
  with check (
    public.is_admin()
    or created_by = auth.uid()
  );

drop policy if exists chat_conversations_delete on public.chat_conversations;
create policy chat_conversations_delete
  on public.chat_conversations
  for delete
  to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
  );

drop policy if exists chat_conversation_members_select on public.chat_conversation_members;
create policy chat_conversation_members_select
  on public.chat_conversation_members
  for select
  to authenticated
  using (public.can_access_chat_conversation(conversation_id));

drop policy if exists chat_conversation_members_insert on public.chat_conversation_members;
create policy chat_conversation_members_insert
  on public.chat_conversation_members
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or public.can_access_chat_conversation(conversation_id)
      or public.is_admin()
    )
  );

drop policy if exists chat_conversation_members_update on public.chat_conversation_members;
create policy chat_conversation_members_update
  on public.chat_conversation_members
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_access_chat_conversation(conversation_id)
    or public.is_admin()
  )
  with check (
    user_id = auth.uid()
    or public.can_access_chat_conversation(conversation_id)
    or public.is_admin()
  );

drop policy if exists chat_conversation_members_delete on public.chat_conversation_members;
create policy chat_conversation_members_delete
  on public.chat_conversation_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_access_chat_conversation(conversation_id)
    or public.is_admin()
  );

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select
  on public.chat_messages
  for select
  to authenticated
  using (public.can_access_chat_conversation(conversation_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert
  on public.chat_messages
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and sender_id = auth.uid()
    and public.can_access_chat_conversation(conversation_id)
  );

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update
  on public.chat_messages
  for update
  to authenticated
  using (
    sender_id = auth.uid()
    or public.is_admin()
  )
  with check (
    sender_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete
  on public.chat_messages
  for delete
  to authenticated
  using (
    sender_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists chat_message_links_select on public.chat_message_links;
create policy chat_message_links_select
  on public.chat_message_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_links.message_id
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_links_insert on public.chat_message_links;
create policy chat_message_links_insert
  on public.chat_message_links
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_links.message_id
        and m.sender_id = auth.uid()
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );

drop policy if exists chat_message_links_update on public.chat_message_links;
create policy chat_message_links_update
  on public.chat_message_links
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_links.message_id
        and (m.sender_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_links.message_id
        and (m.sender_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists chat_message_links_delete on public.chat_message_links;
create policy chat_message_links_delete
  on public.chat_message_links
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      where m.id = chat_message_links.message_id
        and (m.sender_id = auth.uid() or public.is_admin())
    )
  );

grant select, insert, update, delete on table public.chat_conversations to authenticated;
grant select, insert, update, delete on table public.chat_conversation_members to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;
grant select, insert, update, delete on table public.chat_message_links to authenticated;
