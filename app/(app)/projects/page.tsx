import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import ProjectsTable from "./ProjectsTable";

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

export default async function ProjectsPage(props: {
  searchParams?: Promise<{
    client?: string | string[];
    status?: string | string[];
    hide?: string;
    create_mode?: string;
    template_project_id?: string;
    error?: string;
  }>;
}) {
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
  const selectedClientIdsRaw = parseCsvParam(searchParams?.client);
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateProjectId = String(searchParams?.template_project_id || "").trim();
  const returnParams = new URLSearchParams();

  returnParams.set("hide", hideCompleted ? "1" : "0");

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));
  const selectedStatuses = selectedStatusesRaw.filter((value) =>
    statusOptions.includes(value as (typeof statusOptions)[number])
  );

  setCsvParam(returnParams, "client", selectedClientIds);
  setCsvParam(returnParams, "status", selectedStatuses);

  const returnTo = returnParams.toString() ? `/projects?${returnParams}` : "/projects";
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `/projects?${toggleParams}` : "/projects";

  let request = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date,client_id,clients(name)")
    .order("created_at", { ascending: false });

  if (selectedClientIds.length) {
    request = request.in("client_id", selectedClientIds);
  }

  if (selectedStatuses.length) {
    request = request.in("status", selectedStatuses);
  }
  if (hideCompleted) {
    request = request.not("status", "in", "(completed,cancelled)");
  }

  let projects: Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    client_id: string | null;
    clients?: { name?: string | null } | { name?: string | null }[] | null;
  }> = [];

  if (isAdmin) {
    const { data } = await request;
    projects = data || [];
  } else {
    if (!currentUserId) {
      projects = [];
    } else {
    const { data: assignments } = await supabase
      .from("project_users")
      .select("project_id")
      .eq("user_id", currentUserId);
    const assignedIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];
    if (assignedIds.length) {
      const { data } = await request.in("id", assignedIds);
      projects = data || [];
    } else {
      projects = [];
    }
    }
  }

  type ProjectTemplateRow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };

  const { data: projectTemplatesRaw, error: projectTemplatesError } = await supabase
    .from("project_templates")
    .select("id,name,description,status")
    .order("name", { ascending: true });

  const projectTemplates = (projectTemplatesError ? [] : projectTemplatesRaw || []) as ProjectTemplateRow[];
  const selectedTemplate =
    createMode === "template" && templateProjectId
      ? projectTemplates.find((tpl) => tpl.id === templateProjectId) || null
      : null;

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

  async function createProject(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const creatorId = authData.user?.id;
    if (!creatorId) {
      redirect("/login");
    }
    const name = String(formData.get("name") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    const status = String(formData.get("status") || "planned");
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");

    if (!name) {
      redirect(`/projects?error=Name%20is%20required`);
    }

    const code = await ensureUniqueProjectCode(toProjectCode(name));

    const { data: created, error } = await supabase
      .from("projects")
      .insert({
        name,
        code,
        status,
        created_by_user_id: creatorId,
        client_id: clientId || null,
        start_date: startDate || null,
        end_date: endDate || null,
      })
      .select("id")
      .single();

    if (error) {
      redirect(`/projects?error=${encodeURIComponent(error.message)}`);
    }

    if (created?.id && currentUserId) {
      await supabase.from("project_users").insert({
        project_id: created.id,
        user_id: currentUserId,
      });
    }

    revalidatePath("/projects");
    redirect("/projects");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <p className="text-sm text-slate-600">
          View all projects across clients. Create projects with or without a client.
        </p>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add project</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={returnTo}
              className={`rounded-md px-3 py-1.5 font-medium ${
                createMode === "new"
                  ? "tab-active"
                  : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              New project
            </Link>
            <Link
              href={
                templateProjectId
                  ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}create_mode=template&template_project_id=${encodeURIComponent(
                      templateProjectId
                    )}`
                  : `${returnTo}${returnTo.includes("?") ? "&" : "?"}create_mode=template`
              }
              className={`rounded-md px-3 py-1.5 font-medium ${
                createMode === "template"
                  ? "tab-active"
                  : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              Choose from template
            </Link>
          </div>

          {createMode === "template" ? (
            <form method="get" action="/projects" className="flex flex-wrap items-center gap-2">
              {Array.from(returnParams.entries()).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <input type="hidden" name="create_mode" value="template" />
              <select
                name="template_project_id"
                defaultValue={templateProjectId || ""}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                disabled={Boolean(projectTemplatesError)}
              >
                <option value="">Select a template</option>
                {projectTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                disabled={Boolean(projectTemplatesError)}
              >
                Apply
              </button>
              <Link
                href="/settings?tab=templates&templates=projects"
                className="text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                Manage templates
              </Link>
            </form>
          ) : null}
        </div>

        {createMode === "template" && projectTemplatesError ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Templates are not set up yet. Run `sql/templates.sql` in Supabase SQL editor,
            then refresh this page.
          </p>
        ) : null}
        <form action={createProject} className="mt-4 grid gap-4 md:grid-cols-5">
          <input
            name="name"
            placeholder="Project name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            required
          />
          <select
            name="client_id"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">No client</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={selectedTemplate?.status || "planned"}
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
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create project
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          <a
            href={toggleUrl}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted
              ? "Show completed & cancelled"
              : "Hide completed & cancelled"}
          </a>
        </div>
        <ProjectsTable
          projects={projects || []}
          clients={clients || []}
          statusOptions={statusOptions}
          initialFilters={{ client: selectedClientIds, status: selectedStatuses }}
          hideCompleted={hideCompleted}
          onUpdate={updateProjectInline}
        />
      </section>
    </div>
  );
}



