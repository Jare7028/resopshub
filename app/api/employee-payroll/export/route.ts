import { NextResponse } from "next/server";
import { requirePayrollApiAccess } from "@/app/api/employee-payroll/_lib/auth";

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const access = await requirePayrollApiAccess();
  if ("error" in access) {
    return access.error;
  }
  const { supabase } = access;

  const { data: columnsRaw } = await supabase
    .from("employee_payroll_columns")
    .select("id,label,position")
    .order("position", { ascending: true });
  const columns = (columnsRaw || []) as Array<{ id: string; label: string; position: number }>;

  const { data: rowsRaw } = await supabase
    .from("employee_payroll_rows")
    .select(
      "id,employee_name,job_title,billable,client_id,contract_type,created_at,clients(name)"
    )
    .order("created_at", { ascending: true });
  const rows = (rowsRaw || []) as Array<{
    id: string;
    employee_name: string;
    job_title: string | null;
    billable: string | null;
    client_id: string | null;
    contract_type: string | null;
    clients?: { name: string | null } | { name: string | null }[] | null;
  }>;

  const rowIds = rows.map((row) => row.id);
  const { data: cellsRaw } = rowIds.length
    ? await supabase
        .from("employee_payroll_cell_values")
        .select("row_id,column_id,text_value,number_value")
        .in("row_id", rowIds)
    : { data: [] as Array<{ row_id: string; column_id: string; text_value: string | null; number_value: number | null }> };

  const cellByKey = new Map<string, string>();
  for (const cell of cellsRaw || []) {
    const key = `${cell.row_id}:${cell.column_id}`;
    const value =
      cell.text_value ??
      (cell.number_value === null || cell.number_value === undefined
        ? ""
        : String(cell.number_value));
    cellByKey.set(key, value);
  }

  const headers = ["Name", "Job Title", "Billable", "Client", "Contract Type", ...columns.map((c) => c.label)];
  const lines = [headers.map(csvEscape).join(",")];

  for (const row of rows) {
    const relation = row.clients;
    const clientName = Array.isArray(relation) ? relation[0]?.name || "" : relation?.name || "";

    const base = [
      row.employee_name || "",
      row.job_title || "",
      row.billable || "",
      clientName || "",
      row.contract_type || "",
    ];
    const dynamic = columns.map((column) => cellByKey.get(`${row.id}:${column.id}`) || "");
    lines.push([...base, ...dynamic].map((value) => csvEscape(String(value))).join(","));
  }

  const csv = `\uFEFF${lines.join("\r\n")}`;
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"employee-payroll-${date}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}
