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

  let body: { ordered_column_ids?: string[] };
  try {
    body = (await request.json()) as { ordered_column_ids?: string[] };
  } catch {
    return badRequest("Invalid JSON body");
  }

  const orderedColumnIds = Array.isArray(body.ordered_column_ids)
    ? body.ordered_column_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (!orderedColumnIds.length) {
    return badRequest("ordered_column_ids is required");
  }
  if (new Set(orderedColumnIds).size !== orderedColumnIds.length) {
    return badRequest("ordered_column_ids must not contain duplicates");
  }
  if (orderedColumnIds.some((id) => !isUuid(id))) {
    return badRequest("ordered_column_ids contains invalid id");
  }

  const { data: existingColumns, error: existingError } = await supabase
    .from("employee_payroll_columns")
    .select("id");

  if (existingError) {
    return NextResponse.json({ error: "Failed to load existing columns" }, { status: 400 });
  }

  const existingIds = new Set((existingColumns || []).map((column) => column.id));
  if (existingIds.size !== orderedColumnIds.length) {
    return NextResponse.json({ error: "Column list does not match current columns" }, { status: 400 });
  }
  for (const id of orderedColumnIds) {
    if (!existingIds.has(id)) {
      return NextResponse.json({ error: "Column list does not match current columns" }, { status: 400 });
    }
  }

  for (let index = 0; index < orderedColumnIds.length; index += 1) {
    const columnId = orderedColumnIds[index];
    const { error } = await supabase
      .from("employee_payroll_columns")
      .update({
        position: index + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", columnId);

    if (error) {
      return NextResponse.json({ error: "Failed to reorder columns" }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
