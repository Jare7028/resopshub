import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ProjectInlineRow from "./ProjectInlineRow";

const statusOptions = ["planned", "active", "on_hold", "completed", "cancelled"] as const;

export default async function ProjectsPage(props: {
  searchParams?: Promise<{ client?: string; status?: string; error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const selectedClient = (searchParams?.client || "").trim();
  const selectedStatus = (searchParams?.status || "").trim();
  const returnParams = new URLSearchParams();

  if (selectedClient && selectedClient !== "all") {
    returnParams.set("client", selectedClient);
  }

  if (selectedStatus && selectedStatus !== "all") {
    returnParams.set("status", selectedStatus);
  }

  const returnTo = returnParams.toString() ? `/projects?${returnParams}` : "/projects";

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  let request = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date,client_id,clients(name)")
    .order("created_at", { ascending: false });

  if (selectedClient && selectedClient !== "all") {
    request = request.eq("client_id", selectedClient);
  }

  if (selectedStatus && selectedStatus !== "all") {
    request = request.eq("status", selectedStatus);
  }

  const { data: projects } = await request;

  async function updateProjectInline(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const projectId = String(formData.get("project_id") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    const status = String(formData.get("status") || "").trim();
    const startDate = String(formData.get("start_date") || "").trim();
    const endDate = String(formData.get("end_date") || "").trim();
    const updates: Record<string, string | null> = {};

    if (!projectId) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=Missing%20project%20id`
        : `${returnTo}?error=Missing%20project%20id`;
      redirect(errorUrl);
    }

    if (formData.has("client_id")) {
      updates.client_id = clientId || null;
    }

    if (formData.has("status")) {
      updates.status = status;
    }

    if (formData.has("start_date")) {
      updates.start_date = startDate || null;
    }

    if (formData.has("end_date")) {
      updates.end_date = endDate || null;
    }

    if (!Object.keys(updates).length) {
      redirect(returnTo);
    }

    const { error } = await supabase.from("projects").update(updates).eq("id", projectId);

    if (error) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(error.message)}`
        : `${returnTo}?error=${encodeURIComponent(error.message)}`;
      redirect(errorUrl);
    }

    revalidatePath("/projects");
    redirect(returnTo);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <p className="text-sm text-slate-600">
          View all projects across clients. Use a client record to create new work.
        </p>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-3">
          <select
            name="client"
            defaultValue={selectedClient || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All clients</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={selectedStatus || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Apply filters
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
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Start</th>
                <th className="px-6 py-3">End</th>
              </tr>
            </thead>
            <tbody>
              {projects?.length ? (
                projects.map((project) => (
                  <ProjectInlineRow
                    key={project.id}
                    project={project}
                    clients={clients || []}
                    statusOptions={statusOptions}
                    onUpdate={updateProjectInline}
                  />
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
                    No projects found.
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



