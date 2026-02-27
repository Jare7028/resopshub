import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import {
  buildStatusColorMap,
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { updateTaskInlineAction } from "../tasks/actions";
import ProjectsView, {
  type ProjectSortDir,
  type ProjectSortKey,
} from "./ProjectsView";
import {
  normalizeProjectsTabKey,
  type ProjectsTabKey,
} from "./_components/ProjectsTabs";
import ProjectTemplateAutoSelect from "./_components/ProjectTemplateAutoSelect";
import RouteModalOverlay from "../_components/RouteModalOverlay";

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

const addProjectLabelClass =
  "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const addProjectControlClass =
  "mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addProjectInlineControlClass =
  "h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addProjectPanelClass =
  "rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-100 md:p-5";
const addProjectPanelTitleClass =
  "text-xs font-semibold uppercase tracking-wide text-slate-500";

function formatProjectStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeProjectSortKey(value: string | null | undefined): ProjectSortKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "name" ||
    normalized === "client" ||
    normalized === "status" ||
    normalized === "assignees" ||
    normalized === "start" ||
    normalized === "end" ||
    normalized === "open_tasks" ||
    normalized === "created"
  ) {
    return normalized;
  }
  return "created";
}

function normalizeProjectSortDir(value: string | null | undefined): ProjectSortDir {
  return String(value || "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function sortProjectsForDisplay(args: {
  projects: Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    created_at: string | null;
    client_id: string | null;
    clients?: { name?: string | null } | { name?: string | null }[] | null;
  }>;
  users: Array<{ id: string; full_name: string | null; email: string | null }>;
  assigneesByProject: Record<string, string[]>;
  openTaskCountByProjectId: Record<string, number>;
  sortKey: ProjectSortKey;
  sortDir: ProjectSortDir;
}) {
  const usersById = args.users.reduce<Record<string, string>>((acc, user) => {
    acc[user.id] = user.full_name || user.email || "";
    return acc;
  }, {});

  const getClientName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined
  ) => {
    if (Array.isArray(relation)) return relation[0]?.name || "";
    return relation?.name || "";
  };

  const getAssigneeLabel = (projectId: string) => {
    const assigneeIds = args.assigneesByProject[projectId] || [];
    if (!assigneeIds.length) return "";
    const labels = assigneeIds.map((id) => usersById[id] || "").filter(Boolean);
    return labels.join(", ");
  };

  const toTime = (value: string | null | undefined) =>
    value ? new Date(value).getTime() || 0 : 0;

  const rows = [...args.projects];
  rows.sort((a, b) => {
    let aValue: string | number = "";
    let bValue: string | number = "";

    switch (args.sortKey) {
      case "name":
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
        break;
      case "client":
        aValue = getClientName(a.clients).toLowerCase();
        bValue = getClientName(b.clients).toLowerCase();
        break;
      case "status":
        aValue = String(a.status || "").toLowerCase();
        bValue = String(b.status || "").toLowerCase();
        break;
      case "assignees":
        aValue = getAssigneeLabel(a.id).toLowerCase();
        bValue = getAssigneeLabel(b.id).toLowerCase();
        break;
      case "start":
        aValue = toTime(a.start_date);
        bValue = toTime(b.start_date);
        break;
      case "end":
        aValue = toTime(a.end_date);
        bValue = toTime(b.end_date);
        break;
      case "open_tasks":
        aValue = args.openTaskCountByProjectId[a.id] || 0;
        bValue = args.openTaskCountByProjectId[b.id] || 0;
        break;
      case "created":
      default:
        aValue = toTime(a.created_at);
        bValue = toTime(b.created_at);
        break;
    }

    if (typeof aValue === "number" && typeof bValue === "number") {
      return args.sortDir === "asc" ? aValue - bValue : bValue - aValue;
    }

    const textA = String(aValue || "");
    const textB = String(bValue || "");
    const compare = textA.localeCompare(textB);
    return args.sortDir === "asc" ? compare : -compare;
  });

  return rows;
}

function buildProjectsRedirectUrl(
  baseUrl: string,
  params: {
    tab?: "list" | "add";
    error?: string;
    success?: string;
    createMode?: "new" | "template";
    templateProjectId?: string;
  }
) {
  const [path, queryString = ""] = baseUrl.split("?");
  const sp = new URLSearchParams(queryString);

  if (params.tab && params.tab !== "list") sp.set("tab", params.tab);
  else sp.delete("tab");

  if (params.error) sp.set("error", params.error);
  else sp.delete("error");

  if (params.success) sp.set("success", params.success);
  else sp.delete("success");

  if (params.createMode === "template") sp.set("create_mode", "template");
  else if (params.createMode === "new") sp.delete("create_mode");

  if (params.templateProjectId) sp.set("template_project_id", params.templateProjectId);
  else if (typeof params.templateProjectId !== "undefined") sp.delete("template_project_id");

  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export default async function ProjectsPage(props: {
  searchParams?: Promise<{
    tab?: string;
    client?: string | string[];
    status?: string | string[];
    assignee?: string | string[];
    hide?: string;
    watch?: string;
    sort?: string;
    dir?: string;
    view?: string;
    create_mode?: string;
    template_project_id?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }
  const currentUserPromise = supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const selectedViewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    selectedViewRaw === "gantt" || selectedViewRaw === "board" || selectedViewRaw === "table"
      ? (selectedViewRaw as "table" | "gantt" | "board")
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const selectedSortKey = normalizeProjectSortKey(searchParams?.sort);
  const selectedSortDir = normalizeProjectSortDir(searchParams?.dir);
  const activeTab = normalizeProjectsTabKey(searchParams?.tab);
  const selectedClientIdsRaw = parseCsvParam(searchParams?.client);
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const includeWatching = (searchParams?.watch ?? "0").trim() === "1";
  const hasExplicitFilterParams =
    typeof searchParams?.client !== "undefined" ||
    typeof searchParams?.status !== "undefined" ||
    typeof searchParams?.assignee !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.watch !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    typeof searchParams?.view !== "undefined";
  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateProjectId = String(searchParams?.template_project_id || "").trim();
  const returnParams = new URLSearchParams();
  const statusOptionsPromise = supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  const [
    { data: currentUser },
    { data: clients },
    { data: users },
    statusOptionsResponse,
  ] =
    await Promise.all([
      currentUserPromise,
      supabase.from("clients").select("id,name").order("name", { ascending: true }),
      supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
      statusOptionsPromise,
    ]);

  let statusOptionsRaw = (statusOptionsResponse.data || null) as StatusOptionRow[] | null;
  if (statusOptionsResponse.error && isSupabaseMissingColumnError(statusOptionsResponse.error)) {
    const legacyStatusOptionsResponse = await supabase
      .from("status_options")
      .select("entity_type,value,position")
      .order("entity_type", { ascending: true })
      .order("position", { ascending: true })
      .order("value", { ascending: true });
    statusOptionsRaw = (legacyStatusOptionsResponse.data || null) as StatusOptionRow[] | null;
  }

  const currentUserId = currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  const projectStatusOptionsWithMetadata = buildStatusOptionsWithMetadata(
    "project",
    (statusOptionsRaw || []) as StatusOptionRow[],
    []
  );
  const taskStatusOptionsWithMetadata = buildStatusOptionsWithMetadata(
    "task",
    (statusOptionsRaw || []) as StatusOptionRow[],
    []
  );
  const projectStatusOptions = projectStatusOptionsWithMetadata.map((status) => status.value);
  const taskStatusOptions = taskStatusOptionsWithMetadata.map((status) => status.value);
  const projectStatusColorMap = buildStatusColorMap(
    "project",
    projectStatusOptionsWithMetadata
  );
  const taskStatusColorMap = buildStatusColorMap("task", taskStatusOptionsWithMetadata);
  const hiddenProjectStatusValues = buildHiddenStatusValues(
    "project",
    projectStatusOptionsWithMetadata
  );
  const hiddenProjectStatusSet = new Set(hiddenProjectStatusValues);
  const hiddenTaskStatusValues = buildHiddenStatusValues("task", taskStatusOptionsWithMetadata);

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));
  const selectedStatuses = selectedStatusesRaw.filter((value) =>
    projectStatusOptions.includes(value)
  );
  const userIdSet = new Set((users || []).map((user) => user.id));
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );

  returnParams.set("hide", hideCompleted ? "1" : "0");
  if (includeWatching) returnParams.set("watch", "1");
  returnParams.set("sort", selectedSortKey);
  returnParams.set("dir", selectedSortDir);
  if (selectedView !== "table") returnParams.set("view", selectedView);
  setCsvParam(returnParams, "client", selectedClientIds);
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "assignee", selectedAssignees);

  const returnTo = returnParams.toString() ? `/projects?${returnParams}` : "/projects";
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `/projects?${toggleParams}` : "/projects";
  const watchToggleParams = new URLSearchParams(returnParams);
  if (includeWatching) watchToggleParams.delete("watch");
  else watchToggleParams.set("watch", "1");
  const watchToggleUrl = watchToggleParams.toString() ? `/projects?${watchToggleParams}` : "/projects";

  const buildProjectsUrl = (
    tab: ProjectsTabKey,
    params?: { error?: string; success?: string }
  ) => {
    const sp = new URLSearchParams(returnParams);
    if (tab !== "list") sp.set("tab", tab);
    if (params?.error) sp.set("error", params.error);
    if (params?.success) sp.set("success", params.success);
    const qs = sp.toString();
    return qs ? `/projects?${qs}` : "/projects";
  };

  const buildAddProjectUrl = (
    mode: "new" | "template",
    templateId?: string
  ) => {
    const sp = new URLSearchParams(returnParams);
    sp.set("tab", "add");
    if (mode === "template") {
      sp.set("create_mode", "template");
      if (templateId) sp.set("template_project_id", templateId);
      else sp.delete("template_project_id");
    } else {
      sp.delete("create_mode");
      sp.delete("template_project_id");
    }
    const qs = sp.toString();
    return qs ? `/projects?${qs}` : "/projects?tab=add";
  };

  const projectsTabUrls: Record<ProjectsTabKey, string> = {
    list: buildProjectsUrl("list"),
    add: buildProjectsUrl("add"),
  };
  const addProjectModeUrls = {
    new: buildAddProjectUrl("new"),
    template: buildAddProjectUrl("template", templateProjectId || undefined),
  };

  let assignedProjectIds: string[] = [];
  let watchedProjectIds: string[] = [];

  if (currentUserId && !isAdmin) {
    const [{ data: assignedRows }, { data: watcherRows }] =
      await Promise.all([
        supabase.from("project_users").select("project_id").eq("user_id", currentUserId),
        includeWatching
          ? supabase
              .from("project_watchers")
              .select("project_id")
              .eq("user_id", currentUserId)
          : Promise.resolve({ data: [] as Array<{ project_id: string | null }> }),
      ]);

    assignedProjectIds = (assignedRows || [])
      .map((row) => row.project_id)
      .filter(Boolean) as string[];
    watchedProjectIds = (watcherRows || [])
      .map((row) => row.project_id)
      .filter(Boolean) as string[];
  }

  let request = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date,created_at,client_id,clients(name)")
    .order("created_at", { ascending: false });

  if (!currentUserId) {
    request = request.eq("id", "00000000-0000-0000-0000-000000000000");
  } else if (!isAdmin) {
    const visibilityOrFilters: string[] = [`created_by_user_id.eq.${currentUserId}`];
    if (assignedProjectIds.length) {
      visibilityOrFilters.push(`id.in.(${assignedProjectIds.join(",")})`);
    }
    if (watchedProjectIds.length) {
      visibilityOrFilters.push(`id.in.(${watchedProjectIds.join(",")})`);
    }
    request = request.or(visibilityOrFilters.join(","));
  }
  if (selectedClientIds.length) request = request.in("client_id", selectedClientIds);
  if (selectedStatuses.length) request = request.in("status", selectedStatuses);
  const wantsHiddenProjectStatuses = selectedStatuses.some((status) =>
    hiddenProjectStatusSet.has(status)
  );
  if (hideCompleted && hiddenProjectStatusValues.length && !wantsHiddenProjectStatuses) {
    request = request.not("status", "in", `(${hiddenProjectStatusValues.join(",")})`);
  }

  let projects: Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    created_at: string | null;
    client_id: string | null;
    clients?: { name?: string | null } | { name?: string | null }[] | null;
  }> = [];
  const { data: projectsRaw } = await request;
  projects = (projectsRaw || []) as typeof projects;

  const assigneesByProject: Record<string, string[]> = {};
  const projectIds = projects.map((project) => project.id).filter(Boolean) as string[];
  if (projectIds.length) {
    const { data: assigneeRows } = await supabase
      .from("project_users")
      .select("project_id,user_id")
      .in("project_id", projectIds);
    (assigneeRows || []).forEach((row) => {
      if (!assigneesByProject[row.project_id]) assigneesByProject[row.project_id] = [];
      assigneesByProject[row.project_id].push(row.user_id);
    });
  }

  if (selectedAssignees.length) {
    const selectedSet = new Set(selectedAssignees);
    projects = projects.filter((project) => {
      const assigneeIds = assigneesByProject[project.id] || [];
      const hasUnassigned = assigneeIds.length === 0 && selectedSet.has("unassigned");
      const hasAssignedMatch = assigneeIds.some((id) => selectedSet.has(id));
      return hasUnassigned || hasAssignedMatch;
    });
  }

  const openTaskCountByProjectId: Record<string, number> = {};
  const openTasksByProjectId: Record<
    string,
    Array<{
      id: string;
      project_id: string | null;
      client_id: string | null;
      title: string;
      status: string | null;
      priority: string | null;
      start_date: string | null;
      due_date: string | null;
      due_time: string | null;
      assignee_user_id: string | null;
      projects?: { name?: string | null } | { name?: string | null }[] | null;
      clients?: { name?: string | null } | { name?: string | null }[] | null;
      assignee_user_ids: string[];
    }>
  > = {};
  const shouldLoadOpenTaskDetails = selectedView === "table";
  const projectIdsForCounts = projects.map((project) => project.id).filter(Boolean) as string[];
  if (projectIdsForCounts.length) {
    if (shouldLoadOpenTaskDetails) {
      let openTaskRowsQuery = supabase
        .from("tasks")
        .select(
          "id,project_id,client_id,title,status,priority,start_date,due_date,due_time,parent_task_id,assignee_user_id"
        )
        .in("project_id", projectIdsForCounts)
        .is("parent_task_id", null);
      if (hiddenTaskStatusValues.length) {
        openTaskRowsQuery = openTaskRowsQuery.not(
          "status",
          "in",
          `(${hiddenTaskStatusValues.join(",")})`
        );
      }
      const { data: openTaskRowsRaw, error: openTaskRowsError } = await openTaskRowsQuery.order(
        "created_at",
        { ascending: true }
      );

      if (!openTaskRowsError) {
        const openTaskRows = (openTaskRowsRaw || []) as Array<{
          id: string;
          project_id: string | null;
          client_id: string | null;
          title: string;
          status: string | null;
          priority: string | null;
          start_date: string | null;
          due_date: string | null;
          due_time: string | null;
          assignee_user_id: string | null;
        }>;
        const taskIds = openTaskRows.map((row) => row.id).filter(Boolean);
        const assigneeIdsByTaskId: Record<string, string[]> = {};
        if (taskIds.length) {
          const { data: taskAssigneeRows } = await supabase
            .from("task_assignees")
            .select("task_id,user_id")
            .in("task_id", taskIds);
          (taskAssigneeRows || []).forEach((row) => {
            if (!assigneeIdsByTaskId[row.task_id]) {
              assigneeIdsByTaskId[row.task_id] = [];
            }
            assigneeIdsByTaskId[row.task_id].push(row.user_id);
          });
        }

        for (const row of openTaskRows) {
          const projectId = row.project_id;
          if (!projectId) continue;
          openTaskCountByProjectId[projectId] = (openTaskCountByProjectId[projectId] || 0) + 1;
          if (!openTasksByProjectId[projectId]) {
            openTasksByProjectId[projectId] = [];
          }
          const assigneeIds = Array.from(
            new Set([
              ...(assigneeIdsByTaskId[row.id] || []),
              ...(row.assignee_user_id ? [row.assignee_user_id] : []),
            ])
          );
          openTasksByProjectId[projectId].push({
            id: row.id,
            project_id: row.project_id,
            client_id: row.client_id,
            title: row.title,
            status: row.status,
            priority: row.priority,
            start_date: row.start_date,
            due_date: row.due_date,
            due_time: row.due_time,
            assignee_user_id: row.assignee_user_id,
            projects: null,
            clients: null,
            assignee_user_ids: assigneeIds,
          });
        }
      }
    } else {
      let openTaskCountRowsQuery = supabase
        .from("tasks")
        .select("id,project_id")
        .in("project_id", projectIdsForCounts)
        .is("parent_task_id", null);
      if (hiddenTaskStatusValues.length) {
        openTaskCountRowsQuery = openTaskCountRowsQuery.not(
          "status",
          "in",
          `(${hiddenTaskStatusValues.join(",")})`
        );
      }
      const { data: openTaskCountRowsRaw, error: openTaskCountRowsError } =
        await openTaskCountRowsQuery;

      if (!openTaskCountRowsError) {
        const openTaskCountRows = (openTaskCountRowsRaw || []) as Array<{
          id: string;
          project_id: string | null;
        }>;
        openTaskCountRows.forEach((row) => {
          if (!row.project_id) return;
          openTaskCountByProjectId[row.project_id] =
            (openTaskCountByProjectId[row.project_id] || 0) + 1;
        });
      }
    }
  }

  projects = sortProjectsForDisplay({
    projects,
    users: (users || []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>,
    assigneesByProject,
    openTaskCountByProjectId,
    sortKey: selectedSortKey,
    sortDir: selectedSortDir,
  });

  type ProjectTemplateRow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };

  const shouldLoadProjectTemplates = activeTab === "add" || createMode === "template";
  const { data: projectTemplatesRaw, error: projectTemplatesError } = shouldLoadProjectTemplates
    ? await supabase
        .from("project_templates")
        .select("id,name,description,status")
        .order("name", { ascending: true })
    : {
        data: [] as ProjectTemplateRow[],
        error: null,
      };

  const projectTemplates = (projectTemplatesError ? [] : projectTemplatesRaw || []) as ProjectTemplateRow[];
  const templateOptions = projectTemplates.map((template) => ({
    id: template.id,
    name: template.name,
  }));
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
    const assigneesUpdated = String(formData.get("assignees_updated") || "").trim() === "1";
    const assigneeUserIds = Array.from(
      new Set(
        formData
          .getAll("assignee_user_ids")
          .map((value) => String(value).trim())
          .filter(Boolean)
      )
    );
    const updates: Record<string, string | null> = {};

    if (!projectId) {
      redirect(
        buildProjectsRedirectUrl(returnTo, { error: "Missing project id" })
      );
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

    if (!Object.keys(updates).length && !assigneesUpdated) {
      return;
    }

    if (Object.keys(updates).length) {
      const { error } = await supabase.from("projects").update(updates).eq("id", projectId);

      if (error) {
        redirect(
          buildProjectsRedirectUrl(returnTo, { error: error.message })
        );
      }
    }

    if (assigneesUpdated) {
      const { error: clearAssigneesError } = await supabase
        .from("project_users")
        .delete()
        .eq("project_id", projectId);

      if (clearAssigneesError) {
        redirect(
          buildProjectsRedirectUrl(returnTo, { error: clearAssigneesError.message })
        );
      }

      if (assigneeUserIds.length) {
        const { error: addAssigneesError } = await supabase
          .from("project_users")
          .insert(
            assigneeUserIds.map((userId) => ({
              project_id: projectId,
              user_id: userId,
            }))
          );

        if (addAssigneesError) {
          redirect(
            buildProjectsRedirectUrl(returnTo, { error: addAssigneesError.message })
          );
        }
      }
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
    const createModeFromForm: "new" | "template" = templateProjectIdFromForm
      ? "template"
      : "new";
    const defaultTaskAssigneeId = currentUserId || null;
    const redirectCreateError = (message: string) => {
      redirect(
        buildProjectsRedirectUrl(returnTo, {
          tab: "add",
          error: message,
          createMode: createModeFromForm,
          templateProjectId: templateProjectIdFromForm || undefined,
        })
      );
    };

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
      redirectCreateError("Name is required");
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
      redirectCreateError(error.message);
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
        redirectCreateError(String((error as Error).message || error));
      }
    }

    if (created?.id && templateProjectIdFromForm) {
      const { data: linksRaw, error: linksError } = await supabase
        .from("project_template_tasks")
        .select("task_template_id,position")
        .eq("project_template_id", templateProjectIdFromForm)
        .order("position", { ascending: true });

      if (linksError && !isSupabaseMissingTableError(linksError)) {
        redirectCreateError(linksError.message);
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
          redirectCreateError(templateTasksError.message);
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
          redirectCreateError(templateAssigneesError.message);
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
              client_id: clientId || null,
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
            redirectCreateError(
              formatDbError("projects.createProject.templateTask.tasks.insert", taskError)
            );
          }

          const parentTaskId = createdTask?.id;
          if (!parentTaskId) continue;
          try {
            await cloneTemplateCustomFields("task_template", tpl.id, "task", parentTaskId);
          } catch (error) {
            redirectCreateError(String((error as Error).message || error));
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
              redirectCreateError(parentAssigneesError.message);
            }
          }

          const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
            .from("task_template_subtasks")
            .select("id,title,description,status,priority,position")
            .eq("task_template_id", tpl.id)
            .order("position", { ascending: true });

          if (subtaskTemplatesError && !isSupabaseMissingTableError(subtaskTemplatesError)) {
            redirectCreateError(subtaskTemplatesError.message);
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
              redirectCreateError(subtaskTemplateAssigneesError.message);
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
              redirectCreateError(
                formatDbError(
                  "projects.createProject.templateSubtasks.tasks.insert",
                  subtaskInsertError
                )
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
                redirectCreateError(subtaskAssigneesError.message);
              }
            }
          }
        }
      }
    }

    revalidatePath("/projects");
    revalidatePath("/tasks");
    redirect(buildProjectsRedirectUrl(returnTo, { success: "Project created" }));
  }

  return (
    <div className="space-y-8">
      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
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
        </div>
      )}

      {activeTab === "add" ? (
        <RouteModalOverlay
          closeHref={projectsTabUrls.list}
          overlayLabel="Close add project dialog"
        >
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-w-none max-h-[92vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-5xl md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold text-slate-900">Add project</h2>
                <a
                  href={projectsTabUrls.list}
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </a>
              </div>
              <div className="px-4 pb-5 md:px-6 md:pb-6">
                <div className="w-full">
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Link
                        href={addProjectModeUrls.new}
                        className={`inline-flex min-h-11 items-center rounded-md px-3 py-1.5 font-medium ${
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
                            ? buildAddProjectUrl("template", templateProjectId)
                            : addProjectModeUrls.template
                        }
                        className={`inline-flex min-h-11 items-center rounded-md px-3 py-1.5 font-medium ${
                          createMode === "template"
                            ? "tab-active"
                            : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        Choose from template
                      </Link>
                    </div>

                    {createMode === "template" ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <ProjectTemplateAutoSelect
                          templates={templateOptions}
                          selectedTemplateId={selectedTemplate?.id || ""}
                          preservedQuery={returnParams.toString()}
                          disabled={Boolean(projectTemplatesError)}
                          className={`min-w-[16rem] ${addProjectInlineControlClass}`}
                        />
                        <Link
                          href="/settings?tab=templates&templates=projects"
                          className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                        >
                          Manage templates
                        </Link>
                      </div>
                    ) : null}
                  </div>

                  {createMode === "template" && projectTemplatesError ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                      Templates are not set up yet. Run `sql/templates.sql` in Supabase SQL editor,
                      then refresh this page.
                    </p>
                  ) : null}

                  {createMode === "template" && !selectedTemplate && !projectTemplatesError ? (
                    <div className="mt-5 rounded-xl bg-slate-50/70 px-4 py-6 text-sm text-slate-600 ring-1 ring-slate-100">
                      Select a template to load project details.
                    </div>
                  ) : (
                    <form action={createProject} className="mt-5 grid gap-5 md:grid-cols-6">
                      {createMode === "template" && selectedTemplate ? (
                        <>
                          <input type="hidden" name="create_mode" value="template" />
                          <input
                            type="hidden"
                            name="template_project_id"
                            value={selectedTemplate.id}
                          />
                        </>
                      ) : null}

                      <div className={`md:col-span-6 ${addProjectPanelClass}`}>
                        <p className={addProjectPanelTitleClass}>Project details</p>
                        {createMode === "template" && selectedTemplate ? (
                          <div className="mt-2 text-xs text-slate-600">
                            {selectedTemplateTaskPreviewError ? (
                              <span className="text-amber-800">{selectedTemplateTaskPreviewError}</span>
                            ) : (
                              <span>
                                Template creates {selectedTemplateTaskTemplateCount ?? 0} task
                                {(selectedTemplateTaskTemplateCount ?? 0) === 1 ? "" : "s"}.
                              </span>
                            )}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-4 md:grid-cols-6">
                          <div className="md:col-span-3">
                            <label className={addProjectLabelClass}>Name</label>
                            <input
                              name="name"
                              placeholder="Project name"
                              className={addProjectControlClass}
                              defaultValue={selectedTemplate?.name || ""}
                              required
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className={addProjectLabelClass}>Client</label>
                            <select
                              name="client_id"
                              className={addProjectControlClass}
                              defaultValue=""
                            >
                              <option value="">No client</option>
                              {clients?.map((client) => (
                                <option key={client.id} value={client.id}>
                                  {client.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addProjectLabelClass}>Status</label>
                            <select
                              name="status"
                              className={addProjectControlClass}
                              defaultValue={selectedTemplate?.status || "planned"}
                            >
                              {projectStatusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {formatProjectStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addProjectLabelClass}>Start date</label>
                            <input
                              type="date"
                              name="start_date"
                              className={addProjectControlClass}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className={addProjectLabelClass}>End date</label>
                            <input
                              type="date"
                              name="end_date"
                              className={addProjectControlClass}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-6 flex justify-end">
                        <button
                          type="submit"
                          className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white sm:w-auto"
                        >
                          {createMode === "template" && selectedTemplate
                            ? "Create project from template"
                            : "Create project"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </section>
          </div>
        </RouteModalOverlay>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <ProjectsView
          projects={projects || []}
          users={users || []}
          clients={clients || []}
          assigneesByProject={assigneesByProject}
          openTaskCountByProjectId={openTaskCountByProjectId}
          openTasksByProjectId={openTasksByProjectId}
          statusOptions={projectStatusOptions}
          statusColorMap={projectStatusColorMap}
          taskStatusOptions={taskStatusOptions}
          taskStatusColorMap={taskStatusColorMap}
          initialView={selectedView}
          initialFilters={{
            client: selectedClientIds,
            status: selectedStatuses,
            assignee: selectedAssignees,
          }}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
          includeWatching={includeWatching}
          watchToggleUrl={watchToggleUrl}
          sortKey={selectedSortKey}
          sortDir={selectedSortDir}
          addProjectUrl={projectsTabUrls.add}
          onUpdate={updateProjectInline}
          onTaskUpdate={updateTaskInlineAction}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="projects"
          columnPreferenceUserId={currentUserId}
          filterPersistenceUserId={currentUserId || authData.user?.id || null}
          hasExplicitFilterParams={hasExplicitFilterParams}
        />
      </section>
    </div>
  );
}



