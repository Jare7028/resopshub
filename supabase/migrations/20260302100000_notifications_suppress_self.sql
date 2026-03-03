-- Suppress self-notifications globally: actor should not be notified about their own actions.

create or replace function public.suppress_self_notifications()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.actor_user_id is not null and new.actor_user_id = new.user_id then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_suppress_self_insert on public.notifications;
create trigger notifications_suppress_self_insert
before insert on public.notifications
for each row
execute function public.suppress_self_notifications();
