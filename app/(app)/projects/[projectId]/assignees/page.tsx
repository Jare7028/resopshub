import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "../_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectAssigneesPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const currentUserId = currentUser?.id;
  const isAdmin = currentUser?.role === "admin";

  const { data: project } = await supabase
    .from("projects")
    .select("id,name,created_by_user_id")
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  const projectId = project.id;

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    const { data: watching } = await supabase
      .from("project_watchers")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment && !watching) {
      redirect("/projects?error=Not%20assigned%20to%20that%20project");
    }
  } else if (!isAdmin && !currentUserId) {
    redirect("/projects?error=User%20profile%20missing");
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const { data: assignments } = await supabase
    .from("project_users")
    .select("user_id")
    .eq("project_id", projectId);
  const assignedUserIds = new Set(
    (assignments || []).map((assignment) => assignment.user_id).filter(Boolean)
  );

  const { data: projectWatchers } = await supabase
    .from("project_watchers")
    .select("user_id")
    .eq("project_id", projectId);
  const watcherUserIds = new Set(
    (projectWatchers || []).map((row) => row.user_id).filter(Boolean)
  );

  async function updateProjectAssignments(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("assigned_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("project_users").delete().eq("project_id", projectId);

    if (selectedIds.length) {
      const inserts = selectedIds.map((userId) => ({
        project_id: projectId,
        user_id: userId,
      }));
      const { error } = await supabase.from("project_users").insert(inserts);
      if (error) {
        redirect(`/projects/${projectId}/assignees?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/assignees`);
    redirect(`/projects/${projectId}/assignees?success=Assignments%20updated`);
  }

  async function updateProjectWatchers(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("watcher_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("project_watchers").delete().eq("project_id", projectId);

    const uniqueIds = Array.from(new Set(selectedIds));
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({
        project_id: projectId,
        user_id: userId,
      }));
      const { error } = await supabase.from("project_watchers").insert(inserts);
      if (error) {
        redirect(`/projects/${projectId}/assignees?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/assignees`);
    redirect(`/projects/${projectId}/assignees?success=Watchers%20updated`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Project
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{project.name}</h1>
      </section>

      <ProjectTabs projectId={projectId} active="assignees" />

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}
      {searchParams?.success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {searchParams.success}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Project assignees</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose who is assigned to this project.
        </p>
        {users?.length ? (
          <form action={updateProjectAssignments} className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {users.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="assigned_user_ids"
                    value={user.id}
                    defaultChecked={assignedUserIds.has(user.id)}
                  />
                  <span>{user.full_name || user.email}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save assignees
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No users found.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Project watchers</h2>
        <p className="mt-1 text-sm text-slate-600">
          Watchers can view and edit this project without being an assignee.
        </p>
        {users?.length ? (
          <form action={updateProjectWatchers} className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {users.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="watcher_user_ids"
                    value={user.id}
                    defaultChecked={watcherUserIds.has(user.id)}
                  />
                  <span>{user.full_name || user.email}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save watchers
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No users found.</p>
        )}
      </section>
    </div>
  );
}
