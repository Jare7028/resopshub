import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/adminAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const adminAccess = await getAdminAccess(supabase, "admin.page.auth");
  if (!adminAccess.ok && adminAccess.reason === "unauthenticated") {
    redirect("/login");
  }

  if (!adminAccess.ok) {
    redirect("/clients");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      <p className="text-sm text-slate-600">
        Configure internal settings, users, and access controls for ResOpsHub.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">User management</h2>
        <p className="mt-1 text-sm text-slate-600">
          Create users, update roles, and manage access.
        </p>
        <Link
          href="/admin/users"
          className="mt-4 inline-flex rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
        >
          Manage users
        </Link>
      </div>
    </div>
  );
}
