import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import AdminUsersTable from "./AdminUsersTable";

const roleOptions = ["admin", "ops", "manager", "member", "viewer"] as const;
const statusOptions = ["active", "disabled"] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const adminEnabled = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;

  if (!authEmail) {
    notFound();
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (currentUser?.role !== "admin") {
    redirect("/clients");
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email,role,status,created_at")
    .order("created_at", { ascending: false });

  async function createUser(formData: FormData) {
    "use server";
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      redirect("/admin/users?error=Missing%20SUPABASE_SERVICE_ROLE_KEY");
    }
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("full_name") || "").trim();
    const role = String(formData.get("role") || "member");
    const status = String(formData.get("status") || "active");

    if (!email || !password) {
      redirect("/admin/users?error=Email%20and%20password%20are%20required");
    }

    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email || "";

    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", authEmail)
      .maybeSingle();

    if (currentUser?.role !== "admin") {
      redirect("/clients");
    }

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      redirect("/admin/users?error=User%20already%20exists");
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: created, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || email.split("@")[0],
        },
      });

    if (createError || !created.user) {
      redirect(
        `/admin/users?error=${encodeURIComponent(createError?.message || "Failed%20to%20create%20auth%20user")}`
      );
    }

    const { error: profileError } = await supabase.from("users").insert({
      id: created.user.id,
      email,
      full_name: fullName || email.split("@")[0],
      role,
      status,
    });

    if (profileError) {
      redirect(`/admin/users?error=${encodeURIComponent(profileError.message)}`);
    }

    revalidatePath("/admin/users");
    redirect("/admin/users?success=User%20created");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Admin . Users</h1>
        <p className="text-sm text-slate-600">
          Manage user roles and access for ResOpsHub.
        </p>
        <Link href="/admin" className="text-sm text-slate-600 hover:underline">
          Back to Admin
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

      {!adminEnabled ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Admin user creation is not configured.</p>
          <p className="mt-1">
            Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart the dev server.
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Create user</h2>
        <form action={createUser} className="mt-4 grid gap-4 md:grid-cols-5">
          <input
            name="full_name"
            placeholder="Full name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            required
          />
          <input
            type="password"
            name="password"
            placeholder="Temp password"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="role"
            defaultValue="member"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue="active"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create user
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Users</h2>
        </div>
        <AdminUsersTable
          users={users || []}
          roleOptions={roleOptions}
          statusOptions={statusOptions}
        />
      </section>
    </div>
  );
}

