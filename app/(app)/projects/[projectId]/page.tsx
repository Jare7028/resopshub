import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "./_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusOptions = ["planned", "active", "on_hold", "completed", "cancelled"] as const;

export default async function ProjectOverviewPage(props: {
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
    .select("id,name,code,status,description,start_date,end_date,budget,client_id,clients(name)")
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  const projectId = project.id;
  const projectCode = project.code || "";

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment) {
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

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

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
        redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?success=Assignments%20updated`);
  }

  async function updateProject(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const code = String(formData.get("code") || projectCode).trim();
    const status = String(formData.get("status") || "planned");
    const description = String(formData.get("description") || "").trim();
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");
    const budget = String(formData.get("budget") || "").trim();

    if (!name) {
      redirect(`/projects/${projectId}?error=Name%20is%20required`);
    }

    const { error } = await supabase
      .from("projects")
      .update({
        name,
        code,
        status,
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        budget: budget ? Number(budget) : null,
      })
      .eq("id", projectId);

    if (error) {
      redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?success=Saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Project
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{project.name}</h1>
        <p className="text-sm text-slate-600">
          Client: {getRelationName(project.clients, "--")}
        </p>
      </section>

      <ProjectTabs projectId={projectId} active="overview" />

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
        <h2 className="text-lg font-semibold text-slate-900">Project access</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose who can see this project.
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
              Save access
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No users found.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Project details</h2>
        <form action={updateProject} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={project.name}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={project.status || "planned"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="budget">
              Budget
            </label>
            <input
              id="budget"
              name="budget"
              type="number"
              step="0.01"
              defaultValue={project.budget ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="start_date">
              Start date
            </label>
            <input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={project.start_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="end_date">
              End date
            </label>
            <input
              id="end_date"
              name="end_date"
              type="date"
              defaultValue={project.end_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={project.description || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save changes
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

