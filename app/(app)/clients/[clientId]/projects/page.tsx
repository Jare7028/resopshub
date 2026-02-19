import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { withPerfTiming } from "@/lib/perf";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import {
  buildStatusOptions,
  DEFAULT_PROJECT_STATUS_OPTIONS,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import ProjectsTable from "../../../projects/ProjectsTable";
import {
  ensureClientPageEditAccess,
  ensureClientPageViewAccess,
  getClientPageAccessData,
} from "../_lib/clientPageAccess";

const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);
const projectsPageSize = 50;
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

function formatDbError(
  context: string,
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null | undefined
) {
  if (!error) return context;
  const parts = [`[${context}]`, error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

export default async function ClientProjectsPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    error?: string;
    client?: string | string[];
    status?: string | string[];
    hide?: string;
    create_mode?: string;
    template_project_id?: string;
    page?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const selectedClientIdsRaw = parseCsvParam(searchParams?.client);
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const returnParams = new URLSearchParams();
  returnParams.set("hide", hideCompleted ? "1" : "0");

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateProjectId = String(searchParams?.template_project_id || "").trim();
  const pageParam = Number.parseInt(String(searchParams?.page || "1"), 10);
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const projectRangeFrom = (currentPage - 1) * projectsPageSize;
  const projectRangeTo = projectRangeFrom + projectsPageSize;
  const { data: authData } = await withPerfTiming("clients.projects.auth", () =>
    supabase.auth.getUser()
  );
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }
  const { data: currentUser } = await withPerfTiming("clients.projects.current_user", () =>
    supabase.from("users").select("id,role").eq("email", authEmail).maybeSingle()
  );
  const currentUserId = currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  const { data: client } = await withPerfTiming("clients.projects.client", () =>
    supabase.from("clients").select("id,name").eq("id", params.clientId).single()
  );

  const { data: statusOptionsRaw } = await withPerfTiming("clients.projects.status_options", () =>
    supabase
      .from("status_options")
      .select("entity_type,value,position")
      .order("entity_type", { ascending: true })
      .order("position", { ascending: true })
      .order("value", { ascending: true })
  );
  const projectStatusOptions = buildStatusOptions(
    "project",
    (statusOptionsRaw || []) as StatusOptionRow[],
    DEFAULT_PROJECT_STATUS_OPTIONS
  );

  if (!client) {
    notFound();
  }
  const { accessByKey: clientPageAccessByKey, visibleTabs } = await withPerfTiming(
    "clients.projects.page_access",
    () => getClientPageAccessData({ supabase, clientId })
  );
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "projects",
    accessByKey: clientPageAccessByKey,
  });
  const selectedClientIds = selectedClientIdsRaw.filter((id) => id === clientId);
  const selectedStatuses = selectedStatusesRaw.filter((value) =>
    projectStatusOptions.includes(value)
  );
  setCsvParam(returnParams, "client", selectedClientIds);
  setCsvParam(returnParams, "status", selectedStatuses);
  if (currentPage > 1) {
    returnParams.set("page", String(currentPage));
  }
  const returnTo = returnParams.toString()
    ? `/clients/${clientId}/projects?${returnParams}`
    : `/clients/${clientId}/projects`;
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString()
    ? `/clients/${clientId}/projects?${toggleParams}`
    : `/clients/${clientId}/projects`;
  const buildProjectsPageUrl = (pageNumber: number) => {
    const normalizedPage = Number.isFinite(pageNumber) && pageNumber > 1 ? Math.floor(pageNumber) : 1;
    const sp = new URLSearchParams(returnParams);
    if (normalizedPage > 1) {
      sp.set("page", String(normalizedPage));
    } else {
      sp.delete("page");
    }
    const qs = sp.toString();
    return qs ? `/clients/${clientId}/projects?${qs}` : `/clients/${clientId}/projects`;
  };

  let projects: Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    client_id: string | null;
    clients?: { name?: string | null } | { name?: string | null }[] | null;
  }> = [];
  let hasNextPage = false;
  const hasPreviousPage = currentPage > 1;

  const projectsQuery = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date,client_id,clients(name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  let filteredProjectsQuery = projectsQuery;
  if (selectedStatuses.length) {
    filteredProjectsQuery = filteredProjectsQuery.in("status", selectedStatuses);
  }
  if (hideCompleted) {
    filteredProjectsQuery = filteredProjectsQuery.not("status", "in", "(completed,cancelled)");
  }

  if (isAdmin) {
    const { data } = await withPerfTiming("clients.projects.rows", () =>
      filteredProjectsQuery.range(projectRangeFrom, projectRangeTo)
    );
    const pagedRows = data || [];
    hasNextPage = pagedRows.length > projectsPageSize;
    projects = pagedRows.slice(0, projectsPageSize);
  } else if (currentUserId) {
    const { data: assignments } = await withPerfTiming("clients.projects.assignments", () =>
      supabase.from("project_users").select("project_id").eq("user_id", currentUserId)
    );
    const assignedIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];
    if (assignedIds.length) {
      const { data } = await withPerfTiming("clients.projects.rows", () =>
        filteredProjectsQuery.in("id", assignedIds).range(projectRangeFrom, projectRangeTo)
      );
      const pagedRows = data || [];
      hasNextPage = pagedRows.length > projectsPageSize;
      projects = pagedRows.slice(0, projectsPageSize);
    }
  }
  const previousPageUrl = hasPreviousPage ? buildProjectsPageUrl(currentPage - 1) : null;
  const nextPageUrl = hasNextPage ? buildProjectsPageUrl(currentPage + 1) : null;

  const openTaskCountByProjectId: Record<string, number> = {};
  const projectIdsForCounts = projects.map((p) => p.id).filter(Boolean) as string[];
  if (projectIdsForCounts.length) {
    const { data: tasksForCountsRaw, error: tasksForCountsError } = await withPerfTiming(
      "clients.projects.open_task_counts",
      () =>
        supabase
          .from("tasks")
          .select("project_id,parent_task_id")
          .in("project_id", projectIdsForCounts)
          .is("parent_task_id", null)
          .not("status", "in", "(completed,cancelled)")
    );

    if (!tasksForCountsError) {
      const tasksForCounts = (tasksForCountsRaw || []) as Array<{
        project_id: string | null;
      }>;
      for (const row of tasksForCounts) {
        const projectId = row.project_id;
        if (!projectId) continue;
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

  const { data: projectTemplatesRaw, error: projectTemplatesError } =
    createMode === "template"
      ? await withPerfTiming("clients.projects.templates", () =>
          supabase
            .from("project_templates")
            .select("id,name,description,status")
            .order("name", { ascending: true })
        )
      : {
          data: [] as ProjectTemplateRow[],
          error: null,
        };

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
    await ensureClientPageEditAccess({
      supabase,
      clientId,
      pageKey: "projects",
      redirectPath: `/clients/${clientId}/projects`,
    });
    const { data: authData } = await supabase.auth.getUser();
    const creatorId = authData.user?.id;
    if (!creatorId) {
      redirect("/login");
    }
    const name = String(formData.get("name") || "").trim();
    const projectClientIdRaw = String(formData.get("client_id") || "").trim();
    const projectClientId = projectClientIdRaw || null;
    const status = String(formData.get("status") || "planned");
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "");
    const templateProjectIdFromForm = String(formData.get("template_project_id") || "").trim();
    const defaultTaskAssigneeId = currentUserId || null;

    const cloneTemplateCustomFields = async (
      templateEntityType: "task_template" | "project_template",
      templateEntityId: string,
      targetEntityType: "task" | "project",
      targetEntityId: string
    ) => {
      const { data: templateFieldsRaw, error: templateFieldsError } = await supabase
        .from("custom_fields")
        .select("id,key,label,field_kind,position")
        .eq("entity_type", templateEntityType)
        .eq("entity_id", templateEntityId);
      if (templateFieldsError && !isSupabaseMissingTableError(templateFieldsError)) {
        throw new Error(templateFieldsError.message);
      }
      const templateFields = (templateFieldsError ? [] : templateFieldsRaw || []) as Array<{
        id: string;
        key: string;
        label: string;
        field_kind: "text" | "dropdown" | "date" | "client";
        position: number;
      }>;
      if (!templateFields.length) {
        return;
      }
      const fieldIds = templateFields.map((field) => field.id);
      const { data: templateOptionsRaw, error: templateOptionsError } = await supabase
        .from("custom_field_options")
        .select("field_id,value,position")
        .in("field_id", fieldIds)
        .order("position", { ascending: true });
      if (templateOptionsError && !isSupabaseMissingTableError(templateOptionsError)) {
        throw new Error(templateOptionsError.message);
      }
      const { data: templateValuesRaw, error: templateValuesError } = await supabase
        .from("custom_field_values")
        .select("field_id,text_value,option_value")
        .eq("entity_type", templateEntityType)
        .eq("entity_id", templateEntityId)
        .in("field_id", fieldIds);
      if (templateValuesError && !isSupabaseMissingTableError(templateValuesError)) {
        throw new Error(templateValuesError.message);
      }
      const templateOptions = (templateOptionsError ? [] : templateOptionsRaw || []) as Array<{
        field_id: string;
        value: string;
        position: number;
      }>;
      const templateValues = (templateValuesError ? [] : templateValuesRaw || []) as Array<{
        field_id: string;
        text_value: string | null;
        option_value: string | null;
      }>;

      const { data: createdFields, error: createFieldsError } = await supabase
        .from("custom_fields")
        .insert(
          templateFields.map((field) => ({
            entity_type: targetEntityType,
            entity_id: targetEntityId,
            key: field.key,
            label: field.label,
            field_kind: field.field_kind,
            position: field.position,
          }))
        )
        .select("id,key");
      if (createFieldsError && !isSupabaseMissingTableError(createFieldsError)) {
        throw new Error(createFieldsError.message);
      }

      const fieldIdByTemplateId = new Map<string, string>();
      for (const templateField of templateFields) {
        const match = (createdFields || []).find((field) => field.key === templateField.key);
        if (match?.id) {
          fieldIdByTemplateId.set(templateField.id, match.id);
        }
      }

      const optionInserts = templateOptions
        .map((option) => {
          const clonedFieldId = fieldIdByTemplateId.get(option.field_id);
          if (!clonedFieldId) return null;
          return {
            field_id: clonedFieldId,
            value: option.value,
            position: option.position,
          };
        })
        .filter(Boolean) as Array<{ field_id: string; value: string; position: number }>;
      if (optionInserts.length) {
        const { error: copyOptionsError } = await supabase
          .from("custom_field_options")
          .insert(optionInserts);
        if (copyOptionsError && !isSupabaseMissingTableError(copyOptionsError)) {
          throw new Error(copyOptionsError.message);
        }
      }

      const valueInserts = templateValues
        .map((valueRow) => {
          const clonedFieldId = fieldIdByTemplateId.get(valueRow.field_id);
          if (!clonedFieldId) return null;
          const fieldKind =
            templateFields.find((field) => field.id === valueRow.field_id)?.field_kind ||
            "text";
          return {
            entity_type: targetEntityType,
            entity_id: targetEntityId,
            field_id: clonedFieldId,
            text_value: fieldKind === "dropdown" ? null : valueRow.text_value,
            option_value: fieldKind === "dropdown" ? valueRow.option_value : null,
          };
        })
        .filter(Boolean) as Array<{
        entity_type: "task" | "project";
        entity_id: string;
        field_id: string;
        text_value: string | null;
        option_value: string | null;
      }>;
      if (valueInserts.length) {
        const { error: copyValuesError } = await supabase
          .from("custom_field_values")
          .upsert(valueInserts, { onConflict: "entity_type,entity_id,field_id" });
        if (copyValuesError && !isSupabaseMissingTableError(copyValuesError)) {
          throw new Error(copyValuesError.message);
        }
      }
    };

    if (!name) {
      redirect(`/clients/${clientId}/projects?error=Name%20is%20required`);
    }

    const code = await ensureUniqueProjectCode(toProjectCode(name));

    const { data: created, error } = await supabase
      .from("projects")
      .insert({
        client_id: projectClientId,
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

    if (created?.id && templateProjectIdFromForm) {
      try {
        await cloneTemplateCustomFields(
          "project_template",
          templateProjectIdFromForm,
          "project",
          created.id
        );
      } catch (error) {
        redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(String((error as Error).message || error))}`);
      }
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
        const { data: templateAssigneesRaw, error: templateAssigneesError } = await supabase
          .from("task_template_assignees")
          .select("task_template_id,user_id")
          .in("task_template_id", templateTaskIds);
        if (templateAssigneesError && !isSupabaseMissingTableError(templateAssigneesError)) {
          redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(templateAssigneesError.message)}`);
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
          const effectiveAssigneeIds = assigneeIds.length
            ? assigneeIds
            : defaultTaskAssigneeId
              ? [defaultTaskAssigneeId]
              : [];
          const primaryAssignee = effectiveAssigneeIds[0] || null;

          const { data: createdTask, error: taskError } = await supabase
            .from("tasks")
            .insert({
              client_id: projectClientId,
              project_id: created.id,
              title: tpl.title,
              status: normalizeTaskStatusOrDefault(String(tpl.status || "to_do")),
              priority: String(tpl.priority || "medium"),
              assignee_user_id: primaryAssignee,
              created_by_user_id: creatorId,
              content: DEFAULT_EDITOR_CONTENT,
              content_text: defaultContentText,
            })
            .select("id")
            .single();

          if (taskError) {
            redirect(
              `/clients/${clientId}/projects?error=${encodeURIComponent(
                formatDbError("clients.projects.createProject.templateTask.tasks.insert", taskError)
              )}`
            );
          }

          const parentTaskId = createdTask?.id;
          if (!parentTaskId) continue;
          try {
            await cloneTemplateCustomFields("task_template", tpl.id, "task", parentTaskId);
          } catch (error) {
            redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(String((error as Error).message || error))}`);
          }
          if (effectiveAssigneeIds.length) {
            const { error: parentAssigneesError } = await supabase
              .from("task_assignees")
              .insert(
                effectiveAssigneeIds.map((userId) => ({
                  task_id: parentTaskId,
                  user_id: userId,
                }))
              );
            if (parentAssigneesError) {
              redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(parentAssigneesError.message)}`);
            }
          }

          const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
            .from("task_template_subtasks")
            .select("id,title,description,status,priority,position")
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
              redirect(
                `/clients/${clientId}/projects?error=${encodeURIComponent(
                  subtaskTemplateAssigneesError.message
                )}`
              );
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
                  client_id: projectClientId,
                  project_id: created.id,
                  parent_task_id: parentTaskId,
                  title: subtaskTpl.title,
                  status: normalizeTaskStatusOrDefault(String(subtaskTpl.status || "to_do")),
                  priority: String(subtaskTpl.priority || "medium"),
                  due_date: null,
                  due_time: null,
                  assignee_user_id: subtaskAssigneeIds[0] || primaryAssignee,
                  created_by_user_id: creatorId,
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
              redirect(
                `/clients/${clientId}/projects?error=${encodeURIComponent(
                  formatDbError(
                    "clients.projects.createProject.templateSubtasks.tasks.insert",
                    subtaskInsertError
                  )
                )}`
              );
            }
            const createdSubtaskRows = (createdSubtasks || []).filter((row) => Boolean(row.id));
            const subtaskAssigneeInserts = createdSubtaskRows.flatMap((row, index) => {
              const explicitIds = subtaskPlans[index]?.assigneeIds || [];
              const effectiveIds = explicitIds.length ? explicitIds : effectiveAssigneeIds;
              return effectiveIds.map((userId) => ({ task_id: row.id, user_id: userId }));
            });
            if (subtaskAssigneeInserts.length) {
              const { error: subtaskAssigneesError } = await supabase
                .from("task_assignees")
                .insert(subtaskAssigneeInserts);
              if (subtaskAssigneesError) {
                redirect(`/clients/${clientId}/projects?error=${encodeURIComponent(subtaskAssigneesError.message)}`);
              }
            }
          }
        }
      }
    }

    revalidatePath(`/clients/${clientId}/tasks`);
    revalidatePath("/projects");
    if (created?.id) {
      revalidatePath(`/projects/${created.id}/tasks`);
    }
    revalidatePath("/tasks");
    if (projectClientId !== clientId) {
      redirect(`/projects?success=${encodeURIComponent("Project created")}`);
    }
  }

  async function updateProjectInline(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    await ensureClientPageEditAccess({
      supabase,
      clientId,
      pageKey: "projects",
      redirectPath: `/clients/${clientId}/projects`,
    });
    const projectId = String(formData.get("project_id") || "").trim();
    const formClientId = String(formData.get("client_id") || "").trim();
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
      updates.client_id = formClientId || null;
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

    revalidatePath(`/clients/${clientId}/projects`);
    return;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} · Projects
        </h1>
        <ClientTabs clientId={clientId} active="projects" tabs={visibleTabs} />
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={selectedTemplate?.name || ""}
            required
          />
          <select
            name="client_id"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={clientId}
          >
            <option value="">No client</option>
            <option value={clientId}>{client.name}</option>
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
          clients={[client]}
          statusOptions={projectStatusOptions}
          initialFilters={{ client: selectedClientIds, status: selectedStatuses }}
          hideCompleted={hideCompleted}
          openTaskCountByProjectId={openTaskCountByProjectId}
          onUpdate={updateProjectInline}
          basePath={`/clients/${clientId}/projects`}
        />
      </section>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Page {currentPage}</p>
        <div className="flex items-center gap-2">
          {previousPageUrl ? (
            <Link
              href={previousPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Previous
            </Link>
          ) : null}
          {nextPageUrl ? (
            <Link
              href={nextPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}



