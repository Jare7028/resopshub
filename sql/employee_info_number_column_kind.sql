-- Add "number" as a supported employee_info_columns.column_kind value.
-- Run after sql/employee_info.sql if your database already has employee_info_columns.

alter table public.employee_info_columns
  drop constraint if exists employee_info_columns_column_kind_check;

alter table public.employee_info_columns
  add constraint employee_info_columns_column_kind_check
  check (column_kind in ('text', 'dropdown', 'formula', 'number'));
