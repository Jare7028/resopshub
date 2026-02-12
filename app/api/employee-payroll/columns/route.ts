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

export async function POST() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ column: data });
}

