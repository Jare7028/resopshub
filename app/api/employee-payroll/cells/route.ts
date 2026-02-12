import { NextResponse } from "next/server";
import {
  badRequest,
  isUuid,
  requirePayrollApiAccess,
} from "@/app/api/employee-payroll/_lib/auth";

export async function PUT(request: Request) {
  const access = await requirePayrollApiAccess();
  if ("error" in access) {
    return access.error;
  }
  const { supabase } = access;

  let body: {
    row_id?: string;
    column_id?: string;
    value?: string | null;
  };
  try {
    body = (await request.json()) as {
      row_id?: string;
      column_id?: string;
      value?: string | null;
    };
  } catch {
    return badRequest("Invalid JSON body");
  }

  const rowId = String(body.row_id || "").trim();
  const columnId = String(body.column_id || "").trim();
  const value = String(body.value ?? "").trim().slice(0, 2000);

  if (!rowId || !columnId) {
    return badRequest("Missing row_id or column_id");
  }
  if (!isUuid(rowId) || !isUuid(columnId)) {
    return badRequest("Invalid row_id or column_id");
  }

  if (!value) {
    const { error } = await supabase
      .from("employee_payroll_cell_values")
      .delete()
      .eq("row_id", rowId)
      .eq("column_id", columnId);

    if (error) {
      return NextResponse.json({ error: "Failed to clear cell value" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase.from("employee_payroll_cell_values").upsert(
    {
      row_id: rowId,
      column_id: columnId,
      text_value: value,
      number_value: Number.isFinite(Number(value)) ? Number(value) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "row_id,column_id" }
  );

  if (error) {
    return NextResponse.json({ error: "Failed to save cell value" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
