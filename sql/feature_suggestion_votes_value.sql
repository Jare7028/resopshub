-- Add support for both upvotes (+1) and downvotes (-1) on feature suggestions.

alter table public.feature_suggestion_votes
  add column if not exists value smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feature_suggestion_votes_value_check'
  ) then
    alter table public.feature_suggestion_votes
      add constraint feature_suggestion_votes_value_check
      check (value in (-1, 1));
  end if;
end $$;

alter table public.feature_suggestion_votes enable row level security;

drop policy if exists feature_suggestion_votes_select_authenticated on public.feature_suggestion_votes;
create policy feature_suggestion_votes_select_authenticated
  on public.feature_suggestion_votes
  for select
  using (auth.uid() is not null);

drop policy if exists feature_suggestion_votes_insert_own on public.feature_suggestion_votes;
create policy feature_suggestion_votes_insert_own
  on public.feature_suggestion_votes
  for insert
  with check (auth.uid() = user_id and value in (-1, 1));

drop policy if exists feature_suggestion_votes_update_own on public.feature_suggestion_votes;
create policy feature_suggestion_votes_update_own
  on public.feature_suggestion_votes
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and value in (-1, 1));

drop policy if exists feature_suggestion_votes_delete_own on public.feature_suggestion_votes;
create policy feature_suggestion_votes_delete_own
  on public.feature_suggestion_votes
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.feature_suggestion_votes to authenticated;

