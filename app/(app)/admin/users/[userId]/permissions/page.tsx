import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PermissionScopeType = "global" | "client" | "project" | "task";

type PermissionDefinition = {
  key: string;
  label: string;
  description: string | null;
  scope_type: PermissionScopeType;
};

type PermissionGrant = {
  id: string;
  permission_key: string;
  scope_type: PermissionScopeType;
  scope_id: string | null;
  created_at: string | null;
};

type ClientRow = {
  id: string;
  name: string | null;
};

function permissionGrantKey(permissionKey: string, scopeType: string, scopeId: string | null) {
  return `${permissionKey}::${scopeType}::${scopeId || "global"}`;
}

function messagePath(userId: string, kind: "error" | "success", message: string) {
  return `/admin/users/${userId}/permissions?${kind}=${encodeURIComponent(message)}`;
}

async function requireAdminActorForAction() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email || "";

  if (!authEmail) {
    return { supabase, actorId: null as string | null, failurePath: "/login" };
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (currentUser?.role !== "admin") {
    return { supabase, actorId: null as string | null, failurePath: "/clients" };
  }

  return { supabase, actorId: currentUser.id as string, failurePath: null as string | null };
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
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email || "";

  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (currentUser?.role !== "admin") {
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

  async function grantPermission(formData: FormData) {
    "use server";

    const requestedUserId = String(formData.get("target_user_id") || "").trim();
    if (!uuidRegex.test(requestedUserId)) {
      redirect("/admin/users?error=Invalid%20user%20id");
    }

    const permissionKey = String(formData.get("permission_key") || "").trim();
    const requestedScopeIdRaw = String(formData.get("scope_id") || "").trim();
    const basePath = `/admin/users/${requestedUserId}/permissions`;

    const { supabase, actorId, failurePath } = await requireAdminActorForAction();
    if (failurePath || !actorId) {
      redirect(failurePath || "/clients");
    }

    const { data: definition, error: definitionError } = await supabase
      .from("permission_definitions")
      .select("key,scope_type")
      .eq("key", permissionKey)
      .maybeSingle();

    if (definitionError || !definition) {
      redirect(messagePath(requestedUserId, "error", "Invalid permission selected."));
    }

    const scopeType = definition.scope_type as PermissionScopeType;
    const scopeId =
      scopeType === "global"
        ? null
        : uuidRegex.test(requestedScopeIdRaw)
          ? requestedScopeIdRaw
          : null;

    if (scopeType !== "global" && !scopeId) {
      redirect(messagePath(requestedUserId, "error", "A valid scope is required."));
    }

    if (scopeType === "client" && scopeId) {
      const { data: clientRow, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", scopeId)
        .maybeSingle();

      if (clientError || !clientRow) {
        redirect(messagePath(requestedUserId, "error", "Client scope no longer exists."));
      }
    }

    let existingQuery = supabase
      .from("user_permission_grants")
      .select("id")
      .eq("user_id", requestedUserId)
      .eq("permission_key", permissionKey)
      .eq("scope_type", scopeType);

    existingQuery =
      scopeType === "global"
        ? existingQuery.is("scope_id", null)
        : existingQuery.eq("scope_id", scopeId as string);

    const { data: existingRows, error: existingError } = await existingQuery.limit(1);
    if (existingError) {
      redirect(
        messagePath(
          requestedUserId,
          "error",
          `Could not check existing grants (${existingError.message}).`
        )
      );
    }

    if (!existingRows?.length) {
      const { error: insertError } = await supabase.from("user_permission_grants").insert({
        user_id: requestedUserId,
        permission_key: permissionKey,
        scope_type: scopeType,
        scope_id: scopeId,
        created_by_user_id: actorId,
      });

      if (insertError && insertError.code !== "23505") {
        redirect(
          messagePath(
            requestedUserId,
            "error",
            `Could not grant permission (${insertError.message}).`
          )
        );
      }
    }

    revalidatePath(basePath);
    redirect(messagePath(requestedUserId, "success", "Permission granted."));
  }

  async function revokePermission(formData: FormData) {
    "use server";

    const requestedUserId = String(formData.get("target_user_id") || "").trim();
    if (!uuidRegex.test(requestedUserId)) {
      redirect("/admin/users?error=Invalid%20user%20id");
    }

    const permissionKey = String(formData.get("permission_key") || "").trim();
    const requestedScopeIdRaw = String(formData.get("scope_id") || "").trim();
    const basePath = `/admin/users/${requestedUserId}/permissions`;

    const { supabase, actorId, failurePath } = await requireAdminActorForAction();
    if (failurePath || !actorId) {
      redirect(failurePath || "/clients");
    }

    const { data: definition, error: definitionError } = await supabase
      .from("permission_definitions")
      .select("key,scope_type")
      .eq("key", permissionKey)
      .maybeSingle();

    if (definitionError || !definition) {
      redirect(messagePath(requestedUserId, "error", "Invalid permission selected."));
    }

    const scopeType = definition.scope_type as PermissionScopeType;
    const scopeId =
      scopeType === "global"
        ? null
        : uuidRegex.test(requestedScopeIdRaw)
          ? requestedScopeIdRaw
          : null;

    if (scopeType !== "global" && !scopeId) {
      redirect(messagePath(requestedUserId, "error", "A valid scope is required."));
    }

    let deleteQuery = supabase
      .from("user_permission_grants")
      .delete()
      .eq("user_id", requestedUserId)
      .eq("permission_key", permissionKey)
      .eq("scope_type", scopeType);

    deleteQuery =
      scopeType === "global"
        ? deleteQuery.is("scope_id", null)
        : deleteQuery.eq("scope_id", scopeId as string);

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      redirect(
        messagePath(
          requestedUserId,
          "error",
          `Could not revoke permission (${deleteError.message}).`
        )
      );
    }

    revalidatePath(basePath);
    redirect(messagePath(requestedUserId, "success", "Permission revoked."));
  }

  const [
    { data: permissionDefinitionsRaw, error: permissionDefinitionsError },
    { data: permissionGrantsRaw, error: permissionGrantsError },
    { data: clientsRaw, error: clientsError },
  ] = await Promise.all([
    supabase
      .from("permission_definitions")
      .select("key,label,description,scope_type")
      .order("scope_type", { ascending: true })
      .order("key", { ascending: true }),
    supabase
      .from("user_permission_grants")
      .select("id,permission_key,scope_type,scope_id,created_at")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id,name").order("name", { ascending: true }),
  ]);

  const permissionsSchemaMissing =
    isSupabaseMissingTableError(permissionDefinitionsError) ||
    isSupabaseMissingTableError(permissionGrantsError);

  const permissionDefinitions = (permissionDefinitionsRaw || []) as PermissionDefinition[];
  const permissionGrants = (permissionGrantsRaw || []) as PermissionGrant[];
  const clients = (clientsRaw || []) as ClientRow[];

  const globalDefinitions = permissionDefinitions.filter(
    (permission) => permission.scope_type === "global"
  );
  const clientDefinitions = permissionDefinitions.filter(
    (permission) => permission.scope_type === "client"
  );
  const otherScopeGrants = permissionGrants.filter(
    (grant) => grant.scope_type === "project" || grant.scope_type === "task"
  );

  const grantLookup = new Set(
    permissionGrants.map((grant) =>
      permissionGrantKey(grant.permission_key, grant.scope_type, grant.scope_id)
    )
  );
  const definitionLabelByKey = new Map(
    permissionDefinitions.map((permission) => [permission.key, permission.label])
  );
  const clientNameById = new Map(clients.map((client) => [client.id, client.name || client.id]));

  const hasGrant = (permissionKey: string, scopeType: string, scopeId: string | null) =>
    grantLookup.has(permissionGrantKey(permissionKey, scopeType, scopeId));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">User Permissions</h1>
        <p className="text-sm text-slate-600">
          Set granular permissions for{" "}
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
          <p className="font-semibold">Permissions tables are not available yet.</p>
          <p className="mt-2">
            Run <code>sql/permissions_admin_member.sql</code> in Supabase, then refresh this page.
          </p>
        </section>
      ) : null}

      {!permissionsSchemaMissing && (permissionDefinitionsError || permissionGrantsError) ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load permissions metadata. Please check Supabase logs and try again.
        </section>
      ) : null}

      {!permissionsSchemaMissing && !permissionDefinitionsError && !permissionGrantsError ? (
        <>
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Global Permissions</h2>
              <p className="mt-1 text-sm text-slate-600">
                These apply across the whole workspace.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Permission</th>
                    <th className="px-6 py-3">Description</th>
                    <th className="px-6 py-3">Access</th>
                    <th className="px-6 py-3 text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {globalDefinitions.length ? (
                    globalDefinitions.map((permission) => {
                      const granted = hasGrant(permission.key, "global", null);
                      return (
                        <tr key={permission.key} className="border-t border-slate-200">
                          <td className="px-6 py-3 font-medium text-slate-900">{permission.label}</td>
                          <td className="px-6 py-3 text-slate-600">
                            {permission.description || "No description"}
                          </td>
                          <td className="px-6 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                granted
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {granted ? "Granted" : "Not granted"}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <form action={granted ? revokePermission : grantPermission}>
                              <input type="hidden" name="target_user_id" value={targetUserId} />
                              <input type="hidden" name="permission_key" value={permission.key} />
                              <input type="hidden" name="scope_id" value="" />
                              <button
                                type="submit"
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                  granted
                                    ? "border border-red-300 text-red-700 hover:bg-red-50"
                                    : "border border-slate-300 text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                {granted ? "Revoke" : "Grant"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-6 py-6 text-slate-500" colSpan={4}>
                        No global permissions configured.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Client Permissions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Grant read/edit style access per client (for example, client view vs client edit).
              </p>
            </div>
            {clientsError ? (
              <p className="px-6 py-5 text-sm text-red-700">
                Could not load clients for client-scoped permissions.
              </p>
            ) : !clients.length ? (
              <p className="px-6 py-5 text-sm text-slate-600">
                No clients yet. Client-scoped permissions will appear after clients are created.
              </p>
            ) : !clientDefinitions.length ? (
              <p className="px-6 py-5 text-sm text-slate-600">
                No client-scoped permissions are defined.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3">Client</th>
                      {clientDefinitions.map((permission) => (
                        <th key={permission.key} className="px-4 py-3 text-slate-700">
                          <div className="font-semibold">{permission.label}</div>
                          <div className="normal-case font-normal text-slate-500">
                            {permission.key}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id} className="border-t border-slate-200">
                        <td className="px-6 py-3 font-medium text-slate-900">
                          {client.name || "Untitled client"}
                        </td>
                        {clientDefinitions.map((permission) => {
                          const granted = hasGrant(permission.key, "client", client.id);
                          return (
                            <td key={`${client.id}-${permission.key}`} className="px-4 py-3">
                              <form action={granted ? revokePermission : grantPermission}>
                                <input type="hidden" name="target_user_id" value={targetUserId} />
                                <input
                                  type="hidden"
                                  name="permission_key"
                                  value={permission.key}
                                />
                                <input type="hidden" name="scope_id" value={client.id} />
                                <button
                                  type="submit"
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                    granted
                                      ? "border border-red-300 text-red-700 hover:bg-red-50"
                                      : "border border-slate-300 text-slate-700 hover:bg-slate-100"
                                  }`}
                                >
                                  {granted ? "Revoke" : "Grant"}
                                </button>
                              </form>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {otherScopeGrants.length ? (
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Other Scoped Grants</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Existing project/task grants are listed here.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3">Permission</th>
                      <th className="px-6 py-3">Scope</th>
                      <th className="px-6 py-3">Scope Id</th>
                      <th className="px-6 py-3 text-slate-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherScopeGrants.map((grant) => {
                      const permissionLabel =
                        definitionLabelByKey.get(grant.permission_key) || grant.permission_key;
                      const scopeLabel =
                        grant.scope_type === "client" && grant.scope_id
                          ? clientNameById.get(grant.scope_id) || grant.scope_type
                          : grant.scope_type;
                      return (
                        <tr key={grant.id} className="border-t border-slate-200">
                          <td className="px-6 py-3 font-medium text-slate-900">{permissionLabel}</td>
                          <td className="px-6 py-3 text-slate-600">{scopeLabel}</td>
                          <td className="px-6 py-3 text-slate-600">
                            {grant.scope_id || "global"}
                          </td>
                          <td className="px-6 py-3">
                            <form action={revokePermission}>
                              <input type="hidden" name="target_user_id" value={targetUserId} />
                              <input type="hidden" name="permission_key" value={grant.permission_key} />
                              <input type="hidden" name="scope_id" value={grant.scope_id || ""} />
                              <button
                                type="submit"
                                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                              >
                                Revoke
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
