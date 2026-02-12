import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  client_id: string | null;
  created_by_user_id: string;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type PayrollCell = {
  row_id: string;
  column_id: string;
  number_value: number | null;
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

function evaluateFormula(formula: string | null, valuesByColumnKey: Record<string, number>) {
  if (!formula) return null;

  const expression = formula.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = valuesByColumnKey[key] ?? 0;
    return Number.isFinite(value) ? String(value) : "0";
  });

  if (/[^0-9+\-*/().\s]/.test(expression)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function formatMoneyLike(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(2);
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
  searchParams?: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const searchParams = await props.searchParams;
  const editRowId = String(searchParams?.edit || "").trim();
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
    .select("id,employee_name,client_id,created_by_user_id,clients(name)")
    .order("created_at", { ascending: false });

  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;
  const columns = (columnsRaw || []) as PayrollColumn[];
  const rows = (rowsRaw || []) as PayrollRow[];

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
  const activeEditRow = rows.find((row) => row.id === editRowId) || null;

  async function createColumn(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) redirect("/login");
    await requirePayrollAccess(currentUser.id);

    const label = String(formData.get("label") || "").trim();
    const kindRaw = String(formData.get("kind") || "number").trim().toLowerCase();
    const kind: "number" | "formula" = kindRaw === "formula" ? "formula" : "number";
    const formula = String(formData.get("formula") || "").trim();

    if (!label) {
      redirect("/employee-payroll?error=Column%20label%20is%20required");
    }

    if (kind === "formula" && !formula) {
      redirect("/employee-payroll?error=Formula%20is%20required%20for%20formula%20columns");
    }

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
    const clientId = String(formData.get("client_id") || "").trim();

    if (!employeeName) {
      redirect("/employee-payroll?error=Employee%20name%20is%20required");
    }

    const { error } = await supabase.from("employee_payroll_rows").insert({
      employee_name: employeeName,
      client_id: clientId || null,
      created_by_user_id: currentUser.id,
    });

    if (error) {
      redirect(`/employee-payroll?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/employee-payroll");
    redirect("/employee-payroll?success=Row%20created");
  }

  async function saveRow(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) redirect("/login");
    await requirePayrollAccess(currentUser.id);

    const rowId = String(formData.get("row_id") || "").trim();
    const employeeName = String(formData.get("employee_name") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();

    if (!rowId || !employeeName) {
      redirect("/employee-payroll?error=Row%20update%20is%20missing%20required%20fields");
    }

    const { error: rowError } = await supabase
      .from("employee_payroll_rows")
      .update({
        employee_name: employeeName,
        client_id: clientId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);

    if (rowError) {
      redirect(`/employee-payroll?edit=${encodeURIComponent(rowId)}&error=${encodeURIComponent(rowError.message)}`);
    }

    for (const column of numberColumns) {
      const rawValue = String(formData.get(`col_${column.id}`) || "").trim();
      if (!rawValue) {
        const { error: deleteError } = await supabase
          .from("employee_payroll_cell_values")
          .delete()
          .eq("row_id", rowId)
          .eq("column_id", column.id);
        if (deleteError) {
          redirect(`/employee-payroll?edit=${encodeURIComponent(rowId)}&error=${encodeURIComponent(deleteError.message)}`);
        }
        continue;
      }

      const parsedValue = Number(rawValue);
      if (!Number.isFinite(parsedValue)) {
        redirect(`/employee-payroll?edit=${encodeURIComponent(rowId)}&error=Cell%20values%20must%20be%20numeric`);
      }

      const { error: upsertError } = await supabase
        .from("employee_payroll_cell_values")
        .upsert(
          {
            row_id: rowId,
            column_id: column.id,
            number_value: parsedValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "row_id,column_id" }
        );

      if (upsertError) {
        redirect(`/employee-payroll?edit=${encodeURIComponent(rowId)}&error=${encodeURIComponent(upsertError.message)}`);
      }
    }

    revalidatePath("/employee-payroll");
    redirect("/employee-payroll?success=Row%20saved");
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
        <form action={createRow} className="mt-4 grid gap-3 md:grid-cols-6">
          <input
            name="employee_name"
            placeholder="Employee name"
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
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
          <button
            type="submit"
            className="md:col-span-2 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Add row
          </button>
        </form>
      </section>

      {editRowId && !activeEditRow ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The selected row could not be found.
        </section>
      ) : null}

      {activeEditRow ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="relative flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Edit row</h2>
            <Link
              href="/employee-payroll"
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close editor
            </Link>
          </div>
          <form action={saveRow} className="mt-4 grid gap-3 md:grid-cols-6">
            <input type="hidden" name="row_id" value={activeEditRow.id} />
            <input
              name="employee_name"
              defaultValue={activeEditRow.employee_name}
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <select
              name="client_id"
              defaultValue={activeEditRow.client_id || ""}
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">N/A</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <div className="md:col-span-2 text-sm text-slate-500 flex items-center">Update fields and save once.</div>

            {numberColumns.map((column) => (
              <input
                key={column.id}
                type="number"
                step="0.01"
                name={`col_${column.id}`}
                defaultValue={cellValueByKey[`${activeEditRow.id}:${column.id}`] ?? ""}
                placeholder={column.label}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            ))}

            <button
              type="submit"
              className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Save row
            </button>
          </form>
        </section>
      ) : null}

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
                  Add column. Formula example: <code>{"{salary} * 0.05"}</code>
                </p>
                <form action={createColumn} className="grid gap-2 md:grid-cols-6">
                  <input
                    name="label"
                    placeholder="Column label"
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

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Client</th>
                {columns.map((column) => (
                  <th key={column.id} className="px-6 py-3">
                    <div className="flex flex-col">
                      <span>{column.label}</span>
                      {column.kind === "formula" ? (
                        <span className="normal-case text-[11px] text-slate-400">{column.formula}</span>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const relation = row.clients;
                  const clientName = Array.isArray(relation)
                    ? relation[0]?.name || ""
                    : relation?.name || "";

                  const valuesByKey = numberColumns.reduce<Record<string, number>>((acc, column) => {
                    const value = cellValueByKey[`${row.id}:${column.id}`];
                    acc[column.key] = Number(value || 0);
                    return acc;
                  }, {});

                  return (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="px-6 py-3 text-slate-900">{row.employee_name}</td>
                      <td className="px-6 py-3 text-slate-700">{clientName || "N/A"}</td>

                      {columns.map((column) => {
                        if (column.kind === "formula") {
                          const formulaValue = evaluateFormula(column.formula, valuesByKey);
                          return (
                            <td key={column.id} className="px-6 py-3 text-slate-700">
                              {formatMoneyLike(formulaValue)}
                            </td>
                          );
                        }

                        return (
                          <td key={column.id} className="px-6 py-3 text-slate-700">
                            {formatMoneyLike(cellValueByKey[`${row.id}:${column.id}`])}
                          </td>
                        );
                      })}

                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/employee-payroll?edit=${encodeURIComponent(row.id)}`}
                            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Edit
                          </Link>
                          <form action={deleteRow}>
                            <input type="hidden" name="row_id" value={row.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={columns.length + 3}>
                    No payroll rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
