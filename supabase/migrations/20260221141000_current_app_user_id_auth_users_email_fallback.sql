-- Make current_app_user_id resilient when JWT email claim is absent.
-- Falls back to auth.users email by auth.uid().
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
    and lower(u.email::text) = lower(
      coalesce(
        auth.email(),
        auth.jwt() ->> 'email',
        (
          select au.email
          from auth.users au
          where au.id = auth.uid()
          limit 1
        ),
        ''
      )
    )
  limit 1;
$$;

grant execute on function public.current_app_user_id() to anon, authenticated;
