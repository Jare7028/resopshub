-- Performance indexes for employee info / inventory table pages.
-- Focus areas:
-- 1) newest-first record listing without client filters
-- 2) role/value lookups by (column_id, record_id)
-- 3) large-name-list ordering for typeahead sources

create index if not exists employee_info_records_created_at_desc_idx
  on public.employee_info_records(created_at desc);

create index if not exists inventory_records_created_at_desc_idx
  on public.inventory_records(created_at desc);

create index if not exists employee_info_records_full_name_idx
  on public.employee_info_records(full_name);

create index if not exists inventory_records_full_name_idx
  on public.inventory_records(full_name);

create index if not exists employee_info_values_column_record_idx
  on public.employee_info_values(column_id, record_id);

create index if not exists inventory_values_column_record_idx
  on public.inventory_values(column_id, record_id);
