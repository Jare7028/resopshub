import { NextResponse } from "next/server";
import {
  badRequest,
  isUuid,
  requirePayrollApiAccess,
} from "@/app/api/employee-payroll/_lib/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ rowId: string }> }
) {
  const access = await requirePayrollApiAccess();
  if ("error" in access) {
    return access.error;
  }
  const { supabase } = access;

  const { rowId } = await context.params;
  if (!rowId || !isUuid(rowId)) {
    return badRequest("Invalid row id");
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const updates: Record<string, string | null> = {};

  if (Object.prototype.hasOwnProperty.call(body, "employee_name")) {
    const employeeName = String(body.employee_name || "").trim();
    if (!employeeName) {
      return badRequest("Employee name is required");
    }
    if (employeeName.length > 200) {
      return badRequest("Employee name is too long");
    }
    updates.employee_name = employeeName;
  }

  if (Object.prototype.hasOwnProperty.call(body, "job_title")) {
    const value = String(body.job_title || "").trim();
    updates.job_title = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "client_id")) {
    const value = String(body.client_id || "").trim();
    if (value && !isUuid(value)) {
      return badRequest("Invalid client id");
    }
    updates.client_id = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "contract_type")) {
    const value = String(body.contract_type || "").trim();
    updates.contract_type = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "billable")) {
    const value = String(body.billable || "").trim();
    updates.billable = value || null;
  }

  if (!Object.keys(updates).length) {
    return badRequest("No fields to update");
  }

  const { error } = await supabase
    .from("employee_payroll_rows")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  if (error) {
    return NextResponse.json({ error: "Failed to update row" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
