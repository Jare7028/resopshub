import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_SIDEBAR_LINKS, type SidebarPageKey } from "@/lib/appSidebarLinks";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

type UserProfile = {
  id: string;
  role: string;
};

type PagePermission = {
  page_key: string;
  access_level: "none" | "view" | "edit";
};

const VALID_PAGE_KEYS = new Set(APP_SIDEBAR_LINKS.map((link) => link.pageKey));
const MISSING_TABLE_HINT =
  "Manual menu ordering needs sql/20260228130000_app_sidebar_navigation.sql";

function uniquePageKeys(rawKeys: readonly string[]): SidebarPageKey[] {
  const seen = new Set<SidebarPageKey>();
  const next: SidebarPageKey[] = [];

  for (const rawKey of rawKeys) {
    const key = String(rawKey || "").trim() as SidebarPageKey;
    if (!key || seen.has(key) || !VALID_PAGE_KEYS.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(key);
  }

  return next;
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "app_nav.reorder.auth");
  if (auth.response) return auth.response;
  const { user } = auth;

  let payload: { orderedPageKeys?: unknown };
  try {
    payload = (await request.json()) as { orderedPageKeys?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderedPageKeys = uniquePageKeys(
    Array.isArray(payload?.orderedPageKeys) ? payload.orderedPageKeys.map(String) : []
  );

  if (!orderedPageKeys.length) {
    return NextResponse.json({ error: "No menu items to save" }, { status: 400 });
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("users")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profileRow) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  let pagePermissionRows: Array<PagePermission> | null = null;

  if (profileRow.role !== "admin") {
    const permissionResponse = await supabase
      .from("user_page_permissions")
      .select("page_key,access_level")
      .eq("user_id", profileRow.id);

    if (permissionResponse.error) {
      if (!isSupabaseMissingTableError(permissionResponse.error)) {
        return NextResponse.json({ error: permissionResponse.error.message }, { status: 500 });
      }
    } else {
      pagePermissionRows = (permissionResponse.data || []) as Array<PagePermission>;
    }
  }

  const pagePermissionMap = new Map<SidebarPageKey, "none" | "view" | "edit">(
    (pagePermissionRows || []).map((row) => [
      String(row.page_key) as SidebarPageKey,
      (row.access_level || "none") as "none" | "view" | "edit",
    ])
  );

  const filteredPageKeys = orderedPageKeys.filter(
    (pageKey) => profileRow.role === "admin" || (pagePermissionMap.get(pageKey) || "edit") !== "none"
  );

  if (!filteredPageKeys.length) {
    return NextResponse.json({ error: "No accessible menu items provided" }, { status: 400 });
  }

  const deleteResult = await supabase.from("user_sidebar_link_order").delete().eq("user_id", user.id);
  if (deleteResult.error) {
    if (isSupabaseMissingTableError(deleteResult.error)) {
      return NextResponse.json({ error: MISSING_TABLE_HINT }, { status: 400 });
    }
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  const upsertRows = filteredPageKeys.map((pageKey, index) => ({
    user_id: user.id,
    page_key: pageKey,
    sort_order: index + 1,
  }));

  const insertResult = await supabase.from("user_sidebar_link_order").insert(upsertRows);
  if (insertResult.error) {
    if (isSupabaseMissingTableError(insertResult.error)) {
      return NextResponse.json({ error: MISSING_TABLE_HINT }, { status: 400 });
    }
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pageKeys: filteredPageKeys });
}
