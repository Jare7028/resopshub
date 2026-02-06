create table if not exists feature_suggestions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  status text not null default 'idea',
  created_by uuid references users(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create table if not exists feature_suggestion_votes (
  suggestion_id uuid not null references feature_suggestions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (suggestion_id, user_id)
);

create index if not exists feature_suggestion_votes_user_id_idx on feature_suggestion_votes (user_id);

alter table feature_suggestions
  add column if not exists status text not null default 'idea';

-- Comments on feature suggestions (visible to all authenticated users).
create table if not exists feature_suggestion_comments (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references feature_suggestions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists feature_suggestion_comments_suggestion_created_at_idx
  on feature_suggestion_comments (suggestion_id, created_at);

create index if not exists feature_suggestion_comments_user_id_idx
  on feature_suggestion_comments (user_id);

alter table feature_suggestion_comments enable row level security;

drop policy if exists feature_suggestion_comments_select_all on feature_suggestion_comments;
create policy feature_suggestion_comments_select_all
  on feature_suggestion_comments
  for select
  using (auth.uid() is not null);

drop policy if exists feature_suggestion_comments_insert_own on feature_suggestion_comments;
create policy feature_suggestion_comments_insert_own
  on feature_suggestion_comments
  for insert
  with check (auth.uid() = user_id);

grant select, insert on feature_suggestion_comments to authenticated;
