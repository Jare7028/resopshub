import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function forbidden(error = "Forbidden") {
  return NextResponse.json({ error }, { status: 403 });
}

export function unauthorized(error = "Unauthorized") {
  return NextResponse.json({ error }, { status: 401 });
}

export async function requirePayrollApiAccess() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) {
    return { error: unauthorized() as NextResponse };
  }

  const { data: allowed, error } = await supabase.rpc("can_access_employee_payroll");
  if (error || allowed !== true) {
    return { error: forbidden() as NextResponse };
  }

  return { supabase, user };
}
