import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/adminAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessOptions = ["none", "view", "edit"] as const;
type AccessLevel = (typeof accessOptions)[number];

type PagePermissionRow = {
  key: string;
  label: string;
  nav_href: string;
  sort_order: number;
};

type UserPagePermissionRow = {
  page_key: string;
  access_level: AccessLevel;
};

function messagePath(userId: string, kind: "error" | "success", message: string) {
  return `/admin/users/${userId}/permissions?${kind}=${encodeURIComponent(message)}`;
}

async function requireAdminActorForAction() {
  const supabase = createSupabaseServerClient();
  const adminAccess = await getAdminAccess(supabase, "admin.user_permissions.action.auth");
  if (!adminAccess.ok && adminAccess.reason === "unauthenticated") {
    return { supabase, actorId: null as string | null, failurePath: "/login" };
  }

  if (!adminAccess.ok) {
    return { supabase, actorId: null as string | null, failurePath: "/clients" };
  }

  return { supabase, actorId: adminAccess.profile.id, failurePath: null as string | null };
}

export default async function AdminUserPermissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const targetUserId = String(resolvedParams.userId || "").trim();

  if (!uuidRegex.test(targetUserId)) {
    notFound();
  }

  const supabase = createSupabaseServerClient();
  const adminAccess = await getAdminAccess(supabase, "admin.user_permissions.page.auth");
  if (!adminAccess.ok && adminAccess.reason === "unauthenticated") {
    redirect("/login");
  }

  if (!adminAccess.ok) {
    redirect("/clients");
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id,full_name,email,role,status")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!targetUser) {
    notFound();
  }

  async function savePageAccess(formData: FormData) {
    "use server";

    const requestedUserId = String(formData.get("target_user_id") || "").trim();
    const pageKey = String(formData.get("page_key") || "").trim();
    const accessLevel = String(formData.get("access_level") || "").trim().toLowerCase();

    if (!uuidRegex.test(requestedUserId)) {
      redirect("/admin/users?error=Invalid%20user%20id");
    }

    if (!accessOptions.includes(accessLevel as AccessLevel)) {
      redirect(messagePath(requestedUserId, "error", "Invalid access level."));
    }

    const { supabase, actorId, failurePath } = await requireAdminActorForAction();
    if (failurePath || !actorId) {
      redirect(failurePath || "/clients");
    }

    const { data: pageDef, error: pageDefError } = await supabase
      .from("page_permissions")
      .select("key")
      .eq("key", pageKey)
      .maybeSingle();

    if (pageDefError || !pageDef) {
      redirect(messagePath(requestedUserId, "error", "Unknown page key."));
    }

    const { error: upsertError } = await supabase.from("user_page_permissions").upsert(
      {
        user_id: requestedUserId,
        page_key: pageKey,
        access_level: accessLevel,
        updated_by_user_id: actorId,
      },
      { onConflict: "user_id,page_key" }
    );

    if (upsertError) {
      redirect(
        messagePath(
          requestedUserId,
          "error",
          `Could not save access (${upsertError.message}).`
        )
      );
    }

    revalidatePath(`/admin/users/${requestedUserId}/permissions`);
    redirect(messagePath(requestedUserId, "success", "Permissions updated."));
  }

  const [{ data: pagePermissionRows, error: pagePermissionError }, { data: userRows, error: userRowsError }] =
    await Promise.all([
      supabase
        .from("page_permissions")
        .select("key,label,nav_href,sort_order")
        .order("sort_order", { ascending: true })
        .order("key", { ascending: true }),
      supabase
        .from("user_page_permissions")
        .select("page_key,access_level")
        .eq("user_id", targetUserId),
    ]);

  const permissionsSchemaMissing =
    isSupabaseMissingTableError(pagePermissionError) || isSupabaseMissingTableError(userRowsError);

  const pagePermissions = (pagePermissionRows || []) as PagePermissionRow[];
  const userPermissionRows = (userRows || []) as UserPagePermissionRow[];
  const userAccessByPage = new Map(
    userPermissionRows.map((row) => [row.page_key, row.access_level] as const)
  );

  const effectiveAccess = (pageKey: string): AccessLevel =>
    (userAccessByPage.get(pageKey) || "edit") as AccessLevel;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">User Permissions</h1>
        <p className="text-sm text-slate-600">
          Configure page-level access for{" "}
          <span className="font-semibold text-slate-900">
            {targetUser.full_name || targetUser.email}
          </span>
          .
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>Email: {targetUser.email}</span>
          <span>Role: {targetUser.role}</span>
          <span>Status: {targetUser.status}</span>
        </div>
        <p className="text-sm text-slate-600">
          `none` hides/blocks the page, `view` allows read-only, `edit` allows updates.
        </p>
        <p className="text-sm text-slate-600">
          Client/task/project assignment rules still apply on top of this page access.
        </p>
        <Link href="/admin/users" className="text-sm text-slate-600 hover:underline">
          Back to users
        </Link>
      </section>

      {(resolvedSearchParams?.error || resolvedSearchParams?.success) && (
        <div className="space-y-2">
          {resolvedSearchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {resolvedSearchParams.error}
            </p>
          ) : null}
          {resolvedSearchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {resolvedSearchParams.success}
            </p>
          ) : null}
        </div>
      )}

      {permissionsSchemaMissing ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Page permissions tables are not available yet.</p>
          <p className="mt-2">
            Run <code>sql/permissions_admin_member.sql</code> in Supabase, then refresh this page.
          </p>
        </section>
      ) : null}

      {!permissionsSchemaMissing && (pagePermissionError || userRowsError) ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load page permissions metadata. Please check Supabase logs and try again.
        </section>
      ) : null}

      {!permissionsSchemaMissing && !pagePermissionError && !userRowsError ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Left Menu Page Access</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3">Page</th>
                  <th className="px-6 py-3">Route</th>
                  <th className="px-6 py-3">Access</th>
                  <th className="px-6 py-3 text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagePermissions.length ? (
                  pagePermissions.map((page) => (
                    <tr key={page.key} className="border-t border-slate-200">
                      <td className="px-6 py-3 font-medium text-slate-900">{page.label}</td>
                      <td className="px-6 py-3 text-slate-600">{page.nav_href}</td>
                      <td className="px-6 py-3">
                        <form action={savePageAccess} className="flex items-center gap-2">
                          <input type="hidden" name="target_user_id" value={targetUserId} />
                          <input type="hidden" name="page_key" value={page.key} />
                          <select
                            name="access_level"
                            defaultValue={effectiveAccess(page.key)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                          >
                            <option value="none">No access</option>
                            <option value="view">View only</option>
                            <option value="edit">Edit</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">{page.key}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-6 py-6 text-slate-500" colSpan={4}>
                      No page permissions configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
