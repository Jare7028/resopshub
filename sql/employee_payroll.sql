-- Employee payroll teardown.
-- Apply in Supabase SQL editor to remove the payroll feature schema.

do $$
begin
  if to_regprocedure('public.can_access_employee_payroll()') is not null then
    revoke execute on function public.can_access_employee_payroll() from anon, authenticated;
  end if;

  if to_regprocedure('public.can_view_employee_payroll_row(uuid)') is not null then
    revoke execute on function public.can_view_employee_payroll_row(uuid) from anon, authenticated;
  end if;

  if to_regprocedure('public.can_edit_employee_payroll_row(uuid)') is not null then
    revoke execute on function public.can_edit_employee_payroll_row(uuid) from anon, authenticated;
  end if;
end
$$;

drop table if exists public.employee_payroll_cell_values cascade;
drop table if exists public.employee_payroll_row_users cascade;
drop table if exists public.employee_payroll_columns cascade;
drop table if exists public.employee_payroll_dropdown_options cascade;
drop table if exists public.employee_payroll_rows cascade;

drop function if exists public.can_edit_employee_payroll_row(uuid) cascade;
drop function if exists public.can_view_employee_payroll_row(uuid) cascade;
drop function if exists public.can_access_employee_payroll() cascade;
