alter table tasks
  add column if not exists content jsonb;

alter table tasks
  alter column content set default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;

update tasks
set content = '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
where content is null;
