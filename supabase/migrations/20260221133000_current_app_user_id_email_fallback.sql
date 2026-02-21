-- Make identity mapping robust for sessions where JWT email claim is missing.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select u.id
  from public.users u
  where auth.uid() is not null
    and lower(u.email::text) = lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''))
  limit 1;
$$;

grant execute on function public.current_app_user_id() to anon, authenticated;
