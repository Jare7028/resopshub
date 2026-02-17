import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const roleOptions = ["admin", "member"] as const;
const statusOptions = ["active", "disabled"] as const;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UpdatePayload = {
  user_id?: string;
  full_name?: string | null;
  email?: string;
  role?: string;
  status?: string;
};

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email || "";

  if (!authEmail) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const json = (await req.json().catch(() => null)) as UpdatePayload | null;
  if (!json) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = String(json.user_id || "").trim();
  if (!uuidRegex.test(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid user id" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("users")
    .select("id,email,full_name,role,status,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ ok: false, error: existingError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  const email =
    typeof json.email === "string"
      ? json.email.trim().toLowerCase()
      : String(existing.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }

  const fullName =
    typeof json.full_name === "string"
      ? json.full_name.trim() || null
      : json.full_name === null
        ? null
        : existing.full_name || null;

  const role = typeof json.role === "string" ? json.role : existing.role;
  const status = typeof json.status === "string" ? json.status : existing.status;

  if (!roleOptions.includes(role as (typeof roleOptions)[number])) {
    return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
  }

  if (!statusOptions.includes(status as (typeof statusOptions)[number])) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
  }

  const needsAuthUpdate =
    (existing.email || "").toLowerCase() !== email || (existing.full_name || null) !== fullName;

  if (needsAuthUpdate) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email,
      user_metadata: { full_name: fullName ?? "" },
    });

    if (authError) {
      return NextResponse.json({ ok: false, error: authError.message }, { status: 400 });
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("users")
    .update({
      full_name: fullName,
      email,
      role,
      status,
    })
    .eq("id", userId)
    .select("id,full_name,email,role,status,created_at")
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      { ok: false, error: updateError?.message || "Failed to update user" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, user: updated });
}
