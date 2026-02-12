import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rowId = String(body.row_id || "").trim();
  const columnId = String(body.column_id || "").trim();
  const value = String(body.value ?? "").trim();

  if (!rowId || !columnId) {
    return NextResponse.json({ error: "Missing row_id or column_id" }, { status: 400 });
  }

  if (!value) {
    const { error } = await supabase
      .from("employee_payroll_cell_values")
      .delete()
      .eq("row_id", rowId)
      .eq("column_id", columnId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
