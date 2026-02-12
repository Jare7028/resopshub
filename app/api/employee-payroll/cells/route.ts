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
    number_value?: number | null;
  };
  try {
    body = (await request.json()) as {
      row_id?: string;
      column_id?: string;
      number_value?: number | null;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rowId = String(body.row_id || "").trim();
  const columnId = String(body.column_id || "").trim();
  const numberValue =
    body.number_value === null || body.number_value === undefined
      ? null
      : Number(body.number_value);

  if (!rowId || !columnId) {
    return NextResponse.json({ error: "Missing row_id or column_id" }, { status: 400 });
  }

  if (numberValue !== null && !Number.isFinite(numberValue)) {
    return NextResponse.json({ error: "number_value must be numeric" }, { status: 400 });
  }

  if (numberValue === null) {
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
      number_value: numberValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "row_id,column_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

