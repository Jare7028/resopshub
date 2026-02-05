import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusOptions = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
const toProjectCode = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const ensureUniqueProjectCode = async (base: string) => {
  const supabase = createSupabaseServerClient();
  const safeBase = base || "project";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? safeBase : `${safeBase}-${attempt + 1}`;
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!data) {
      return candidate;
    }
  }
  return `${safeBase}-${Date.now()}`;
};

export default async function ClientProjectsPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData.user?.id;
  if (!authUserId) {
    redirect("/login");
  }
  const { data: currentUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUserId)
    .maybeSingle();
  const isAdmin = currentUser?.role === "admin";
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  let projects: Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
  }> = [];

  let projectsQuery = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (isAdmin) {
    const { data } = await projectsQuery;
    projects = data || [];
  } else {
    const { data: assignments } = await supabase
      .from("project_users")
      .select("project_id")
      .eq("user_id", authUserId);
    const assignedIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];
    if (assignedIds.length) {
      const { data } = await projectsQuery.in("id", assignedIds);
      projects = data || [];
    }
  }

  async function createProject(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const status = String(formData.get("status") || "planned");
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");

    if (!name) {
      redirect(`/clients/${clientId}/projects?error=Name%20is%20required`);
    }

    const code = await ensureUniqueProjectCode(toProjectCode(name));

    const { data: created, error } = await supabase
      .from("projects")
      .insert({
      client_id: clientId,
      name,
      code,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      })
      .select("id")
      .single();

    if (error) {
      redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(error.message)}`);
    }

    if (created?.id && authUserId) {
      await supabase.from("project_users").insert({
        project_id: created.id,
        user_id: authUserId,
      });
    }

    revalidatePath(`/clients/${clientId}/projects`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} · Projects
        </h1>
        <ClientTabs clientId={clientId} active="projects" />
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add project</h2>
        <form action={createProject} className="mt-4 grid gap-4 md:grid-cols-4">
          <input
            name="name"
            placeholder="Project name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="status"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue="planned"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="start_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            name="end_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create project
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Project</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Start</th>
                <th className="px-6 py-3">End</th>
              </tr>
            </thead>
            <tbody>
              {projects?.length ? (
                projects.map((project) => (
                  <tr key={project.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:underline"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {project.status?.replace("_", " ")}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {project.start_date
                        ? new Date(project.start_date).toLocaleDateString("en-US")
                        : "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {project.end_date
                        ? new Date(project.end_date).toLocaleDateString("en-US")
                        : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={4}>
                    No projects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}



