import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCurrentRequestUser,
  type CurrentRequestUser,
} from "@/lib/supabase/currentUser";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { plainTextToTiptapDoc } from "@/lib/plainTextToTiptapDoc";
import { setCsvParam } from "@/lib/queryParams";
import {
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  filterTaskStatusOptionsWithMetadata,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
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
import { logError } from "@/lib/vercelLogger";
import TasksView from "./TasksView";
import AssigneeMultiSelect from "./_components/AssigneeMultiSelect";
import CreateTaskSubmitButton from "./_components/CreateTaskSubmitButton";
import QuickSubtasksField from "./_components/QuickSubtasksField";
import { normalizeTasksTabKey, type TasksTabKey } from "./_components/TasksTabs";
import RouteModalOverlay from "../_components/RouteModalOverlay";
import TemplateAutoSelect from "./_components/TemplateAutoSelect";
import { DEFAULT_RECURRENCE_TZ } from "@/lib/recurrence";
import { parseTaskScheduleFormData } from "@/lib/taskSchedule";
import RecurrenceFields from "./_components/RecurrenceFields";
import {
  resolveTaskTableState,
  type TaskTablePreferenceRow,
} from "@/lib/taskTablePreferences";
import { withPerfTiming } from "@/lib/perf";
import {
  loadAssignmentGroups,
  resolveAssignmentTargetsToUserIds,
} from "@/lib/assignmentGroups";
import {
  quickCreateTaskAction,
  saveTaskTablePreferencesAction,
  updateTaskInlineAction,
} from "./actions";
import {
  createTaskLikeRoot,
  TaskCreateDbError,
  TaskCreateInputError,
} from "@/lib/tasks/createTaskLikeRoot";
import { randomUUID } from "node:crypto";
import {
  areSameValueSets,
  buildTasksRedirectUrl,
  buildTasksShellListHref,
  buildTasksUrlWithoutMessage,
  defaultTaskContentText,
  formatDbError,
  isLegacyTaskListPageSignatureError,
  isStaleLegacyTaskListPageErrorMessage,
  isTemplateStatusEnumError,
  legacyTaskListRowMatchesSearch,
  normalizeTemplateStatusForCreate,
  resolveTaskContentFromSource,
  type TaskContentSource,
  type TaskListPageRpcRow,
  type TasksPageSearchParams,
} from "./taskPageUtils";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = defaultTaskContentText;
const addTaskLabelClass =
  "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const addTaskControlClass =
  "mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addTaskTextAreaClass =
  "mt-1 min-h-36 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addTaskInlineControlClass =
  "h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const TASK_PAGE_SIZE = 50;

type TaskListRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  created_at: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type OpenSubtaskTaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
  assignee_user_ids: string[];
};

function TasksPageMessages({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!error && !success) {
    return null;
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
    </div>
  );
}

function TasksTableSkeleton() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-6 w-28 animate-pulse rounded bg-slate-100" />
          <div className="flex gap-2">
            <div className="h-9 w-24 animate-pulse rounded bg-slate-100" />
            <div className="h-9 w-24 animate-pulse rounded bg-slate-100" />
            <div className="h-9 w-24 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      </div>
      <div className="hidden divide-y divide-slate-100 md:block">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-4">
            <div className="h-4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="space-y-3 p-4 md:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-slate-200 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-slate-100" />
            <div className="mt-3 flex gap-2">
              <div className="h-6 w-20 animate-pulse rounded bg-slate-100" />
              <div className="h-6 w-24 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="mt-4 h-4 w-full animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </section>
  );
}

function TasksPageFallback({
  activeTab,
  closeHref,
}: {
  activeTab: TasksTabKey;
  closeHref: string;
}) {
  return (
    <>
      {activeTab === "add" ? (
        <RouteModalOverlay closeHref={closeHref} overlayLabel="Close add task dialog">
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-w-none rounded-t-2xl border border-slate-200 bg-white p-6 shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-5xl md:rounded-2xl">
              <div className="h-6 w-32 animate-pulse rounded bg-slate-100" />
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
              <div className="mt-6 h-10 w-32 animate-pulse rounded bg-slate-100" />
            </section>
          </div>
        </RouteModalOverlay>
      ) : null}
      <TasksTableSkeleton />
    </>
  );
}

export default async function TasksPage(props: {
  searchParams?: Promise<TasksPageSearchParams>;
}) {
  const searchParams = await props.searchParams;
  if (isStaleLegacyTaskListPageErrorMessage(searchParams?.error)) {
    redirect(buildTasksUrlWithoutMessage(searchParams));
  }

  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "tasks.page.auth");
  const authUserId = authUser?.id;
  if (!authUserId) {
    redirect("/login");
  }

  const activeTab = normalizeTasksTabKey(searchParams?.tab);
  return (
    <div className="space-y-8">
      <TasksPageMessages error={searchParams?.error} success={searchParams?.success} />
      <Suspense
        fallback={
          <TasksPageFallback
            activeTab={activeTab}
            closeHref={buildTasksShellListHref(searchParams)}
          />
        }
      >
        <TasksPageContent searchParams={searchParams} authUser={authUser} />
      </Suspense>
    </div>
  );
}

async function TasksPageContent({
  searchParams,
  authUser,
}: {
  searchParams?: TasksPageSearchParams;
  authUser: CurrentRequestUser;
}) {
  const supabase = createSupabaseServerClient();
  const authUserId = authUser.id;
  const authEmail = authUser.email || "";
  const currentUserProfileQuery = supabase.from("users").select("id,role,status");
  const { data: currentUserProfile } = await (authEmail
    ? currentUserProfileQuery.eq("email", authEmail).maybeSingle()
    : currentUserProfileQuery.eq("id", authUserId).maybeSingle());
  const currentAppUserId = currentUserProfile?.id || null;
  const currentUserRole = String(currentUserProfile?.role || "")
    .trim()
    .toLowerCase();
  const currentUserStatus = String(currentUserProfile?.status || "active")
    .trim()
    .toLowerCase();
  const isAdminUser = currentUserRole === "admin" && currentUserStatus !== "disabled";
  const assignmentUserIds = Array.from(
    new Set([authUserId, currentAppUserId].filter(Boolean))
  ) as string[];
  let taskTablePreferences: TaskTablePreferenceRow | null = null;
  if (currentAppUserId) {
    const { data, error } = await supabase
      .from("user_task_table_preferences")
      .select(
        "status,priority,assignee,due,client,project,hide_completed,include_watching,sort_key,sort_dir,view_mode"
      )
      .eq("user_id", currentAppUserId)
      .maybeSingle();
    if (error) {
      if (isSupabaseMissingTableError(error)) {
        taskTablePreferences = null;
      } else {
        logError("tasks.preferences_failed", {
          userId: currentAppUserId,
          message: error.message,
        });
      }
    } else {
      taskTablePreferences = (data || null) as TaskTablePreferenceRow | null;
    }
  }
  const statusOptionsResponse = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });
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

  const taskStatusOptionsWithMetadata = filterTaskStatusOptionsWithMetadata(
    buildStatusOptionsWithMetadata(
      "task",
      (statusOptionsRaw || []) as StatusOptionRow[],
      []
    )
  );
  const statusOptions = taskStatusOptionsWithMetadata.map((status) => status.value);
  const taskStatusColorMap = buildStatusColorMap("task", taskStatusOptionsWithMetadata);
  const hiddenTaskStatusValues = buildHiddenStatusValues("task", taskStatusOptionsWithMetadata);
  const hiddenTaskStatusSet = new Set(hiddenTaskStatusValues);

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();
  const activeTab = normalizeTasksTabKey(searchParams?.tab);
  const resolvedTaskTableState = resolveTaskTableState({
    searchParams,
    preferences: taskTablePreferences,
  });
  const {
    selectedStatusesRaw,
    selectedPrioritiesRaw,
    selectedAssigneesRaw,
    selectedClientIdsRaw,
    selectedProjectIdsRaw,
    hideCompleted,
    includeWatching,
    sortKey,
    sortDir,
    selectedView,
    hasExplicitView,
    hasExplicitPreferenceParams,
    shouldUseSavedPreferences,
    searchQuery,
    currentPage,
  } = resolvedTaskTableState;
  const hasExplicitAssigneeFilter =
    typeof searchParams?.assignee !== "undefined" || shouldUseSavedPreferences;
  let selectedDue = resolvedTaskTableState.selectedDue;

  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const effectiveSelectedStatuses = areSameValueSets(selectedStatuses, [...statusOptions])
    ? []
    : selectedStatuses;
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const shouldLoadTemplateOptions = createMode === "template";
  const taskTemplatesFromTasksPromise = shouldLoadTemplateOptions
    ? supabase
        .from("tasks")
        .select(
          "id,title,description,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
        )
        .eq("status", "template")
        .is("parent_task_id", null)
        .order("title", { ascending: true })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });
  const taskTemplatesFromTablePromise = shouldLoadTemplateOptions
    ? supabase
        .from("task_templates")
        .select(
          "id,name,title,description,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
        )
        .order("name", { ascending: true })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });
  const assignedProjectsPromise = !isAdminUser
    ? supabase
        .from("project_users")
        .select("project_id")
        .in("user_id", assignmentUserIds)
    : Promise.resolve({ data: [] as Array<{ project_id: string | null }>, error: null });

  const [
    { data: users },
    assignmentGroupsResult,
    { data: clients },
    { data: projects },
    assignedProjectsResponse,
    taskTemplatesFromTasksResponse,
    taskTemplatesFromTableResponse,
  ] = await withPerfTiming("tasks.page.lookups", () =>
    Promise.all([
      supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
      loadAssignmentGroups(supabase),
      supabase.from("clients").select("id,name").order("name", { ascending: true }),
      supabase
        .from("projects")
        .select("id,name,client_id")
        .order("name", { ascending: true }),
      assignedProjectsPromise,
      taskTemplatesFromTasksPromise,
      taskTemplatesFromTablePromise,
    ])
  );
  const assignmentGroupOptions = assignmentGroupsResult.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
  }));
  if (assignedProjectsResponse.error) {
    logError("tasks.page.project_users_failed", {
      userId: currentAppUserId,
      assignmentUserIds,
      message: assignedProjectsResponse.error.message,
    });
  }
  const assignedProjectIds = new Set(
    (assignedProjectsResponse.data || [])
      .map((row) => row.project_id)
      .filter((projectId): projectId is string => Boolean(projectId))
  );
  const clientNameByClientId = new Map((clients || []).map((client) => [client.id, client.name]));
  const projectClientNameByProjectId = new Map(
    (projects || []).map((project) => [
      project.id,
      project.client_id ? clientNameByClientId.get(project.client_id) || "" : "",
    ])
  );
  const addTaskProjects = isAdminUser
    ? (projects || [])
    : (projects || []).filter((project) => assignedProjectIds.has(project.id));
  const taskTemplatesFromTasksError = isTemplateStatusEnumError(
    taskTemplatesFromTasksResponse.error
  )
    ? null
    : taskTemplatesFromTasksResponse.error;
  const taskTemplatesFromTasksRaw = (isTemplateStatusEnumError(
    taskTemplatesFromTasksResponse.error
  )
    ? []
    : taskTemplatesFromTasksResponse.data || []) as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  }>;
  const templateStatusSupported = !isTemplateStatusEnumError(
    taskTemplatesFromTasksResponse.error
  );
  const taskTemplatesFromTableError = isSupabaseMissingTableError(
    taskTemplatesFromTableResponse.error
  )
    ? null
    : taskTemplatesFromTableResponse.error;
  const taskTemplatesFromTableRaw = (taskTemplatesFromTableResponse.data || []) as Array<{
    id: string;
    name: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  }>;

  const taskTemplatesById = new Map<
    string,
    {
      id: string;
      name: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      due_time: string | null;
      recurrence_frequency: string | null;
      recurrence_lead_days: number | null;
    }
  >();

  taskTemplatesFromTasksRaw.forEach((row) => {
    taskTemplatesById.set(row.id, {
      id: row.id,
      name: String(row.title || "").trim() || "Template",
      title: String(row.title || "").trim() || "Template",
      description: row.description || null,
      status: normalizeTemplateStatusForCreate(row.status),
      priority: String(row.priority || "medium"),
      due_time: row.due_time || null,
      recurrence_frequency: row.recurrence_frequency || null,
      recurrence_lead_days: row.recurrence_lead_days ?? 7,
    });
  });

  taskTemplatesFromTableRaw.forEach((row) => {
    const existing = taskTemplatesById.get(row.id);
    taskTemplatesById.set(row.id, {
      id: row.id,
      name:
        String(existing?.name || "").trim() ||
        String(row.name || "").trim() ||
        String(row.title || "").trim() ||
        "Template",
      title:
        String(existing?.title || "").trim() ||
        String(row.title || "").trim() ||
        String(row.name || "").trim() ||
        "Template",
      description: existing?.description || row.description || null,
      status: existing?.status || normalizeTemplateStatusForCreate(row.status),
      priority: existing?.priority || String(row.priority || "medium"),
      due_time: existing?.due_time || row.due_time || null,
      recurrence_frequency: existing?.recurrence_frequency || row.recurrence_frequency || null,
      recurrence_lead_days: existing?.recurrence_lead_days ?? row.recurrence_lead_days ?? 7,
    });
  });

  const taskTemplates = Array.from(taskTemplatesById.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const taskTemplatesError = taskTemplatesFromTasksError || taskTemplatesFromTableError;
  const selectedTemplate =
    createMode === "template" && templateTaskId
      ? taskTemplates.find((tpl) => tpl.id === templateTaskId) || null
      : null;
  const initialRecurrenceFrequency =
    selectedTemplate?.recurrence_frequency === "daily" ||
    selectedTemplate?.recurrence_frequency === "weekly" ||
    selectedTemplate?.recurrence_frequency === "monthly" ||
    selectedTemplate?.recurrence_frequency === "yearly"
      ? selectedTemplate.recurrence_frequency
      : "none";
  const templateOptions = taskTemplates.map((template) => ({
    id: template.id,
    name: template.name,
  }));

  const userIdSet = new Set((users || []).map((user) => user.id));
  const defaultAssigneeUserId =
    (currentAppUserId && userIdSet.has(currentAppUserId) && currentAppUserId) ||
    (userIdSet.has(authUserId) ? authUserId : null);
  const requestedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const selectedAssignees =
    hasExplicitAssigneeFilter || !defaultAssigneeUserId
      ? requestedAssignees
      : [defaultAssigneeUserId];
  const allAssigneeFilterValues = Array.from(new Set(["unassigned", ...Array.from(userIdSet)]));

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));
  const effectiveSelectedClientIds = areSameValueSets(selectedClientIds, Array.from(clientIdSet))
    ? []
    : selectedClientIds;
  const hasExplicitClientFilter = typeof searchParams?.client !== "undefined";
  const defaultAddClientId =
    hasExplicitClientFilter && effectiveSelectedClientIds.length === 1
      ? effectiveSelectedClientIds[0]
      : "";

  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));
  const effectiveSelectedProjectIds = areSameValueSets(selectedProjectIds, Array.from(projectIdSet))
    ? []
    : selectedProjectIds;
  const hasExplicitProjectFilter = typeof searchParams?.project !== "undefined";
  const addTaskProjectIdSet = new Set(addTaskProjects.map((project) => project.id));
  const defaultAddProjectId =
    hasExplicitProjectFilter &&
    effectiveSelectedProjectIds.length === 1 &&
    addTaskProjectIdSet.has(effectiveSelectedProjectIds[0])
      ? effectiveSelectedProjectIds[0]
      : "";

  const statusValuesForQueryParam = effectiveSelectedStatuses;
  const priorityValuesForQueryParam = areSameValueSets(selectedPriorities, [...priorityOptions])
    ? []
    : selectedPriorities;
  const assigneeValuesForQueryParam = areSameValueSets(
    selectedAssignees,
    allAssigneeFilterValues
  )
    ? []
    : selectedAssignees;
  const clientValuesForQueryParam = areSameValueSets(
    effectiveSelectedClientIds,
    Array.from(clientIdSet)
  )
    ? []
    : effectiveSelectedClientIds;
  const projectValuesForQueryParam = areSameValueSets(
    effectiveSelectedProjectIds,
    Array.from(projectIdSet)
  )
    ? []
    : effectiveSelectedProjectIds;

  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", statusValuesForQueryParam);
  setCsvParam(returnParams, "priority", priorityValuesForQueryParam);
  setCsvParam(returnParams, "assignee", assigneeValuesForQueryParam);
  if (hasExplicitAssigneeFilter && !assigneeValuesForQueryParam.length) {
    returnParams.set("assignee", "all");
  }
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  setCsvParam(returnParams, "client", clientValuesForQueryParam);
  setCsvParam(returnParams, "project", projectValuesForQueryParam);
  if (!hideCompleted) {
    returnParams.set("hide", "0");
  }
  if (sortKey !== "created" || sortDir !== "desc") {
    returnParams.set("sort", sortKey);
    returnParams.set("dir", sortDir);
  }
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  if (includeWatching) {
    returnParams.set("watch", "1");
  }
  if (searchQuery) {
    returnParams.set("q", searchQuery);
  }
  if (currentPage > 1) {
    returnParams.set("page", String(currentPage));
  }

  const returnTo = returnParams.toString() ? `/tasks?${returnParams}` : "/tasks";
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `/tasks?${toggleParams}` : "/tasks";
  const watchToggleParams = new URLSearchParams(returnParams);
  if (includeWatching) {
    watchToggleParams.delete("watch");
  } else {
    watchToggleParams.set("watch", "1");
  }
  const watchToggleUrl = watchToggleParams.toString() ? `/tasks?${watchToggleParams}` : "/tasks";

  const buildTasksUrl = (
    tab: TasksTabKey,
    params?: { error?: string; success?: string }
  ) => {
    const sp = new URLSearchParams(returnParams);

    if (tab !== "list") {
      sp.set("tab", tab);
    }
    if (params?.error) {
      sp.set("error", params.error);
    }
    if (params?.success) {
      sp.set("success", params.success);
    }

    const qs = sp.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };
  const buildAddTaskUrl = (
    mode: "new" | "template",
    templateId?: string
  ) => {
    const sp = new URLSearchParams(returnParams);
    sp.set("tab", "add");

    if (mode === "template") {
      sp.set("create_mode", "template");
      if (templateId) {
        sp.set("template_task_id", templateId);
      } else {
        sp.delete("template_task_id");
      }
    } else {
      sp.delete("create_mode");
      sp.delete("template_task_id");
    }

    const qs = sp.toString();
    return qs ? `/tasks?${qs}` : "/tasks?tab=add";
  };

  const tasksTabUrls: Record<TasksTabKey, string> = {
    list: buildTasksUrl("list"),
    add: buildTasksUrl("add"),
  };
  const addTaskModeUrls = {
    new: buildAddTaskUrl("new"),
    template: buildAddTaskUrl("template", templateTaskId || undefined),
  };

  let sortedTasks: TaskListRow[] = [];
  const assigneesByTask: Record<string, string[]> = {};
  const openSubtaskCountByTaskId: Record<string, number> = {};
  const openSubtasksByParentId: Record<string, OpenSubtaskTaskRow[]> = {};
  const initialNextSubtaskDueDateByTaskId: Record<string, string | null> = {};
  let totalTaskCount = 0;

  if (activeTab === "list") {
    const wantsUnassigned = selectedAssignees.includes("unassigned");
    const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");
    const wantsHiddenStatuses = effectiveSelectedStatuses.some((status) =>
      hiddenTaskStatusSet.has(status)
    );
    const wantsTemplateStatus = effectiveSelectedStatuses.includes("template");

    const todayIso = new Date().toISOString().slice(0, 10);
    const hiddenStatusesForQuery =
      hideCompleted && hiddenTaskStatusValues.length && !wantsHiddenStatuses
        ? hiddenTaskStatusValues
        : [];

    const taskListParams = {
      p_user_ids: assignmentUserIds,
      p_is_admin: isAdminUser,
      p_include_watching: includeWatching,
      p_statuses: expandTaskStatusFilterForQuery(effectiveSelectedStatuses),
      p_priorities: selectedPriorities,
      p_assignee_user_ids: selectedAssigneeIds,
      p_include_unassigned: wantsUnassigned,
      p_client_ids: effectiveSelectedClientIds,
      p_project_ids: effectiveSelectedProjectIds,
      p_hidden_statuses: hiddenStatusesForQuery,
      p_hidden_subtask_statuses: hiddenTaskStatusValues,
      p_exclude_template: templateStatusSupported && !wantsTemplateStatus,
      p_due_filter: selectedDue,
      p_today: todayIso,
      p_sort_key: sortKey,
      p_sort_dir: sortDir,
      p_status_order: statusOptions,
      p_limit: TASK_PAGE_SIZE,
      p_offset: (currentPage - 1) * TASK_PAGE_SIZE,
      p_query: searchQuery,
    };

    let { data: taskRowsRaw, error: taskListError } = await withPerfTiming(
      "tasks.page.task_list_page",
      () =>
        supabase.rpc("task_list_page", taskListParams)
    );

    if (taskListError && isLegacyTaskListPageSignatureError(taskListError)) {
      const legacyLimit = Math.min(Math.max(currentPage * TASK_PAGE_SIZE, TASK_PAGE_SIZE), 500);
      const legacyTaskListParams = {
        p_user_ids: taskListParams.p_user_ids,
        p_is_admin: taskListParams.p_is_admin,
        p_include_watching: taskListParams.p_include_watching,
        p_statuses: taskListParams.p_statuses,
        p_priorities: taskListParams.p_priorities,
        p_assignee_user_ids: taskListParams.p_assignee_user_ids,
        p_include_unassigned: taskListParams.p_include_unassigned,
        p_client_ids: taskListParams.p_client_ids,
        p_project_ids: taskListParams.p_project_ids,
        p_hidden_statuses: taskListParams.p_hidden_statuses,
        p_hidden_subtask_statuses: taskListParams.p_hidden_subtask_statuses,
        p_exclude_template: taskListParams.p_exclude_template,
        p_due_filter: taskListParams.p_due_filter,
        p_today: taskListParams.p_today,
        p_sort_key: sortKey === "queue" ? "due" : taskListParams.p_sort_key,
        p_sort_dir: taskListParams.p_sort_dir,
        p_status_order: taskListParams.p_status_order,
        p_limit: legacyLimit,
      };
      const legacyResponse = await withPerfTiming("tasks.page.task_list_page.legacy", () =>
        supabase.rpc("task_list_page", legacyTaskListParams)
      );

      if (!legacyResponse.error) {
        const legacyRows = ((legacyResponse.data || []) as TaskListPageRpcRow[]).filter((row) =>
          legacyTaskListRowMatchesSearch(row, searchQuery)
        );
        const legacyPageRows = legacyRows
          .slice((currentPage - 1) * TASK_PAGE_SIZE, currentPage * TASK_PAGE_SIZE)
          .map((row) => ({ ...row, total_count: legacyRows.length }));
        taskRowsRaw = legacyPageRows;
        taskListError = null;
      } else {
        taskListError = legacyResponse.error;
      }
    }

    if (taskListError) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          error: formatDbError("tasks.page.task_list_page", taskListError),
        })
      );
    }

    const taskRows = (taskRowsRaw || []) as TaskListPageRpcRow[];
    if (!taskRows.length && currentPage > 1) {
      const resetPageParams = new URLSearchParams(returnParams);
      resetPageParams.delete("page");
      const resetPageQuery = resetPageParams.toString();
      redirect(resetPageQuery ? `/tasks?${resetPageQuery}` : "/tasks");
    }
    totalTaskCount = Number(taskRows[0]?.total_count || 0);
    sortedTasks = taskRows.map((row) => {
      const task: TaskListRow = {
        id: row.id,
        title: String(row.title || "").trim() || "Untitled task",
        status: row.status,
        priority: row.priority,
        start_date: row.start_date,
        due_date: row.due_date,
        due_time: row.due_time,
        created_at: row.created_at,
        assignee_user_id: row.assignee_user_id,
        client_id: row.client_id,
        project_id: row.project_id,
        clients: row.client_id ? { name: row.client_name || "" } : null,
        projects: row.project_id ? { name: row.project_name || "" } : null,
      };

      const assigneeIds = Array.isArray(row.assignee_user_ids)
        ? row.assignee_user_ids.filter(Boolean)
        : [];
      if (row.assignee_user_id && !assigneeIds.includes(row.assignee_user_id)) {
        assigneeIds.push(row.assignee_user_id);
      }
      assigneesByTask[row.id] = assigneeIds;

      const openSubtaskCount = Number(row.open_subtask_count || 0);
      if (Number.isFinite(openSubtaskCount) && openSubtaskCount > 0) {
        openSubtaskCountByTaskId[row.id] = openSubtaskCount;
      }

      const nextSubtaskDueDate = String(row.next_subtask_due_date || "").trim();
      if (nextSubtaskDueDate) {
        initialNextSubtaskDueDateByTaskId[row.id] = nextSubtaskDueDate;
      }

      return task;
    });
  }

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const actionAuthUser = await getCurrentRequestUser(supabase, "tasks.create.auth");
    if (!actionAuthUser?.id) {
      redirect("/login");
    }
    const authEmail = String(actionAuthUser.email || "").trim();
    const { data: actionCurrentUserProfile } = await supabase
      .from("users")
      .select("id,role,status")
      .eq("email", authEmail)
      .maybeSingle();
    const actionCurrentAppUserId = actionCurrentUserProfile?.id || null;
    const actionCurrentUserRole = String(actionCurrentUserProfile?.role || "")
      .trim()
      .toLowerCase();
    const actionCurrentUserStatus = String(actionCurrentUserProfile?.status || "active")
      .trim()
      .toLowerCase();
    const isActionAdminUser =
      actionCurrentUserRole === "admin" && actionCurrentUserStatus !== "disabled";
    const projectAssignmentUserIds = Array.from(
      new Set([actionAuthUser.id, actionCurrentAppUserId].filter(Boolean))
    ) as string[];
    const title = String(formData.get("title") || "").trim();
    const taskNotesText = String(formData.get("notes") || "").trim();
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const priority = String(formData.get("priority") || "medium");
    const assigneeResolution = await resolveAssignmentTargetsToUserIds(
      supabase,
      [...formData.getAll("assignee_user_ids"), formData.get("assignee_user_id")]
    );
    if (assigneeResolution.error) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: assigneeResolution.error,
        })
      );
    }
    const assigneeIds = assigneeResolution.userIds;
    const templateTaskIdFromForm = String(formData.get("template_task_id") || "").trim();
    const clientIdRaw = String(formData.get("client_id") || "").trim();
    const projectIdRaw = String(formData.get("project_id") || "").trim();
    let clientId = clientIdRaw || null;
    const projectId = projectIdRaw || null;
    const manualSubtaskTitles = formData
      .getAll("subtask_titles")
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (!title) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: "Title is required",
        })
      );
    }

    if (projectId && !isActionAdminUser) {
      if (!projectAssignmentUserIds.length) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: "You can only create tasks in projects you're assigned to",
          })
        );
      }

      const { data: projectAssignmentRows, error: projectAssignmentError } = await supabase
        .from("project_users")
        .select("project_id")
        .eq("project_id", projectId)
        .in("user_id", projectAssignmentUserIds)
        .limit(1);

      if (projectAssignmentError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: formatDbError(
              "tasks.createTask.project_users.select",
              projectAssignmentError
            ),
          })
        );
      }

      if (!(projectAssignmentRows || []).length) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: "You can only create tasks in projects you're assigned to",
          })
        );
      }
    }

    const scheduleResult = parseTaskScheduleFormData(formData, DEFAULT_RECURRENCE_TZ);
    if (scheduleResult.error || !scheduleResult.value) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: scheduleResult.error || "Invalid schedule",
        })
      );
    }
    const schedule = scheduleResult.value;

    if (projectId && !clientId) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("client_id")
        .eq("id", projectId)
        .maybeSingle();

      if (error) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: error.message,
          })
        );
      }

      clientId = project?.client_id || null;
    }

    const manualAssigneeIds = Array.from(new Set(assigneeIds));
    let templateAssigneeIds: string[] = [];
    let templateContentSource: TaskContentSource | null = null;
    if (templateTaskIdFromForm) {
      const [
        templateTaskResponse,
        templateAssigneesResponse,
        templateTableAssigneesResponse,
        templateTableResponse,
      ] = await Promise.all([
        supabase
          .from("tasks")
          .select("assignee_user_id,description,content,content_text")
          .eq("id", templateTaskIdFromForm)
          .maybeSingle(),
        supabase
          .from("task_assignees")
          .select("user_id")
          .eq("task_id", templateTaskIdFromForm),
        supabase
          .from("task_template_assignees")
          .select("user_id")
          .eq("task_template_id", templateTaskIdFromForm),
        supabase
          .from("task_templates")
          .select("description")
          .eq("id", templateTaskIdFromForm)
          .maybeSingle(),
      ]);

      if (templateTaskResponse.error) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateTaskResponse.error.message,
          })
        );
      }
      if (templateAssigneesResponse.error) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateAssigneesResponse.error.message,
          })
        );
      }
      if (
        templateTableAssigneesResponse.error &&
        !isSupabaseMissingTableError(templateTableAssigneesResponse.error)
      ) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateTableAssigneesResponse.error.message,
          })
        );
      }
      if (
        templateTableResponse.error &&
        !isSupabaseMissingTableError(templateTableResponse.error)
      ) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateTableResponse.error.message,
          })
        );
      }

      templateAssigneeIds = Array.from(
        new Set(
          [
            templateTaskResponse.data?.assignee_user_id || null,
            ...(templateAssigneesResponse.data || []).map((row) => row.user_id),
            ...(templateTableAssigneesResponse.data || []).map((row) => row.user_id),
          ].filter(Boolean)
        )
      ) as string[];
      templateContentSource =
        (templateTaskResponse.data as TaskContentSource | null) ||
        (templateTableResponse.error
          ? null
          : (templateTableResponse.data as TaskContentSource | null));
    }
    const uniqueAssigneeIds = Array.from(
      new Set([...manualAssigneeIds, ...templateAssigneeIds])
    );
    const fallbackAssigneeId = defaultAssigneeUserId || null;
    const primaryAssignee = uniqueAssigneeIds[0] || fallbackAssigneeId || "";
    const effectiveAssigneeIds = uniqueAssigneeIds.length
      ? uniqueAssigneeIds
      : primaryAssignee
        ? [primaryAssignee]
        : [];

    const manualContent = taskNotesText
      ? {
          content: plainTextToTiptapDoc(taskNotesText),
          contentText: taskNotesText,
        }
      : null;
    const templateContent = resolveTaskContentFromSource(templateContentSource);
    const taskContent = manualContent || templateContent;
    let taskId: string;
    try {
      const createdTask = await createTaskLikeRoot({
        supabase,
        context: "tasks.createTask",
        title,
        status,
        priority,
        clientId,
        projectId,
        dueDate: schedule.dueDate,
        dueTime: schedule.dueTime,
        startDate: schedule.startDate,
        createdByUserId: actionAuthUser.id,
        assigneeUserIds: uniqueAssigneeIds,
        defaultAssigneeUserId: fallbackAssigneeId,
        recurrenceValues: schedule.recurrenceConfig
          ? {
              recurrence_frequency: schedule.recurrenceConfig.frequency,
              recurrence_interval: schedule.recurrenceConfig.interval,
              recurrence_weekdays: schedule.recurrenceConfig.weekdays,
              recurrence_month_day: schedule.recurrenceConfig.monthDay,
              recurrence_month_week: schedule.recurrenceConfig.monthWeek,
              recurrence_month_weekday: schedule.recurrenceConfig.monthWeekday,
              recurrence_start_date: schedule.recurrenceConfig.startDate,
              recurrence_end_date: schedule.recurrenceConfig.endDate,
              recurrence_lead_days: schedule.recurrenceLeadDays,
              recurrence_next_date: schedule.recurrenceNextDate,
              recurrence_timezone: schedule.recurrenceTimezone,
            }
          : null,
        content: taskContent.content,
        contentText: taskContent.contentText,
      });
      taskId = createdTask.taskId;
    } catch (error) {
      if (error instanceof TaskCreateDbError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: formatDbError(error.context, error.dbError),
          })
        );
      }
      if (error instanceof TaskCreateInputError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: error.message,
          })
        );
      }
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: error instanceof Error ? error.message : "Unable to create task",
        })
      );
    }

    if (taskId && manualSubtaskTitles.length) {
      const manualSubtaskRows = manualSubtaskTitles.map((subtaskTitle) => ({
        id: randomUUID(),
        client_id: clientId,
        project_id: projectId,
        parent_task_id: taskId,
        title: subtaskTitle,
        status: normalizeTaskStatusOrDefault("to_do"),
        priority,
        due_date: null,
        due_time: null,
        assignee_user_id: primaryAssignee || null,
        created_by_user_id: actionAuthUser.id,
        content: DEFAULT_EDITOR_CONTENT,
        content_text: defaultContentText,
      }));

      const { error: manualSubtaskInsertError } = await supabase
        .from("tasks")
        .insert(manualSubtaskRows);

      if (manualSubtaskInsertError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: formatDbError(
              "tasks.createTask.manualSubtasks.tasks.insert",
              manualSubtaskInsertError
            ),
          })
        );
      }

      const manualSubtaskAssigneeRows = manualSubtaskRows.flatMap((row) =>
        effectiveAssigneeIds.map((userId) => ({ task_id: row.id, user_id: userId }))
      );

      if (manualSubtaskAssigneeRows.length) {
        const { error: manualSubtaskAssigneesError } = await supabase
          .from("task_assignees")
          .insert(manualSubtaskAssigneeRows);
        if (manualSubtaskAssigneesError) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: manualSubtaskAssigneesError.message,
            })
          );
        }
      }
    }

    if (taskId && templateTaskIdFromForm) {
      const [templateTaskFieldsResponse, templateTableFieldsResponse] = await Promise.all([
        supabase
          .from("custom_fields")
          .select("id,key,label,field_kind,position")
          .eq("entity_type", "task")
          .eq("entity_id", templateTaskIdFromForm),
        supabase
          .from("custom_fields")
          .select("id,key,label,field_kind,position")
          .eq("entity_type", "task_template")
          .eq("entity_id", templateTaskIdFromForm),
      ]);
      if (
        templateTaskFieldsResponse.error &&
        !isSupabaseMissingTableError(templateTaskFieldsResponse.error)
      ) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateTaskFieldsResponse.error.message,
          })
        );
      }
      if (
        templateTableFieldsResponse.error &&
        !isSupabaseMissingTableError(templateTableFieldsResponse.error)
      ) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateTableFieldsResponse.error.message,
          })
        );
      }

      const taskEntityFields = (templateTaskFieldsResponse.error
        ? []
        : templateTaskFieldsResponse.data || []) as Array<{
        id: string;
        key: string;
        label: string;
        field_kind: "text" | "dropdown" | "date" | "client";
        position: number;
      }>;
      const taskTemplateEntityFields = (templateTableFieldsResponse.error
        ? []
        : templateTableFieldsResponse.data || []) as Array<{
        id: string;
        key: string;
        label: string;
        field_kind: "text" | "dropdown" | "date" | "client";
        position: number;
      }>;
      const templateSourceEntityType: "task" | "task_template" = taskEntityFields.length
        ? "task"
        : "task_template";
      const templateCustomFields = (
        taskEntityFields.length ? taskEntityFields : taskTemplateEntityFields
      ) as Array<{
        id: string;
        key: string;
        label: string;
        field_kind: "text" | "dropdown" | "date" | "client";
        position: number;
      }>;
      const templateCustomFieldIds = templateCustomFields.map((field) => field.id);
      if (templateCustomFieldIds.length) {
        const { data: templateCustomOptionsRaw, error: templateCustomOptionsError } = await supabase
          .from("custom_field_options")
          .select("field_id,value,position")
          .in("field_id", templateCustomFieldIds)
          .order("position", { ascending: true });
        if (templateCustomOptionsError && !isSupabaseMissingTableError(templateCustomOptionsError)) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: templateCustomOptionsError.message,
            })
          );
        }

        const { data: templateCustomValuesRaw, error: templateCustomValuesError } = await supabase
          .from("custom_field_values")
          .select("field_id,text_value,option_value")
          .eq("entity_type", templateSourceEntityType)
          .eq("entity_id", templateTaskIdFromForm)
          .in("field_id", templateCustomFieldIds);
        if (templateCustomValuesError && !isSupabaseMissingTableError(templateCustomValuesError)) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: templateCustomValuesError.message,
            })
          );
        }

        const templateCustomValues = (templateCustomValuesError
          ? []
          : templateCustomValuesRaw || []) as Array<{
          field_id: string;
          text_value: string | null;
          option_value: string | null;
        }>;
        const templateCustomOptions = (templateCustomOptionsError
          ? []
          : templateCustomOptionsRaw || []) as Array<{
          field_id: string;
          value: string;
          position: number;
        }>;

        const { data: createdFields, error: createFieldsError } = await supabase
          .from("custom_fields")
          .insert(
            templateCustomFields.map((field) => ({
              entity_type: "task",
              entity_id: taskId,
              key: field.key,
              label: field.label,
              field_kind: field.field_kind,
              position: field.position,
            }))
          )
          .select("id,key");
        if (createFieldsError && !isSupabaseMissingTableError(createFieldsError)) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: createFieldsError.message,
            })
          );
        }

        const fieldIdByTemplateId = new Map<string, string>();
        for (const templateField of templateCustomFields) {
          const match = (createdFields || []).find((field) => field.key === templateField.key);
          if (match?.id) {
            fieldIdByTemplateId.set(templateField.id, match.id);
          }
        }

        const optionInserts = templateCustomOptions
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
          const { error: optionsCopyError } = await supabase
            .from("custom_field_options")
            .insert(optionInserts);
          if (optionsCopyError && !isSupabaseMissingTableError(optionsCopyError)) {
            redirect(
              buildTasksRedirectUrl(returnTo, {
                tab: "add",
                error: optionsCopyError.message,
              })
            );
          }
        }

        const valueInserts = templateCustomValues
          .map((row) => {
            const clonedFieldId = fieldIdByTemplateId.get(row.field_id);
            if (!clonedFieldId) return null;
            const fieldKind =
              templateCustomFields.find((field) => field.id === row.field_id)?.field_kind ||
              "text";
            return {
              entity_type: "task",
              entity_id: taskId,
              field_id: clonedFieldId,
              text_value: fieldKind === "dropdown" ? null : row.text_value,
              option_value: fieldKind === "dropdown" ? row.option_value : null,
            };
          })
          .filter(Boolean) as Array<{
          entity_type: "task";
          entity_id: string;
          field_id: string;
          text_value: string | null;
          option_value: string | null;
        }>;
        if (valueInserts.length) {
          const { error: customValuesError } = await supabase
            .from("custom_field_values")
            .upsert(valueInserts, { onConflict: "entity_type,entity_id,field_id" });
          if (customValuesError && !isSupabaseMissingTableError(customValuesError)) {
            redirect(
              buildTasksRedirectUrl(returnTo, {
                tab: "add",
                error: customValuesError.message,
              })
            );
          }
        }
      }
    }
    if (taskId && templateTaskIdFromForm) {
      let subtaskTemplates: Array<{
        id: string;
        title: string;
        description: string | null;
        content?: unknown | null;
        content_text?: string | null;
        status: string;
        priority: string;
        assignee_user_id?: string | null;
      }> = [];
      const assigneeIdsBySubtaskTemplateId: Record<string, string[]> = {};

      const { data: mirroredSubtasksRaw, error: mirroredSubtasksError } = await supabase
        .from("tasks")
        .select("id,title,description,content,content_text,status,priority,assignee_user_id")
        .eq("parent_task_id", templateTaskIdFromForm)
        .order("created_at", { ascending: true });
      if (mirroredSubtasksError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: mirroredSubtasksError.message,
          })
        );
      }
      const mirroredSubtasks = (mirroredSubtasksRaw || []) as Array<{
        id: string;
        title: string;
        description: string | null;
        content?: unknown | null;
        content_text?: string | null;
        status: string;
        priority: string;
        assignee_user_id?: string | null;
      }>;

      if (mirroredSubtasks.length) {
        subtaskTemplates = mirroredSubtasks;
        const mirroredSubtaskIds = mirroredSubtasks.map((tpl) => tpl.id).filter(Boolean);
        if (mirroredSubtaskIds.length) {
          const { data: taskAssigneesRaw, error: taskAssigneesError } = await supabase
            .from("task_assignees")
            .select("task_id,user_id")
            .in("task_id", mirroredSubtaskIds);
          if (taskAssigneesError) {
            redirect(
              buildTasksRedirectUrl(returnTo, {
                tab: "add",
                error: taskAssigneesError.message,
              })
            );
          }
          (taskAssigneesRaw || []).forEach((row) => {
            assigneeIdsBySubtaskTemplateId[row.task_id] ||= [];
            assigneeIdsBySubtaskTemplateId[row.task_id].push(row.user_id);
          });
        }
      } else {
        const { data: templateSubtasksRaw, error: templateSubtasksError } = await supabase
          .from("task_template_subtasks")
          .select("id,title,description,status,priority")
          .eq("task_template_id", templateTaskIdFromForm)
          .order("position", { ascending: true });
        if (templateSubtasksError && !isSupabaseMissingTableError(templateSubtasksError)) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: templateSubtasksError.message,
            })
          );
        }
        subtaskTemplates = ((templateSubtasksRaw || []) as Array<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          priority: string;
        }>).map((row) => ({
          ...row,
          assignee_user_id: null,
        }));

        const templateSubtaskIds = subtaskTemplates.map((tpl) => tpl.id).filter(Boolean);
        if (templateSubtaskIds.length) {
          const { data: templateSubtaskAssigneesRaw, error: templateSubtaskAssigneesError } =
            await supabase
              .from("task_template_subtask_assignees")
              .select("task_template_subtask_id,user_id")
              .in("task_template_subtask_id", templateSubtaskIds);
          if (
            templateSubtaskAssigneesError &&
            !isSupabaseMissingTableError(templateSubtaskAssigneesError)
          ) {
            redirect(
              buildTasksRedirectUrl(returnTo, {
                tab: "add",
                error: templateSubtaskAssigneesError.message,
              })
            );
          }
          (templateSubtaskAssigneesRaw || []).forEach((row) => {
            assigneeIdsBySubtaskTemplateId[row.task_template_subtask_id] ||= [];
            assigneeIdsBySubtaskTemplateId[row.task_template_subtask_id].push(row.user_id);
          });
        }
      }

      subtaskTemplates.forEach((tpl) => {
        if (!tpl.assignee_user_id) return;
        assigneeIdsBySubtaskTemplateId[tpl.id] ||= [];
        assigneeIdsBySubtaskTemplateId[tpl.id].push(tpl.assignee_user_id);
      });

      if (subtaskTemplates.length) {
        const primaryAssigneeForSubtasks = primaryAssignee || null;
        const subtaskPlans = subtaskTemplates.map((tpl) => {
          const subtaskAssigneeIds = Array.from(
            new Set(assigneeIdsBySubtaskTemplateId[tpl.id] || [])
          );
          const primarySubtaskAssignee =
            subtaskAssigneeIds[0] || primaryAssigneeForSubtasks;
          const subtaskContent = resolveTaskContentFromSource(tpl);
          return {
            assigneeIds: subtaskAssigneeIds,
            payload: {
              client_id: clientId,
              project_id: projectId,
              parent_task_id: taskId,
              title: tpl.title,
              status: normalizeTaskStatusOrDefault(String(tpl.status || "to_do")),
              priority: String(tpl.priority || "medium"),
              due_date: null,
              due_time: null,
              assignee_user_id: primarySubtaskAssignee,
              created_by_user_id: actionAuthUser.id,
              content: subtaskContent.content,
              content_text: subtaskContent.contentText,
            },
          };
        });

        const subtaskRows = subtaskPlans.map((plan) => ({
          id: randomUUID(),
          ...plan.payload,
        }));

        const { error: subtaskInsertError } = await supabase
          .from("tasks")
          .insert(subtaskRows);

        if (subtaskInsertError) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: formatDbError(
                "tasks.createTask.templateSubtasks.tasks.insert",
                subtaskInsertError
              ),
            })
          );
        }

        const inserts = subtaskRows.flatMap((row, index) => {
          const explicitIds = subtaskPlans[index]?.assigneeIds || [];
          const effectiveIds = explicitIds.length ? explicitIds : effectiveAssigneeIds;
          return effectiveIds.map((userId) => ({ task_id: row.id as string, user_id: userId }));
        });
        if (inserts.length) {
          const { error: subtaskAssigneesError } = await supabase
            .from("task_assignees")
            .insert(inserts);
          if (subtaskAssigneesError) {
            redirect(
              buildTasksRedirectUrl(returnTo, {
                tab: "add",
                error: subtaskAssigneesError.message,
              })
            );
          }
        }
      }
    }

    revalidatePath("/tasks");
    redirect(buildTasksRedirectUrl(returnTo, { success: "Task created" }));
  }

  return (
    <>
      {!users?.length ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">No users found.</p>
          <p className="mt-1">
            Ask an admin to create a user profile in Admin {">"} Users to enable task assignment.
          </p>
        </section>
      ) : null}

      {activeTab === "add" ? (
        <RouteModalOverlay
          closeHref={tasksTabUrls.list}
          overlayLabel="Close add task dialog"
        >
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-w-none max-h-[92vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-5xl md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold text-slate-900">Add task</h2>
                <a
                  href={tasksTabUrls.list}
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
                        href={addTaskModeUrls.new}
                        className={`inline-flex min-h-11 items-center rounded-md px-3 py-1.5 font-medium ${
                          createMode === "new"
                            ? "tab-active"
                            : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        New task
                      </Link>
                      <Link
                        href={
                          templateTaskId
                            ? buildAddTaskUrl("template", templateTaskId)
                            : addTaskModeUrls.template
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
                      <TemplateAutoSelect
                        templates={templateOptions}
                        selectedTemplateId={selectedTemplate?.id || ""}
                        preservedQuery={returnParams.toString()}
                        disabled={Boolean(taskTemplatesError)}
                        className={`min-w-[16rem] ${addTaskInlineControlClass}`}
                      />
                    ) : null}
                  </div>

                  {createMode === "template" && taskTemplatesError ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                      Template status is not fully set up yet. Run `sql/task_status_add_template.sql`,
                      then run `sql/task_templates_as_tasks.sql`, then refresh this page.
                    </p>
                  ) : null}

                  {createMode === "template" && !selectedTemplate ? (
                    <div className="mt-5 rounded-xl bg-slate-50/70 px-4 py-6 text-sm text-slate-600 ring-1 ring-slate-100">
                      Select a template to load task details.
                    </div>
                  ) : (
                    <form action={createTask} className="mt-5 grid gap-5 md:grid-cols-6">
                      {createMode === "template" && selectedTemplate ? (
                        <>
                          <input type="hidden" name="create_mode" value="template" />
                          <input
                            type="hidden"
                            name="template_task_id"
                            value={selectedTemplate.id}
                          />
                        </>
                      ) : null}
                      <div className="md:col-span-6 grid gap-4">
                        <div>
                          <label className={addTaskLabelClass}>Title</label>
                          <input
                            name="title"
                            placeholder="Task title"
                            className={addTaskControlClass}
                            defaultValue={selectedTemplate?.title || ""}
                            autoFocus
                            required
                          />
                        </div>
                        <div>
                          <label className={addTaskLabelClass}>Task notes</label>
                          <textarea
                            name="notes"
                            placeholder="Add notes"
                            className={addTaskTextAreaClass}
                            defaultValue={selectedTemplate?.description || ""}
                          />
                        </div>
                      </div>

                      <QuickSubtasksField />

                      <details className="md:col-span-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5">
                        <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">
                          More options
                        </summary>
                        <div className="mt-4 grid gap-4 md:grid-cols-6">
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Client</label>
                            <select
                              name="client_id"
                              className={addTaskControlClass}
                              defaultValue={defaultAddClientId}
                            >
                              <option value="">Client (N/A)</option>
                              {clients?.map((client) => (
                                <option key={client.id} value={client.id}>
                                  {client.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Project</label>
                            <select
                              name="project_id"
                              className={addTaskControlClass}
                              defaultValue={defaultAddProjectId}
                            >
                              <option value="">Project (N/A)</option>
                              {addTaskProjects?.map((project) => {
                                const projectClientName =
                                  projectClientNameByProjectId.get(project.id) || "";
                                return (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                    {projectClientName ? ` - ${projectClientName}` : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Assignees</label>
                            <div className="mt-1 relative">
                              <AssigneeMultiSelect
                                users={users || []}
                                groups={assignmentGroupOptions}
                                name="assignee_user_ids"
                                defaultSelected={
                                  createMode === "new" && defaultAssigneeUserId
                                    ? [defaultAssigneeUserId]
                                    : []
                                }
                              />
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Status</label>
                            <select
                              name="status"
                              className={addTaskControlClass}
                              defaultValue={selectedTemplate?.status || "to_do"}
                            >
                              {statusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {formatTaskStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Priority</label>
                            <select
                              name="priority"
                              className={addTaskControlClass}
                              defaultValue={selectedTemplate?.priority || "medium"}
                            >
                              {priorityOptions.map((priority) => (
                                <option key={priority} value={priority}>
                                  {priority}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-6">
                            <RecurrenceFields
                              initialFrequency={initialRecurrenceFrequency}
                              initialDueTime={selectedTemplate?.due_time || undefined}
                              initialLeadDays={selectedTemplate?.recurrence_lead_days ?? 7}
                            />
                          </div>
                        </div>
                      </details>
                      <div className="md:col-span-6 flex justify-end">
                        <CreateTaskSubmitButton />
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
        <TasksView
          tasks={sortedTasks}
          users={users || []}
          groups={assignmentGroupOptions}
          clients={clients || []}
          projects={projects || []}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          openSubtasksByParentId={openSubtasksByParentId}
          initialNextSubtaskDueDateByTaskId={initialNextSubtaskDueDateByTaskId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          returnTo={returnTo}
          initialFilters={{
            status: effectiveSelectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: effectiveSelectedClientIds,
            project: effectiveSelectedProjectIds,
          }}
          onUpdate={updateTaskInlineAction}
          hideCompleted={hideCompleted}
          hiddenStatusValues={hiddenTaskStatusValues}
          statusColorMap={taskStatusColorMap}
          toggleUrl={toggleUrl}
          includeWatching={includeWatching}
          watchToggleUrl={watchToggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          addTaskUrl={tasksTabUrls.add}
          showHeaderTitle={false}
          initialView={selectedView}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
          searchQuery={searchQuery}
          currentPage={currentPage}
          pageSize={TASK_PAGE_SIZE}
          totalTaskCount={totalTaskCount}
          onSavePreferences={saveTaskTablePreferencesAction}
          onQuickCreate={quickCreateTaskAction}
          hasExplicitFilterParams={hasExplicitPreferenceParams}
          columnPreferenceUserId={currentAppUserId || authUserId}
        />
      </section>
    </>
  );
}

