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
