import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { columnId } = await context.params;
  if (!columnId) {
    return NextResponse.json({ error: "Missing column id" }, { status: 400 });
  }

  let body: { label?: string };
  try {
    body = (await request.json()) as { label?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const label = String(body.label || "").trim();
  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, label, key });
}

