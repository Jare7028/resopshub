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
  created_by_user_id: string;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type PayrollCell = {
  row_id: string;
  column_id: string;
  number_value: number | null;
};

type PayrollDropdownOption = {
  id: string;
  field_type: "job_title" | "contract_type";
  value: string;
  position: number;
};

const payrollRoles = new Set(["admin", "ops", "manager"]);

function toSlug(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

function normalizeFormulaInput(
  rawFormula: string,
  numberColumns: Array<{ key: string; label: string }>
) {
  let expression = rawFormula.trim();
  if (expression.startsWith("=")) {
    expression = expression.slice(1).trim();
  }

  if (!expression) {
    return { formula: "", error: "Formula cannot be empty." };
  }

  const aliases = new Map<string, string>();
  for (const column of numberColumns) {
    const key = column.key.trim();
    const label = column.label.trim();
    if (key) {
      aliases.set(key.toUpperCase(), key);
    }
    if (label) {
      aliases.set(label.toUpperCase(), key);
      aliases.set(label.replace(/\s+/g, "_").toUpperCase(), key);
    }
  }

  const normalized = expression.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (token: string) => {
      const mapped = aliases.get(token.toUpperCase());
      return mapped ? `{${mapped}}` : token;
    }
  );

  const unresolved = normalized.replace(/\{[A-Za-z0-9_]+\}/g, "");
  if (/[A-Za-z]/.test(unresolved)) {
    return {
      formula: "",
      error: "Formula contains unknown column references. Use existing numeric column names.",
    };
  }

  return { formula: normalized, error: null as string | null };
}

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
    .select("id,employee_name,job_title,client_id,contract_type,created_by_user_id,clients(name)")
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

  const rowIds = rows.map((row) => row.id).filter(Boolean);
  const { data: cellValuesRaw } = rowIds.length
    ? await supabase
        .from("employee_payroll_cell_values")
        .select("row_id,column_id,number_value")
        .in("row_id", rowIds)
    : { data: [] as PayrollCell[] };

  const cellValues = (cellValuesRaw || []) as PayrollCell[];

  const cellValueByKey = cellValues.reduce<Record<string, number | null>>((acc, entry) => {
    acc[`${entry.row_id}:${entry.column_id}`] = entry.number_value;
    return acc;
  }, {});

  const numberColumns = columns.filter((column) => column.kind === "number");

  async function createColumn(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) redirect("/login");
    await requirePayrollAccess(currentUser.id);

    const rawLabel = String(formData.get("label") || "").trim();
    const kindRaw = String(formData.get("kind") || "number").trim().toLowerCase();
    const manualFormula = String(formData.get("formula") || "").trim();
    const inlineFormula = rawLabel.startsWith("=") ? rawLabel : "";
    const kind: "number" | "formula" =
      inlineFormula || kindRaw === "formula" ? "formula" : "number";

    if (!rawLabel) {
      redirect("/employee-payroll?error=Column%20label%20is%20required");
    }

    const { data: existingColumnsRaw } = await supabase
      .from("employee_payroll_columns")
      .select("key,label,kind");
    const existingColumns = (existingColumnsRaw || []) as Array<{
      key: string;
      label: string;
      kind: "number" | "formula";
    }>;
    const numberColumns = existingColumns.filter((column) => column.kind === "number");

    const formulaInput = inlineFormula || manualFormula;
    let formula: string | null = null;
    if (kind === "formula") {
      const normalized = normalizeFormulaInput(formulaInput, numberColumns);
      if (normalized.error) {
        redirect(`/employee-payroll?error=${encodeURIComponent(normalized.error)}`);
      }
      formula = normalized.formula;
    }

    const label =
      kind === "formula" && inlineFormula
        ? `Formula ${existingColumns.length + 1}`
        : rawLabel;

    const baseKey = toSlug(label);
    let key = baseKey;
    let suffix = 1;

    while (true) {
      const { data: existing } = await supabase
        .from("employee_payroll_columns")
        .select("id")
        .eq("key", key)
        .maybeSingle();
      if (!existing) break;
      suffix += 1;
      key = `${baseKey}_${suffix}`;
    }

    const { data: last } = await supabase
      .from("employee_payroll_columns")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { error } = await supabase.from("employee_payroll_columns").insert({
      key,
      label,
      kind,
      formula: kind === "formula" ? formula : null,
      position: nextPosition,
    });

    if (error) {
      redirect(`/employee-payroll?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/employee-payroll");
    redirect("/employee-payroll?success=Column%20created");
  }

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

    if (!employeeName) {
      redirect("/employee-payroll?error=Employee%20name%20is%20required");
    }

    const { error } = await supabase.from("employee_payroll_rows").insert({
      employee_name: employeeName,
      job_title: jobTitle || null,
      client_id: clientId || null,
      contract_type: contractType || null,
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
        <form action={createRow} className="mt-4 grid gap-3 md:grid-cols-8">
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
            className="md:col-span-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Contract (N/A)</option>
            {contractTypeOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-1 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Add row
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Payroll rows</h2>
            <details className="group">
              <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 text-lg font-semibold text-slate-700 hover:bg-slate-100">
                +
              </summary>
              <div className="absolute right-6 z-20 mt-2 w-[28rem] rounded-md border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-2 text-xs text-slate-500">
                  Add column. Start with <code>=</code> for formula, e.g.{" "}
                  <code>=SALARY*1.05</code>.
                </p>
                <form action={createColumn} className="grid gap-2 md:grid-cols-6">
                  <input
                    name="label"
                    placeholder="Column label or =FORMULA"
                    className="md:col-span-3 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <select
                    name="kind"
                    defaultValue="number"
                    className="md:col-span-3 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="number">Number</option>
                    <option value="formula">Formula</option>
                  </select>
                  <input
                    name="formula"
                    placeholder="Formula (for formula type)"
                    className="md:col-span-6 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="md:col-span-6 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Add column
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>

        <PayrollRowsTable
          rows={rows}
          columns={columns}
          numberColumns={numberColumns}
          cellValueByKey={cellValueByKey}
          clients={clients}
          jobTitleOptions={jobTitleOptions}
          contractTypeOptions={contractTypeOptions}
          onDeleteRow={deleteRow}
        />
      </section>
    </div>
  );
}
