import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ordered_column_ids?: string[] };
  try {
    body = (await request.json()) as { ordered_column_ids?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderedColumnIds = Array.isArray(body.ordered_column_ids)
    ? body.ordered_column_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (!orderedColumnIds.length) {
    return NextResponse.json({ error: "ordered_column_ids is required" }, { status: 400 });
  }

  const { data: existingColumns, error: existingError } = await supabase
    .from("employee_payroll_columns")
    .select("id");

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}

