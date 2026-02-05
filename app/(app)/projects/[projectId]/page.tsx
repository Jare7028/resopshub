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
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,code,status,description,start_date,end_date,budget,client_id,clients(name)")
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  async function updateProject(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const code = String(formData.get("code") || project.code || "").trim();
    const status = String(formData.get("status") || "planned");
    const description = String(formData.get("description") || "").trim();
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");
    const budget = String(formData.get("budget") || "").trim();

    if (!name) {
      redirect(`/projects/${project.id}?error=Name%20is%20required`);
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
      .eq("id", project.id);

    if (error) {
      redirect(`/projects/${project.id}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/projects/${project.id}`);
    redirect(`/projects/${project.id}?success=Saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Project
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{project.name}</h1>
        <p className="text-sm text-slate-600">Client: {project.clients?.name ?? "--"}</p>
      </section>

      <ProjectTabs projectId={project.id} active="overview" />

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

