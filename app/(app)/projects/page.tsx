import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import {
  buildStatusOptions,
  DEFAULT_PROJECT_STATUS_OPTIONS,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import ProjectsTable from "./ProjectsTable";

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

  const { data: statusOptionsRaw } = await supabase
    .from("status_options")
    .select("entity_type,value,position")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });
  const projectStatusOptions = buildStatusOptions(
    "project",
    (statusOptionsRaw || []) as StatusOptionRow[],
    DEFAULT_PROJECT_STATUS_OPTIONS
  );

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));
  const selectedStatuses = selectedStatusesRaw.filter((value) =>
    projectStatusOptions.includes(value)
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

  const openTaskCountByProjectId: Record<string, number> = {};
  const projectIdsForCounts = projects.map((p) => p.id).filter(Boolean) as string[];
  if (projectIdsForCounts.length) {
    const { data: tasksForCountsRaw, error: tasksForCountsError } = await supabase
      .from("tasks")
      .select("project_id,status,parent_task_id")
      .in("project_id", projectIdsForCounts)
      .is("parent_task_id", null);

    if (!tasksForCountsError) {
      const tasksForCounts = (tasksForCountsRaw || []) as Array<{
        project_id: string | null;
        status: string | null;
      }>;
      for (const row of tasksForCounts) {
        const projectId = row.project_id;
        const status = row.status || "";
        if (!projectId) continue;
        if (status === "completed" || status === "cancelled") continue;
        openTaskCountByProjectId[projectId] = (openTaskCountByProjectId[projectId] || 0) + 1;
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
      return;
    }

    const { error } = await supabase.from("projects").update(updates).eq("id", projectId);

    if (error) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(error.message)}`
        : `${returnTo}?error=${encodeURIComponent(error.message)}`;
      redirect(errorUrl);
    }

    revalidatePath("/projects");
    return;
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
    const templateProjectIdFromForm = String(formData.get("template_project_id") || "").trim();

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

    if (created?.id && templateProjectIdFromForm) {
      const { data: linksRaw, error: linksError } = await supabase
        .from("project_template_tasks")
        .select("task_template_id,position")
        .eq("project_template_id", templateProjectIdFromForm)
        .order("position", { ascending: true });

      if (linksError && !isSupabaseMissingTableError(linksError)) {
        redirect(`/projects?error=${encodeURIComponent(linksError.message)}`);
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
          redirect(`/projects?error=${encodeURIComponent(templateTasksError.message)}`);
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
        const { data: templateAssigneesRaw, error: templateAssigneesError } = await supabase
          .from("task_template_assignees")
          .select("task_template_id,user_id")
          .in("task_template_id", templateTaskIds);
        if (templateAssigneesError && !isSupabaseMissingTableError(templateAssigneesError)) {
          redirect(`/projects?error=${encodeURIComponent(templateAssigneesError.message)}`);
        }
        const assigneeIdsByTemplateId = ((templateAssigneesError
          ? []
          : templateAssigneesRaw || []) as Array<{ task_template_id: string; user_id: string }>)
          .reduce<Record<string, string[]>>((acc, row) => {
            acc[row.task_template_id] ||= [];
            acc[row.task_template_id].push(row.user_id);
            return acc;
          }, {});

        for (const link of links) {
          const tpl = templateTaskById[link.task_template_id];
          if (!tpl) continue;
          const assigneeIds = Array.from(
            new Set(assigneeIdsByTemplateId[tpl.id] || [])
          );
          const primaryAssignee = assigneeIds[0] || null;

          const { data: createdTask, error: taskError } = await supabase
            .from("tasks")
            .insert({
              client_id: clientId || null,
              project_id: created.id,
              title: tpl.title,
              status: normalizeTaskStatusOrDefault(String(tpl.status || "to_do")),
              priority: String(tpl.priority || "medium"),
              assignee_user_id: primaryAssignee,
              content: DEFAULT_EDITOR_CONTENT,
              content_text: defaultContentText,
            })
            .select("id")
            .single();

          if (taskError) {
            redirect(`/projects?error=${encodeURIComponent(taskError.message)}`);
          }

          const parentTaskId = createdTask?.id;
          if (!parentTaskId) continue;
          if (assigneeIds.length) {
            const { error: parentAssigneesError } = await supabase
              .from("task_assignees")
              .insert(
                assigneeIds.map((userId) => ({
                  task_id: parentTaskId,
                  user_id: userId,
                }))
              );
            if (parentAssigneesError) {
              redirect(`/projects?error=${encodeURIComponent(parentAssigneesError.message)}`);
            }
          }

          const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
            .from("task_template_subtasks")
            .select("id,title,description,status,priority,position")
            .eq("task_template_id", tpl.id)
            .order("position", { ascending: true });

          if (subtaskTemplatesError && !isSupabaseMissingTableError(subtaskTemplatesError)) {
            redirect(`/projects?error=${encodeURIComponent(subtaskTemplatesError.message)}`);
          }

          const subtaskTemplates = (subtaskTemplatesError
            ? []
            : subtaskTemplatesRaw || []) as Array<{
            id: string;
            title: string;
            description: string | null;
            status: string;
            priority: string;
            position: number;
          }>;

          if (subtaskTemplates.length) {
            const subtaskTemplateIds = subtaskTemplates.map((subtaskTpl) => subtaskTpl.id);
            const { data: subtaskTemplateAssigneesRaw, error: subtaskTemplateAssigneesError } =
              subtaskTemplateIds.length
                ? await supabase
                    .from("task_template_subtask_assignees")
                    .select("task_template_subtask_id,user_id")
                    .in("task_template_subtask_id", subtaskTemplateIds)
                : {
                    data: [] as Array<{ task_template_subtask_id: string; user_id: string }>,
                    error: null,
                  };
            if (
              subtaskTemplateAssigneesError &&
              !isSupabaseMissingTableError(subtaskTemplateAssigneesError)
            ) {
              redirect(`/projects?error=${encodeURIComponent(subtaskTemplateAssigneesError.message)}`);
            }
            const assigneeIdsBySubtaskTemplateId = (
              (subtaskTemplateAssigneesError ? [] : subtaskTemplateAssigneesRaw || []) as Array<{
                task_template_subtask_id: string;
                user_id: string;
              }>
            ).reduce<Record<string, string[]>>((acc, row) => {
              acc[row.task_template_subtask_id] ||= [];
              acc[row.task_template_subtask_id].push(row.user_id);
              return acc;
            }, {});

            const subtaskPlans = subtaskTemplates.map((subtaskTpl) => {
              const subtaskAssigneeIds = Array.from(
                new Set(assigneeIdsBySubtaskTemplateId[subtaskTpl.id] || [])
              );
              return {
                assigneeIds: subtaskAssigneeIds,
                payload: {
                  client_id: clientId || null,
                  project_id: created.id,
                  parent_task_id: parentTaskId,
                  title: subtaskTpl.title,
                  status: normalizeTaskStatusOrDefault(String(subtaskTpl.status || "to_do")),
                  priority: String(subtaskTpl.priority || "medium"),
                  due_date: null,
                  due_time: null,
                  assignee_user_id: subtaskAssigneeIds[0] || primaryAssignee,
                  content: DEFAULT_EDITOR_CONTENT,
                  content_text: defaultContentText,
                },
              };
            });

            const { data: createdSubtasks, error: subtaskInsertError } = await supabase
              .from("tasks")
              .insert(subtaskPlans.map((plan) => plan.payload))
              .select("id");
            if (subtaskInsertError) {
              redirect(`/projects?error=${encodeURIComponent(subtaskInsertError.message)}`);
            }
            const createdSubtaskRows = (createdSubtasks || []).filter((row) => Boolean(row.id));
            const subtaskAssigneeInserts = createdSubtaskRows.flatMap((row, index) => {
              const explicitIds = subtaskPlans[index]?.assigneeIds || [];
              const effectiveIds = explicitIds.length ? explicitIds : assigneeIds;
              return effectiveIds.map((userId) => ({ task_id: row.id, user_id: userId }));
            });
            if (subtaskAssigneeInserts.length) {
              const { error: subtaskAssigneesError } = await supabase
                .from("task_assignees")
                .insert(subtaskAssigneeInserts);
              if (subtaskAssigneesError) {
                redirect(`/projects?error=${encodeURIComponent(subtaskAssigneesError.message)}`);
              }
            }
          }
        }
      }
    }

    revalidatePath("/projects");
    revalidatePath("/tasks");
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
        <form action={createProject} className="mt-4 grid gap-4 md:grid-cols-5">
          {createMode === "template" && templateProjectId ? (
            <>
              <input type="hidden" name="create_mode" value="template" />
              <input type="hidden" name="template_project_id" value={templateProjectId} />
            </>
          ) : null}
          <input
            name="name"
            placeholder="Project name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            defaultValue={selectedTemplate?.name || ""}
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
            {projectStatusOptions.map((status) => (
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
            {createMode === "template" && templateProjectId
              ? "Create project from template"
              : "Create project"}
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
          statusOptions={projectStatusOptions}
          initialFilters={{ client: selectedClientIds, status: selectedStatuses }}
          hideCompleted={hideCompleted}
          openTaskCountByProjectId={openTaskCountByProjectId}
          onUpdate={updateProjectInline}
        />
      </section>
    </div>
  );
}



