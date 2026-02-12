-- Employee payroll teardown.
-- Apply in Supabase SQL editor to remove the payroll feature schema.

revoke execute on function if exists public.can_access_employee_payroll() from anon, authenticated;
revoke execute on function if exists public.can_view_employee_payroll_row(uuid) from anon, authenticated;
revoke execute on function if exists public.can_edit_employee_payroll_row(uuid) from anon, authenticated;

drop function if exists public.can_edit_employee_payroll_row(uuid);
drop function if exists public.can_view_employee_payroll_row(uuid);
drop function if exists public.can_access_employee_payroll();

drop table if exists public.employee_payroll_cell_values cascade;
drop table if exists public.employee_payroll_row_users cascade;
drop table if exists public.employee_payroll_columns cascade;
drop table if exists public.employee_payroll_dropdown_options cascade;
drop table if exists public.employee_payroll_rows cascade;
