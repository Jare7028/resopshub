import { NextResponse } from "next/server";
import { requirePayrollApiAccess } from "@/app/api/employee-payroll/_lib/auth";

function toSlug(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

export async function POST() {
  const access = await requirePayrollApiAccess();
  if ("error" in access) {
    return access.error;
  }
  const { supabase } = access;

  const { data: last } = await supabase
    .from("employee_payroll_columns")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (Number(last?.position) || 0) + 1;
  const label = `Column ${nextPosition}`;

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

  const { data, error } = await supabase
    .from("employee_payroll_columns")
    .insert({
      key,
      label,
      kind: "number",
      formula: null,
      position: nextPosition,
    })
    .select("id,key,label,kind,formula,position")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create column" }, { status: 400 });
  }

  return NextResponse.json({ column: data });
}
