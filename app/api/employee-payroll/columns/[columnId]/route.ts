import { NextResponse } from "next/server";
import {
  badRequest,
  isUuid,
  requirePayrollApiAccess,
} from "@/app/api/employee-payroll/_lib/auth";

function toSlug(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ columnId: string }> }
) {
  const access = await requirePayrollApiAccess();
  if ("error" in access) {
    return access.error;
  }
  const { supabase } = access;

  const { columnId } = await context.params;
  if (!columnId || !isUuid(columnId)) {
    return badRequest("Invalid column id");
  }

  let body: { label?: string };
  try {
    body = (await request.json()) as { label?: string };
  } catch {
    return badRequest("Invalid JSON body");
  }

  const label = String(body.label || "").trim();
  if (!label) {
    return badRequest("Label is required");
  }
  if (label.length > 80) {
    return badRequest("Label is too long");
  }

  const baseKey = toSlug(label);
  let key = baseKey;
  let suffix = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("employee_payroll_columns")
      .select("id")
      .eq("key", key)
      .neq("id", columnId)
      .maybeSingle();
    if (!existing) break;
    suffix += 1;
    key = `${baseKey}_${suffix}`;
  }

  const { error } = await supabase
    .from("employee_payroll_columns")
    .update({
      label,
      key,
      updated_at: new Date().toISOString(),
    })
    .eq("id", columnId);

  if (error) {
    return NextResponse.json({ error: "Failed to update column" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, label, key });
}
