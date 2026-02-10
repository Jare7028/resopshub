import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

const statusOptions = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);
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
  searchParams?: Promise<{
    error?: string;
    create_mode?: string;
    template_project_id?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateProjectId = String(searchParams?.template_project_id || "").trim();
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

  const projectsQuery = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (isAdmin) {
    const { data } = await projectsQuery;
    projects = data || [];
  } else if (currentUserId) {
    const { data: assignments } = await supabase
      .from("project_users")
      .select("project_id")
      .eq("user_id", currentUserId);
    const assignedIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];
    if (assignedIds.length) {
      const { data } = await projectsQuery.in("id", assignedIds);
      projects = data || [];
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
  let selectedTemplateTaskTemplateCount: number | null = null;
  let selectedTemplateTaskPreviewError: string | null = null;

  if (createMode === "template" && templateProjectId) {
    const { data: links, error: linksError } = await supabase
      .from("project_template_tasks")
      .select("task_template_id")
      .eq("project_template_id", templateProjectId);

    if (linksError) {
      selectedTemplateTaskPreviewError = isSupabaseMissingTableError(linksError)
        ? "Project template tasks are not set up yet. Run `sql/templates.sql` in Supabase SQL editor, then refresh this page."
        : linksError.message;
    } else {
      selectedTemplateTaskTemplateCount = (links || []).length;
    }
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
    const status = String(formData.get("status") || "planned");
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");
    const templateProjectIdFromForm = String(formData.get("template_project_id") || "").trim();

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
        created_by_user_id: creatorId,
        start_date: startDate || null,
        end_date: endDate || null,
      })
      .select("id")
      .single();

    if (error) {
      redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(error.message)}`);
    }

    if (created?.id && currentUserId) {
      await supabase.from("project_users").insert({
        project_id: created.id,
        user_id: currentUserId,
      });
    }

    revalidatePath(`/clients/${clientId}/projects`);

    if (created?.id && templateProjectIdFromForm) {
      const { data: linksRaw, error: linksError } = await supabase
        .from("project_template_tasks")
        .select("task_template_id,position")
        .eq("project_template_id", templateProjectIdFromForm)
        .order("position", { ascending: true });

      if (linksError && !isSupabaseMissingTableError(linksError)) {
        redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(linksError.message)}`);
      }

      const links = (linksError ? [] : linksRaw || []) as Array<{
        task_template_id: string;
        position: number;
      }>;

      const templateTaskIds = Array.from(
        new Set(links.map((link) => link.task_template_id).filter(Boolean))
      );

      if (templateTaskIds.length) {
        const { data: templateTasksRaw, error: templateTasksError } = await supabase
          .from("task_templates")
          .select("id,title,status,priority")
          .in("id", templateTaskIds);

        if (templateTasksError) {
          redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(templateTasksError.message)}`);
        }

        const templateTasks = (templateTasksRaw || []) as Array<{
          id: string;
          title: string;
          status: string;
          priority: string;
        }>;

        const templateTaskById = templateTasks.reduce<Record<string, (typeof templateTasks)[number]>>(
          (acc, row) => {
            acc[row.id] = row;
            return acc;
          },
          {}
        );

        for (const link of links) {
          const tpl = templateTaskById[link.task_template_id];
          if (!tpl) continue;

          const { data: createdTask, error: taskError } = await supabase
            .from("tasks")
            .insert({
              client_id: clientId,
              project_id: created.id,
              title: tpl.title,
              status: normalizeTaskStatusOrDefault(String(tpl.status || "to_do")),
              priority: String(tpl.priority || "medium"),
              content: DEFAULT_EDITOR_CONTENT,
              content_text: defaultContentText,
            })
            .select("id")
            .single();

          if (taskError) {
            redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(taskError.message)}`);
          }

          const parentTaskId = createdTask?.id;
          if (!parentTaskId) continue;

          const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
            .from("task_template_subtasks")
            .select("title,description,status,priority,position")
            .eq("task_template_id", tpl.id)
            .order("position", { ascending: true });

          if (subtaskTemplatesError && !isSupabaseMissingTableError(subtaskTemplatesError)) {
            redirect(
              `/clients/${clientId}/projects?error=${encodeURIComponent(subtaskTemplatesError.message)}`
            );
          }

          const subtaskTemplates = (subtaskTemplatesError
            ? []
            : subtaskTemplatesRaw || []) as Array<{
            title: string;
            description: string | null;
            status: string;
            priority: string;
            position: number;
          }>;

          if (subtaskTemplates.length) {
            const payloads = subtaskTemplates.map((subtaskTpl) => ({
              client_id: clientId,
              project_id: created.id,
              parent_task_id: parentTaskId,
              title: subtaskTpl.title,
              status: normalizeTaskStatusOrDefault(String(subtaskTpl.status || "to_do")),
              priority: String(subtaskTpl.priority || "medium"),
              due_date: null,
              due_time: null,
              assignee_user_id: null,
              content: DEFAULT_EDITOR_CONTENT,
              content_text: defaultContentText,
            }));

            const { error: subtaskInsertError } = await supabase.from("tasks").insert(payloads);
            if (subtaskInsertError) {
              redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(subtaskInsertError.message)}`);
            }
          }
        }
      }
    }

    revalidatePath(`/clients/${clientId}/tasks`);
    if (created?.id) {
      revalidatePath(`/projects/${created.id}/tasks`);
    }
    revalidatePath("/tasks");
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/clients/${clientId}/projects`}
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
                  ? `/clients/${clientId}/projects?create_mode=template&template_project_id=${encodeURIComponent(
                      templateProjectId
                    )}`
                  : `/clients/${clientId}/projects?create_mode=template`
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
            <form
              method="get"
              action={`/clients/${clientId}/projects`}
              className="flex flex-wrap items-center gap-2"
            >
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
                Select template
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
        {createMode === "template" && !projectTemplatesError ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {selectedTemplate ? (
              <>
                <div className="font-semibold text-slate-900">
                  Template selected: {selectedTemplate.name}
                </div>
                {selectedTemplate.description ? (
                  <div className="mt-1 text-slate-700">{selectedTemplate.description}</div>
                ) : null}
                {selectedTemplateTaskPreviewError ? (
                  <div className="mt-2 text-amber-900">{selectedTemplateTaskPreviewError}</div>
                ) : (
                  <div className="mt-2 text-slate-700">
                    This template will create{" "}
                    <span className="font-semibold text-slate-900">
                      {selectedTemplateTaskTemplateCount ?? 0}
                    </span>{" "}
                    task{(selectedTemplateTaskTemplateCount ?? 0) === 1 ? "" : "s"} in the new
                    project.
                  </div>
                )}
                <div className="mt-2 text-slate-700">
                  Next: enter a project name below, then click{" "}
                  <span className="font-semibold text-slate-900">Create project from template</span>
                  .
                </div>
              </>
            ) : (
              <div className="text-slate-700">
                Step 1: Select a template above and click{" "}
                <span className="font-semibold text-slate-900">Select template</span>. Step 2: Enter
                a project name below, then click{" "}
                <span className="font-semibold text-slate-900">Create project</span>.
              </div>
            )}
          </div>
        ) : null}
        <form action={createProject} className="mt-4 grid gap-4 md:grid-cols-4">
          {createMode === "template" && templateProjectId ? (
            <>
              <input type="hidden" name="create_mode" value="template" />
              <input type="hidden" name="template_project_id" value={templateProjectId} />
            </>
          ) : null}
          <input
            name="name"
            placeholder="Project name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
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
            className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            {createMode === "template" && templateProjectId
              ? "Create project from template"
              : "Create project"}
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



