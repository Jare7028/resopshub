import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api/requireApiAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeletePayload = {
  user_id?: string;
};

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createSupabaseServerClient();
  const adminAuth = await requireApiAdmin(supabase, "admin.users.delete.auth");
  if (adminAuth.response) return adminAuth.response;
  const authUserId = adminAuth.user.id;

  const json = (await req.json().catch(() => null)) as DeletePayload | null;
  if (!json) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = String(json.user_id || "").trim();
  if (!uuidRegex.test(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid user id" }, { status: 400 });
  }

  if (userId === authUserId) {
    return NextResponse.json(
      { ok: false, error: "You cannot delete your own account" },
      { status: 400 }
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();

  const { data: targetUser, error: targetUserError } = await supabaseAdmin
    .from("users")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (targetUserError) {
    return NextResponse.json({ ok: false, error: targetUserError.message }, { status: 400 });
  }

  if (!targetUser) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  if (targetUser.role === "admin") {
    const { count: adminCount, error: adminCountError } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (adminCountError) {
      return NextResponse.json(
        { ok: false, error: adminCountError.message },
        { status: 400 }
      );
    }

    if ((adminCount || 0) <= 1) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete the last admin user" },
        { status: 400 }
      );
    }
  }

  const { error: profileDeleteError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", userId);

  if (profileDeleteError) {
    return NextResponse.json(
      { ok: false, error: profileDeleteError.message },
      { status: 400 }
    );
  }

  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (authDeleteError && !authDeleteError.message.toLowerCase().includes("not found")) {
    return NextResponse.json(
      {
        ok: false,
        error: `Profile deleted, but auth deletion failed: ${authDeleteError.message}`,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, user_id: userId });
}

