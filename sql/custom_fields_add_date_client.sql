-- Extend custom field kinds with date + client selectors.
-- Run this on existing environments that already ran sql/custom_fields.sql.

alter table public.custom_fields
  drop constraint if exists custom_fields_field_kind_check;

alter table public.custom_fields
  add constraint custom_fields_field_kind_check
  check (field_kind in ('text', 'dropdown', 'date', 'client'));

create or replace function public.validate_custom_field_value()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  field_entity text;
  field_entity_id uuid;
  field_kind text;
  option_exists boolean;
begin
  select f.entity_type, f.entity_id, f.field_kind
  into field_entity, field_entity_id, field_kind
  from public.custom_fields f
  where f.id = new.field_id;

  if field_entity is null then
    raise exception 'custom field does not exist';
  end if;

  if new.entity_type <> field_entity then
    raise exception 'entity type does not match custom field type';
  end if;

  if field_entity_id is not null and new.entity_id <> field_entity_id then
    raise exception 'entity id does not match custom field scope';
  end if;

  if field_kind = 'text' or field_kind = 'date' then
    if new.text_value is null or length(trim(new.text_value)) = 0 then
      raise exception 'text/date custom field requires text_value';
    end if;
    if field_kind = 'date' and not (new.text_value ~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'date custom field must use YYYY-MM-DD format';
    end if;
    new.option_value := null;
  elsif field_kind = 'client' then
    if new.text_value is null or length(trim(new.text_value)) = 0 then
      raise exception 'client custom field requires text_value';
    end if;
    if not exists (
      select 1
      from public.clients c
      where c.id::text = new.text_value
    ) then
      raise exception 'client custom field value must match an existing client id';
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
