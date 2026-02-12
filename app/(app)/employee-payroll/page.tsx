import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PayrollRowsTable from "./PayrollRowsTable";

type PayrollColumn = {
  id: string;
  key: string;
  label: string;
  kind: "number" | "formula";
  formula: string | null;
  position: number;
};

type PayrollRow = {
  id: string;
  employee_name: string;
  job_title: string | null;
  client_id: string | null;
  contract_type: string | null;
  billable: string | null;
  created_by_user_id: string;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type PayrollCell = {
  row_id: string;
  column_id: string;
  text_value: string | null;
  number_value: number | null;
};

type PayrollDropdownOption = {
  id: string;
  field_type: "job_title" | "contract_type" | "billable";
  value: string;
  position: number;
};

const payrollRoles = new Set(["admin", "ops", "manager"]);

async function requirePayrollAccess(userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("users")
    .select("id,role,status")
    .eq("id", userId)
    .maybeSingle();

  if (
    !profile ||
    profile.status === "disabled" ||
    !payrollRoles.has(String(profile.role || ""))
  ) {
    redirect("/clients");
  }

  return supabase;
}

export default async function EmployeePayrollPage(props: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  await requirePayrollAccess(user.id);

  const { data: clientsRaw } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const { data: columnsRaw } = await supabase
    .from("employee_payroll_columns")
    .select("id,key,label,kind,formula,position")
    .order("position", { ascending: true });

  const { data: rowsRaw } = await supabase
    .from("employee_payroll_rows")
    .select(
      "id,employee_name,job_title,client_id,contract_type,billable,created_by_user_id,clients(name)"
    )
    .order("created_at", { ascending: false });

  const { data: dropdownOptionsRaw, error: dropdownOptionsError } = await supabase
    .from("employee_payroll_dropdown_options")
    .select("id,field_type,value,position")
    .order("field_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;
  const columns = (columnsRaw || []) as PayrollColumn[];
  const rows = (rowsRaw || []) as PayrollRow[];
  const dropdownOptions = (dropdownOptionsError ? [] : dropdownOptionsRaw || []) as PayrollDropdownOption[];
  const jobTitleOptions = dropdownOptions.filter((option) => option.field_type === "job_title");
  const contractTypeOptions = dropdownOptions.filter(
    (option) => option.field_type === "contract_type"
  );
  const billableOptions = dropdownOptions.filter((option) => option.field_type === "billable");

  const rowIds = rows.map((row) => row.id).filter(Boolean);
  const { data: cellValuesRaw } = rowIds.length
    ? await supabase
        .from("employee_payroll_cell_values")
        .select("row_id,column_id,text_value,number_value")
        .in("row_id", rowIds)
    : { data: [] as PayrollCell[] };

  const cellValues = (cellValuesRaw || []) as PayrollCell[];

  const cellValueByKey = cellValues.reduce<Record<string, string>>((acc, entry) => {
    const value =
      entry.text_value ??
      (entry.number_value === null || entry.number_value === undefined
        ? ""
        : String(entry.number_value));
    acc[`${entry.row_id}:${entry.column_id}`] = value;
    return acc;
  }, {});

  async function createRow(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) redirect("/login");
    await requirePayrollAccess(currentUser.id);

    const employeeName = String(formData.get("employee_name") || "").trim();
    const jobTitle = String(formData.get("job_title") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    const contractType = String(formData.get("contract_type") || "").trim();
    const billable = String(formData.get("billable") || "").trim();

    if (!employeeName) {
      redirect("/employee-payroll?error=Employee%20name%20is%20required");
    }

    const { error } = await supabase.from("employee_payroll_rows").insert({
      employee_name: employeeName,
      job_title: jobTitle || null,
      client_id: clientId || null,
      contract_type: contractType || null,
      billable: billable || null,
      created_by_user_id: currentUser.id,
    });

    if (error) {
      redirect(`/employee-payroll?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/employee-payroll");
    redirect("/employee-payroll?success=Row%20created");
  }

  async function deleteRow(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) redirect("/login");
    await requirePayrollAccess(currentUser.id);

    const rowId = String(formData.get("row_id") || "").trim();
    if (!rowId) {
      redirect("/employee-payroll?error=Missing%20row%20id");
    }

    const { error } = await supabase.from("employee_payroll_rows").delete().eq("id", rowId);

    if (error) {
      redirect(`/employee-payroll?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/employee-payroll");
    redirect("/employee-payroll?success=Row%20deleted");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Employee Payroll</h1>
        <p className="text-sm text-slate-600">
          Store payroll inputs by employee with flexible numeric and formula columns.
        </p>
      </section>

      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add employee row</h2>
        <form action={createRow} className="mt-4 grid gap-3 md:grid-cols-10">
          <input
            name="employee_name"
            placeholder="Employee name"
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="job_title"
            defaultValue=""
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Job title (N/A)</option>
            {jobTitleOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          <select
            name="client_id"
            defaultValue=""
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Client (N/A)</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="contract_type"
            defaultValue=""
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Contract (N/A)</option>
            {contractTypeOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          <select
            name="billable"
            defaultValue=""
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Billable (N/A)</option>
            {billableOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-2 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Add row
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Payroll rows</h2>
        </div>

        <PayrollRowsTable
          rows={rows}
          columns={columns}
          cellValueByKey={cellValueByKey}
          clients={clients}
          jobTitleOptions={jobTitleOptions}
          contractTypeOptions={contractTypeOptions}
          billableOptions={billableOptions}
          onDeleteRow={deleteRow}
        />
      </section>
    </div>
  );
}
