create table if not exists project_users (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_users_user_id_idx on project_users (user_id);
