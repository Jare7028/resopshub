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

  async function updateUser(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email || "";

    const { data: currentUser } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", authEmail)
      .maybeSingle();

    // Server Actions must re-check authz (page-level checks aren't enough).
    if (currentUser?.role !== "admin") {
      redirect("/clients");
    }

    const userId = String(formData.get("user_id") || "").trim();
    const fullName = String(formData.get("full_name") || "").trim();
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const role = String(formData.get("role") || "member");
    const status = String(formData.get("status") || "active");

    if (!userId) {
      redirect("/admin/users?error=Missing%20user%20id");
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        userId
      )
    ) {
      redirect("/admin/users?error=Invalid%20user%20id");
    }

    if (!email) {
      redirect("/admin/users?error=Email%20is%20required");
    }

    if (!email.includes("@")) {
      redirect("/admin/users?error=Invalid%20email");
    }

    if (!roleOptions.includes(role as (typeof roleOptions)[number])) {
      redirect("/admin/users?error=Invalid%20role");
    }

    if (!statusOptions.includes(status as (typeof statusOptions)[number])) {
      redirect("/admin/users?error=Invalid%20status");
    }

    const { data: existing, error: existingError } = await supabase
      .from("users")
      .select("email,full_name")
      .eq("id", userId)
      .maybeSingle();

    if (existingError) {
      redirect(`/admin/users?error=${encodeURIComponent(existingError.message)}`);
    }

    if (!existing) {
      redirect("/admin/users?error=User%20not%20found");
    }

    const normalizedFullName = fullName || null;
    const needsAuthUpdate =
      existing.email !== email || (existing.full_name || null) !== normalizedFullName;
    let authWarning: string | null = null;

    if (needsAuthUpdate) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        redirect("/admin/users?error=Missing%20SUPABASE_SERVICE_ROLE_KEY");
      }

      const supabaseAdmin = createSupabaseAdminClient();
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        {
          email,
          user_metadata: { full_name: normalizedFullName ?? "" },
        }
      );

      if (authError) {
        if (authError.message?.toLowerCase().includes("user not found")) {
          const { data: listed, error: listError } =
            await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

          if (listError) {
            redirect(`/admin/users?error=${encodeURIComponent(listError.message)}`);
          }

          const match = listed?.users?.find(
            (user) =>
              user.email?.toLowerCase() === (existing.email || "").toLowerCase()
          );

          if (match) {
            const { error: retryError } = await supabaseAdmin.auth.admin.updateUserById(
              match.id,
              {
                email,
                user_metadata: { full_name: normalizedFullName ?? "" },
              }
            );

            if (retryError) {
              redirect(`/admin/users?error=${encodeURIComponent(retryError.message)}`);
            }
          } else {
            authWarning = "Auth user not found; profile updated only";
          }
        } else {
          redirect(`/admin/users?error=${encodeURIComponent(authError.message)}`);
        }
      }
    }

    const { error } = await supabase
      .from("users")
      .update({
        full_name: normalizedFullName,
        email,
        role,
        status,
      })
      .eq("id", userId);

    if (error) {
      redirect(`/admin/users?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/admin/users");
    const successMessage = authWarning
      ? encodeURIComponent(`Updated (${authWarning})`)
      : "Updated";
    redirect(`/admin/users?success=${successMessage}`);
  }

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
          onUpdate={updateUser}
        />
      </section>
    </div>
  );
}

