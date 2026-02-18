create table if not exists public.task_email_sources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  provider text not null default 'outlook',
  selected_message_id text not null,
  internet_message_id text null,
  conversation_id text null,
  mailbox_email text not null,
  imported_by_user_id uuid not null,
  thread_message_count int not null,
  attachment_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_email_sources_selected_msg_idx
  on public.task_email_sources (selected_message_id);

create index if not exists task_email_sources_conversation_idx
  on public.task_email_sources (conversation_id);

create index if not exists task_email_sources_task_idx
  on public.task_email_sources (task_id);

alter table public.task_email_sources enable row level security;

grant select, insert on table public.task_email_sources to authenticated;

drop policy if exists task_email_sources_select on public.task_email_sources;
create policy task_email_sources_select
  on public.task_email_sources
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.can_access_task(task_id)
  );

drop policy if exists task_email_sources_insert on public.task_email_sources;
create policy task_email_sources_insert
  on public.task_email_sources
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.can_access_task(task_id)
    and imported_by_user_id in (auth.uid(), public.current_app_user_id())
  );

