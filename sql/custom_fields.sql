-- Configurable custom fields for client/project/task details.
-- Apply in Supabase SQL editor.

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('client', 'project', 'task')),
  key text not null,
  label text not null,
  field_kind text not null check (field_kind in ('text', 'dropdown')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_fields_label_not_blank check (length(trim(label)) > 0),
  constraint custom_fields_key_not_blank check (length(trim(key)) > 0),
  constraint custom_fields_entity_key_unique unique (entity_type, key)
);

create index if not exists custom_fields_entity_position_idx
  on public.custom_fields (entity_type, position, label);

create table if not exists public.custom_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  value text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_field_options_value_not_blank check (length(trim(value)) > 0)
);

create unique index if not exists custom_field_options_value_uidx
  on public.custom_field_options (field_id, lower(value));

create index if not exists custom_field_options_field_position_idx
  on public.custom_field_options (field_id, position, value);

create table if not exists public.custom_field_values (
  entity_type text not null check (entity_type in ('client', 'project', 'task')),
  entity_id uuid not null,
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  text_value text,
  option_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id, field_id),
  constraint custom_field_values_has_value
    check (
      (text_value is not null and option_value is null)
      or (text_value is null and option_value is not null)
    )
);

create index if not exists custom_field_values_entity_idx
  on public.custom_field_values (entity_type, entity_id);

create or replace function public.validate_custom_field_value()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  field_entity text;
  field_kind text;
  option_exists boolean;
begin
  select f.entity_type, f.field_kind
  into field_entity, field_kind
  from public.custom_fields f
  where f.id = new.field_id;

  if field_entity is null then
    raise exception 'custom field does not exist';
  end if;

  if new.entity_type <> field_entity then
    raise exception 'entity type does not match custom field type';
  end if;

  if field_kind = 'text' then
    if new.text_value is null or length(trim(new.text_value)) = 0 then
      raise exception 'text custom field requires text_value';
    end if;
    new.option_value := null;
  else
    if new.option_value is null or length(trim(new.option_value)) = 0 then
      raise exception 'dropdown custom field requires option_value';
    end if;

    select exists (
      select 1
      from public.custom_field_options o
      where o.field_id = new.field_id
        and o.value = new.option_value
    )
    into option_exists;

    if not option_exists then
      raise exception 'dropdown option does not exist for this field';
    end if;

    new.text_value := null;
  end if;

  return new;
end;
$$;

drop trigger if exists custom_field_values_validate on public.custom_field_values;
create trigger custom_field_values_validate
before insert or update on public.custom_field_values
for each row execute function public.validate_custom_field_value();

create or replace function public.can_manage_status_and_custom_settings()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and coalesce(u.status, 'active') <> 'disabled'
      and u.role in ('admin', 'ops', 'manager')
  );
$$;

grant execute on function public.can_manage_status_and_custom_settings() to anon, authenticated;

create or replace function public.can_access_custom_field_entity(
  entity_kind text,
  entity_uuid uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select auth.uid() is not null and case
    when entity_kind = 'client' then public.can_access_client(entity_uuid)
    when entity_kind = 'task' then public.can_access_task(entity_uuid)
    when entity_kind = 'project' then public.can_access_project_base(entity_uuid)
    else false
  end
$$;

grant execute on function public.can_access_custom_field_entity(text, uuid) to anon, authenticated;

alter table public.custom_fields enable row level security;
alter table public.custom_field_options enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_fields_select on public.custom_fields;
create policy custom_fields_select
  on public.custom_fields
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists custom_fields_insert on public.custom_fields;
create policy custom_fields_insert
  on public.custom_fields
  for insert
  to authenticated
  with check (public.can_manage_status_and_custom_settings());

drop policy if exists custom_fields_update on public.custom_fields;
create policy custom_fields_update
  on public.custom_fields
  for update
  to authenticated
  using (public.can_manage_status_and_custom_settings())
  with check (public.can_manage_status_and_custom_settings());

drop policy if exists custom_fields_delete on public.custom_fields;
create policy custom_fields_delete
  on public.custom_fields
  for delete
  to authenticated
  using (public.can_manage_status_and_custom_settings());

drop policy if exists custom_field_options_select on public.custom_field_options;
create policy custom_field_options_select
  on public.custom_field_options
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists custom_field_options_insert on public.custom_field_options;
create policy custom_field_options_insert
  on public.custom_field_options
  for insert
  to authenticated
  with check (public.can_manage_status_and_custom_settings());

drop policy if exists custom_field_options_update on public.custom_field_options;
create policy custom_field_options_update
  on public.custom_field_options
  for update
  to authenticated
  using (public.can_manage_status_and_custom_settings())
  with check (public.can_manage_status_and_custom_settings());

drop policy if exists custom_field_options_delete on public.custom_field_options;
create policy custom_field_options_delete
  on public.custom_field_options
  for delete
  to authenticated
  using (public.can_manage_status_and_custom_settings());

drop policy if exists custom_field_values_select on public.custom_field_values;
create policy custom_field_values_select
  on public.custom_field_values
  for select
  to authenticated
  using (
    public.can_access_custom_field_entity(entity_type, entity_id)
  );

drop policy if exists custom_field_values_insert on public.custom_field_values;
create policy custom_field_values_insert
  on public.custom_field_values
  for insert
  to authenticated
  with check (
    public.can_access_custom_field_entity(entity_type, entity_id)
  );

drop policy if exists custom_field_values_update on public.custom_field_values;
create policy custom_field_values_update
  on public.custom_field_values
  for update
  to authenticated
  using (
    public.can_access_custom_field_entity(entity_type, entity_id)
  )
  with check (
    public.can_access_custom_field_entity(entity_type, entity_id)
  );

drop policy if exists custom_field_values_delete on public.custom_field_values;
create policy custom_field_values_delete
  on public.custom_field_values
  for delete
  to authenticated
  using (
    public.can_access_custom_field_entity(entity_type, entity_id)
  );

grant select, insert, update, delete on table public.custom_fields to authenticated;
grant select, insert, update, delete on table public.custom_field_options to authenticated;
grant select, insert, update, delete on table public.custom_field_values to authenticated;
