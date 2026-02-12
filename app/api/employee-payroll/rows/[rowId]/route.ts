import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ rowId: string }> }
) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rowId } = await context.params;
  if (!rowId) {
    return NextResponse.json({ error: "Missing row id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};

  if (Object.prototype.hasOwnProperty.call(body, "employee_name")) {
    const employeeName = String(body.employee_name || "").trim();
    if (!employeeName) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }
    updates.employee_name = employeeName;
  }

  if (Object.prototype.hasOwnProperty.call(body, "job_title")) {
    const value = String(body.job_title || "").trim();
    updates.job_title = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "client_id")) {
    const value = String(body.client_id || "").trim();
    updates.client_id = value || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "contract_type")) {
    const value = String(body.contract_type || "").trim();
    updates.contract_type = value || null;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("employee_payroll_rows")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

