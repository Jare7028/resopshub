alter table personal_pages
  add column if not exists content_text text;

alter table tasks
  add column if not exists content_text text;

alter table personal_pages
  alter column content_text set default '';

alter table tasks
  alter column content_text set default '';

update personal_pages
set content_text = coalesce(content_text, content::text)
where content_text is null;

update tasks
set content_text = coalesce(content_text, content::text)
where content_text is null;
