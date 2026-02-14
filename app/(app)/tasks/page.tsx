import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
import {
  buildStatusOptions,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import TasksView from "./TasksView";
import AssigneeMultiSelect from "./_components/AssigneeMultiSelect";
import TasksTabs, {
  normalizeTasksTabKey,
  type TasksTabKey,
} from "./_components/TasksTabs";
import TemplateAutoSelect from "./_components/TemplateAutoSelect";
import { DEFAULT_RECURRENCE_TZ } from "@/lib/recurrence";
import { parseTaskScheduleFormData } from "@/lib/taskSchedule";
import RecurrenceFields from "./_components/RecurrenceFields";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import { updateTaskInlineAction } from "./actions";
import { randomUUID } from "node:crypto";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);
const addTaskLabelClass =
  "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const addTaskControlClass =
  "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addTaskInlineControlClass =
  "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const addTaskPanelClass =
  "rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-100 md:p-5";
const addTaskPanelTitleClass =
  "text-xs font-semibold uppercase tracking-wide text-slate-500";

type UserTaskTablePreferencesRow = {
  status: string[] | null;
  priority: string[] | null;
  assignee: string[] | null;
  due: string | null;
  client: string[] | null;
  project: string[] | null;
  hide_completed: boolean | null;
  include_watching: boolean | null;
  sort_key: string | null;
  sort_dir: string | null;
  view_mode: string | null;
};

function isTemplateStatusEnumError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return message.includes("invalid input value for enum") && message.includes("template");
}

function normalizePreferenceValues(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

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

function buildTasksRedirectUrl(
  baseUrl: string,
  params: { tab?: "list" | "add"; error?: string; success?: string }
) {
  const [path, queryString = ""] = baseUrl.split("?");
  const sp = new URLSearchParams(queryString);

  if (params.tab && params.tab !== "list") {
    sp.set("tab", params.tab);
  } else {
    sp.delete("tab");
  }

  if (params.error) {
    sp.set("error", params.error);
  } else {
    sp.delete("error");
  }

  if (params.success) {
    sp.set("success", params.success);
  } else {
    sp.delete("success");
  }

  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export default async function TasksPage(props: {
  searchParams?: Promise<{
    tab?: string;
    view?: string;
    create_mode?: string;
    template_task_id?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    client?: string | string[];
    project?: string | string[];
    hide?: string;
    watch?: string;
    sort?: string;
    dir?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData.user?.id;
  if (!authUserId) {
    redirect("/login");
  }
  const { data: currentUserProfile } = await supabase
    .from("users")
    .select("id")
    .eq("email", authData.user?.email || "")
    .maybeSingle();
  const currentAppUserId = currentUserProfile?.id || null;
  const assignmentUserIds = Array.from(
    new Set([authUserId, currentAppUserId].filter(Boolean))
  ) as string[];
  let taskTablePreferences: UserTaskTablePreferencesRow | null = null;
  let taskPreferencesAvailable = true;
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
        taskPreferencesAvailable = false;
      } else {
        console.error("[tasks.preferences.select]", error.message);
      }
    } else {
      taskTablePreferences = (data || null) as UserTaskTablePreferencesRow | null;
    }
  }
  const { data: statusOptionsRaw } = await supabase
    .from("status_options")
    .select("entity_type,value,position")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });
  const statusOptions = buildStatusOptions(
    "task",
    (statusOptionsRaw || []) as StatusOptionRow[],
    TASK_STATUS_OPTIONS
  );

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();

  const viewSource =
    typeof searchParams?.view !== "undefined"
      ? searchParams?.view
      : taskTablePreferences?.view_mode;
  const viewRaw = String(viewSource || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";

  const sortSource =
    typeof searchParams?.sort !== "undefined"
      ? searchParams?.sort
      : taskTablePreferences?.sort_key;
  const dirSource =
    typeof searchParams?.dir !== "undefined"
      ? searchParams?.dir
      : taskTablePreferences?.sort_dir;
  const sortKey = normalizeTaskSortKey(sortSource as string | undefined);
  const sortDir = normalizeTaskSortDir(dirSource as string | undefined);

  const selectedStatusesRaw =
    typeof searchParams?.status !== "undefined"
      ? parseCsvParam(searchParams?.status)
      : normalizePreferenceValues(taskTablePreferences?.status);
  const selectedPrioritiesRaw =
    typeof searchParams?.priority !== "undefined"
      ? parseCsvParam(searchParams?.priority)
      : normalizePreferenceValues(taskTablePreferences?.priority);
  const selectedAssigneesRaw =
    typeof searchParams?.assignee !== "undefined"
      ? parseCsvParam(searchParams?.assignee)
      : normalizePreferenceValues(taskTablePreferences?.assignee);
  const selectedClientIdsRaw =
    typeof searchParams?.client !== "undefined"
      ? parseCsvParam(searchParams?.client)
      : normalizePreferenceValues(taskTablePreferences?.client);
  const selectedProjectIdsRaw =
    typeof searchParams?.project !== "undefined"
      ? parseCsvParam(searchParams?.project)
      : normalizePreferenceValues(taskTablePreferences?.project);
  const dueSource =
    typeof searchParams?.due !== "undefined"
      ? searchParams?.due
      : taskTablePreferences?.due;
  let selectedDue = String(dueSource || "all").trim();
  const hideCompleted =
    typeof searchParams?.hide !== "undefined"
      ? (searchParams?.hide ?? "1").trim() !== "0"
      : taskTablePreferences?.hide_completed ?? true;
  const includeWatching =
    typeof searchParams?.watch !== "undefined"
      ? (searchParams?.watch ?? "0").trim() === "1"
      : taskTablePreferences?.include_watching ?? false;
  const activeTab = normalizeTasksTabKey(searchParams?.tab);

  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name,client_id,clients(name)")
    .order("name", { ascending: true });

  const taskTemplatesFromTasksResponse = await supabase
    .from("tasks")
    .select(
      "id,title,description,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
    )
    .eq("status", "template")
    .is("parent_task_id", null)
    .order("title", { ascending: true });
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

  const taskTemplates = taskTemplatesFromTasksRaw.map((row) => ({
    ...row,
    name: row.title,
    status: "to_do",
  }));
  const taskTemplatesError = taskTemplatesFromTasksError;
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
      : "once";
  const templateOptions = taskTemplates.map((template) => ({
    id: template.id,
    name: template.name,
  }));

  const userIdSet = new Set((users || []).map((user) => user.id));
  const defaultAssigneeUserId =
    (currentAppUserId && userIdSet.has(currentAppUserId) && currentAppUserId) ||
    (userIdSet.has(authUserId) ? authUserId : null);
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));

  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));

  if (currentAppUserId && taskPreferencesAvailable) {
    const { error: savePreferencesError } = await supabase
      .from("user_task_table_preferences")
      .upsert(
        {
          user_id: currentAppUserId,
          status: selectedStatuses,
          priority: selectedPriorities,
          assignee: selectedAssignees,
          due: selectedDue,
          client: selectedClientIds,
          project: selectedProjectIds,
          hide_completed: hideCompleted,
          include_watching: includeWatching,
          sort_key: sortKey,
          sort_dir: sortDir,
          view_mode: selectedView,
        },
        { onConflict: "user_id" }
      );
    if (savePreferencesError && !isSupabaseMissingTableError(savePreferencesError)) {
      console.error("[tasks.preferences.save]", savePreferencesError.message);
    }
  }

  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "priority", selectedPriorities);
  setCsvParam(returnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  setCsvParam(returnParams, "client", selectedClientIds);
  setCsvParam(returnParams, "project", selectedProjectIds);
  returnParams.set("hide", hideCompleted ? "1" : "0");
  returnParams.set("sort", sortKey);
  returnParams.set("dir", sortDir);
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  if (includeWatching) {
    returnParams.set("watch", "1");
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

  let request = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,client_id,project_id,projects(name),clients(name)"
    )
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

  const [primaryAssignedRows, assignedRows, watcherRows, createdByRows] = await Promise.all([
    supabase
      .from("tasks")
      .select("id")
      .in("assignee_user_id", assignmentUserIds)
      .is("parent_task_id", null),
    supabase.from("task_assignees").select("task_id").in("user_id", assignmentUserIds),
    includeWatching
      ? supabase.from("task_watchers").select("task_id").in("user_id", assignmentUserIds)
      : Promise.resolve({ data: [] as Array<{ task_id: string | null }> }),
    supabase
      .from("tasks")
      .select("id")
      .in("created_by_user_id", assignmentUserIds)
      .is("parent_task_id", null),
  ]);

  const allowedTaskIds = Array.from(
    new Set([
      ...(primaryAssignedRows.data || []).map((row) => row.id).filter(Boolean),
      ...(assignedRows.data || []).map((row) => row.task_id).filter(Boolean),
      ...(watcherRows.data || []).map((row) => row.task_id).filter(Boolean),
      ...(createdByRows.data || []).map((row) => row.id).filter(Boolean),
    ])
  );

  if (allowedTaskIds.length) {
    request = request.in("id", allowedTaskIds);
  } else {
    request = request.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  if (selectedStatuses.length) {
    request = request.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
  }

  if (selectedPriorities.length) {
    request = request.in("priority", selectedPriorities);
  }

  const wantsUnassigned = selectedAssignees.includes("unassigned");
  const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");

  if (wantsUnassigned && selectedAssigneeIds.length) {
    request = request.or(
      `assignee_user_id.is.null,assignee_user_id.in.(${selectedAssigneeIds.join(",")})`
    );
  } else if (wantsUnassigned) {
    request = request.is("assignee_user_id", null);
  } else if (selectedAssigneeIds.length) {
    request = request.in("assignee_user_id", selectedAssigneeIds);
  }

  if (selectedClientIds.length) {
    request = request.in("client_id", selectedClientIds);
  }

  if (selectedProjectIds.length) {
    request = request.in("project_id", selectedProjectIds);
  }

  const wantsCompletedStatuses =
    selectedStatuses.includes("completed") || selectedStatuses.includes("cancelled");
  const wantsTemplateStatus = selectedStatuses.includes("template");
  if (templateStatusSupported && !wantsTemplateStatus) {
    request = request.neq("status", "template");
  }
  if (hideCompleted && !wantsCompletedStatuses) {
    request = request.not("status", "in", "(completed,cancelled)");
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (selectedDue === "overdue") {
    request = request.lt("due_date", todayIso);
  } else if (selectedDue === "next_7") {
    const next = new Date(today);
    next.setDate(next.getDate() + 7);
    const nextIso = next.toISOString().slice(0, 10);
    request = request.gte("due_date", todayIso).lte("due_date", nextIso);
  } else if (selectedDue === "none") {
    request = request.is("due_date", null);
  }

  const { data: tasks } = await request;
  const taskIds = (tasks || []).map((task) => task.id).filter(Boolean);

  const assigneesByTask: Record<string, string[]> = {};
  if (taskIds.length) {
    const { data: assigneeRows } = await supabase
      .from("task_assignees")
      .select("task_id,user_id")
      .in("task_id", taskIds);
    (assigneeRows || []).forEach((row) => {
      if (!assigneesByTask[row.task_id]) {
        assigneesByTask[row.task_id] = [];
      }
      assigneesByTask[row.task_id].push(row.user_id);
    });
  }

  (tasks || []).forEach((task) => {
    if (!assigneesByTask[task.id]) {
      assigneesByTask[task.id] = [];
    }
    if (task.assignee_user_id && !assigneesByTask[task.id].includes(task.assignee_user_id)) {
      assigneesByTask[task.id].push(task.assignee_user_id);
    }
  });

  const sortedTasks = sortTasksForDisplay({
    tasks: tasks || [],
    sortKey,
    sortDir,
    users: users || [],
    assigneesByTask,
    statusOrder: statusOptions,
  });

  const openSubtaskCountByTaskId: Record<string, number> = {};
  const openSubtasksByParentId: Record<
    string,
    Array<{
      id: string;
      parent_task_id: string | null;
      title: string;
      status: string | null;
      priority: string | null;
      due_date: string | null;
      due_time: string | null;
      assignee_user_ids: string[];
    }>
  > = {};
  const taskIdsForSubtaskCounts = (sortedTasks || []).map((t) => t.id).filter(Boolean) as string[];
  if (taskIdsForSubtaskCounts.length) {
    const { data: subtasksForCountsRaw, error: subtasksForCountsError } = await supabase
      .from("tasks")
      .select("parent_task_id,status")
      .in("parent_task_id", taskIdsForSubtaskCounts);

    if (!subtasksForCountsError) {
      const subtasksForCounts = (subtasksForCountsRaw || []) as Array<{
        parent_task_id: string | null;
        status: string | null;
      }>;
      for (const row of subtasksForCounts) {
        const parentId = row.parent_task_id;
        const status = row.status || "";
        if (!parentId) continue;
        if (status === "completed" || status === "cancelled") continue;
        openSubtaskCountByTaskId[parentId] = (openSubtaskCountByTaskId[parentId] || 0) + 1;
      }
    }

    const { data: openSubtasksRaw, error: openSubtasksError } = await supabase
      .from("tasks")
      .select("id,parent_task_id,title,status,priority,due_date,due_time,assignee_user_id")
      .in("parent_task_id", taskIdsForSubtaskCounts)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: true });

    if (!openSubtasksError) {
      const openSubtasks = (openSubtasksRaw || []) as Array<{
        id: string;
        parent_task_id: string | null;
        title: string;
        status: string | null;
        priority: string | null;
        due_date: string | null;
        due_time: string | null;
        assignee_user_id: string | null;
      }>;

      const subtaskIds = openSubtasks.map((subtask) => subtask.id).filter(Boolean);
      const assigneeIdsBySubtaskId: Record<string, string[]> = {};
      if (subtaskIds.length) {
        const { data: subtaskAssigneeRows } = await supabase
          .from("task_assignees")
          .select("task_id,user_id")
          .in("task_id", subtaskIds);
        (subtaskAssigneeRows || []).forEach((row) => {
          if (!assigneeIdsBySubtaskId[row.task_id]) {
            assigneeIdsBySubtaskId[row.task_id] = [];
          }
          assigneeIdsBySubtaskId[row.task_id].push(row.user_id);
        });
      }

      openSubtasks.forEach((subtask) => {
        if (!subtask.parent_task_id) return;
        if (!openSubtasksByParentId[subtask.parent_task_id]) {
          openSubtasksByParentId[subtask.parent_task_id] = [];
        }
        const assigneeIds = Array.from(
          new Set([
            ...(assigneeIdsBySubtaskId[subtask.id] || []),
            ...(subtask.assignee_user_id ? [subtask.assignee_user_id] : []),
          ])
        );
        openSubtasksByParentId[subtask.parent_task_id].push({
          id: subtask.id,
          parent_task_id: subtask.parent_task_id,
          title: subtask.title,
          status: subtask.status,
          priority: subtask.priority,
          due_date: subtask.due_date,
          due_time: subtask.due_time,
          assignee_user_ids: assigneeIds,
        });
      });
    }
  }

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback = ""
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      redirect("/login");
    }
    const title = String(formData.get("title") || "").trim();
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const priority = String(formData.get("priority") || "medium");
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const templateTaskIdFromForm = String(formData.get("template_task_id") || "").trim();
    const clientIdRaw = String(formData.get("client_id") || "").trim();
    const projectIdRaw = String(formData.get("project_id") || "").trim();
    let clientId = clientIdRaw || null;
    const projectId = projectIdRaw || null;

    if (!title) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: "Title is required",
        })
      );
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

    const manualAssigneeIds = Array.from(
      new Set(assigneeIds.filter((value) => value !== "unassigned"))
    );
    let templateAssigneeIds: string[] = [];
    if (templateTaskIdFromForm) {
      const [templateTaskResponse, templateAssigneesResponse] = await Promise.all([
        supabase
          .from("tasks")
          .select("assignee_user_id")
          .eq("id", templateTaskIdFromForm)
          .maybeSingle(),
        supabase
          .from("task_assignees")
          .select("user_id")
          .eq("task_id", templateTaskIdFromForm),
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

      templateAssigneeIds = Array.from(
        new Set(
          [
            templateTaskResponse.data?.assignee_user_id || null,
            ...(templateAssigneesResponse.data || []).map((row) => row.user_id),
          ].filter(Boolean)
        )
      ) as string[];
    }
    const uniqueAssigneeIds = Array.from(
      new Set([...manualAssigneeIds, ...templateAssigneeIds])
    );
    const fallbackAssigneeId = defaultAssigneeUserId || authData.user.id;
    const primaryAssignee = uniqueAssigneeIds[0] || assigneeUserId || fallbackAssigneeId || "";
    const effectiveAssigneeIds = uniqueAssigneeIds.length
      ? uniqueAssigneeIds
      : primaryAssignee
        ? [primaryAssignee]
        : [];

    const taskId = randomUUID();
    const payload: Record<string, unknown> = {
      id: taskId,
      client_id: clientId,
      project_id: projectId,
      title,
      status,
      priority,
      due_date: schedule.dueDate,
      due_time: schedule.dueTime,
      assignee_user_id: primaryAssignee || null,
      created_by_user_id: authData.user.id,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (schedule.recurrenceConfig) {
      payload.recurrence_frequency = schedule.recurrenceConfig.frequency;
      payload.recurrence_interval = schedule.recurrenceConfig.interval;
      payload.recurrence_weekdays = schedule.recurrenceConfig.weekdays;
      payload.recurrence_month_day = schedule.recurrenceConfig.monthDay;
      payload.recurrence_month_week = schedule.recurrenceConfig.monthWeek;
      payload.recurrence_month_weekday = schedule.recurrenceConfig.monthWeekday;
      payload.recurrence_start_date = schedule.recurrenceConfig.startDate;
      payload.recurrence_end_date = schedule.recurrenceConfig.endDate;
      payload.recurrence_lead_days = schedule.recurrenceLeadDays;
      payload.recurrence_next_date = schedule.recurrenceNextDate;
      payload.recurrence_timezone = schedule.recurrenceTimezone;
    }

    if (schedule.startDate) {
      payload.start_date = schedule.startDate;
    }

    const { error } = await supabase.from("tasks").insert(payload);

    if (error) {
      redirect(
        buildTasksRedirectUrl(returnTo, {
          tab: "add",
          error: formatDbError("tasks.createTask.tasks.insert", error),
        })
      );
    }

    if (taskId && templateTaskIdFromForm) {
      const { data: templateCustomFieldsRaw, error: templateCustomFieldsError } = await supabase
        .from("custom_fields")
        .select("id,key,label,field_kind,position")
        .eq("entity_type", "task")
        .eq("entity_id", templateTaskIdFromForm);
      if (templateCustomFieldsError && !isSupabaseMissingTableError(templateCustomFieldsError)) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: templateCustomFieldsError.message,
          })
        );
      }

      const templateCustomFields = (templateCustomFieldsError
        ? []
        : templateCustomFieldsRaw || []) as Array<{
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
          .eq("entity_type", "task")
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
    if (taskId && effectiveAssigneeIds.length) {
        const inserts = effectiveAssigneeIds.map((userId) => ({
          task_id: taskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          redirect(
            buildTasksRedirectUrl(returnTo, {
              tab: "add",
              error: assigneeError.message,
            })
          );
        }
    }

    if (taskId && templateTaskIdFromForm) {
      let subtaskTemplates: Array<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        assignee_user_id?: string | null;
      }> = [];
      const assigneeIdsBySubtaskTemplateId: Record<string, string[]> = {};

      const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
        .from("tasks")
        .select("id,title,description,status,priority,assignee_user_id")
        .eq("parent_task_id", templateTaskIdFromForm)
        .order("created_at", { ascending: true });
      if (subtaskTemplatesError) {
        redirect(
          buildTasksRedirectUrl(returnTo, {
            tab: "add",
            error: subtaskTemplatesError.message,
          })
        );
      }
      subtaskTemplates = (subtaskTemplatesRaw || []) as Array<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        assignee_user_id?: string | null;
      }>;

      const subtaskTemplateIds = subtaskTemplates.map((tpl) => tpl.id).filter(Boolean);
      if (subtaskTemplateIds.length) {
        const { data: taskAssigneesRaw, error: taskAssigneesError } = await supabase
          .from("task_assignees")
          .select("task_id,user_id")
          .in("task_id", subtaskTemplateIds);
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
              created_by_user_id: authData.user.id,
              content: DEFAULT_EDITOR_CONTENT,
              content_text: defaultContentText,
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
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Tasks</h1>
        <p className="text-sm text-slate-600">
          Review tasks across all clients and projects.
        </p>
      </section>

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

      {!users?.length ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">No users found.</p>
          <p className="mt-1">
            Ask an admin to create a user profile in Admin {">"} Users to enable task assignment.
          </p>
        </section>
      ) : null}

      <TasksTabs active={activeTab} urls={tasksTabUrls} />

      {activeTab === "add" ? (
        <div className="fixed inset-0 z-50">
          <Link
            href={tasksTabUrls.list}
            aria-label="Close add task dialog"
            className="absolute inset-0 block bg-slate-900/35 backdrop-blur-[2px]"
          />
          <div className="relative z-10 flex min-h-full items-start justify-center overflow-y-auto p-4 pb-8 pt-8 sm:p-6 lg:p-10">
            <section className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)]">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Add task</h2>
                <Link
                  href={tasksTabUrls.list}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </Link>
              </div>
              <div className="px-6 pb-6">
                <div className="w-full">
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Link
                        href={addTaskModeUrls.new}
                        className={`rounded-md px-3 py-1.5 font-medium ${
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
                      <div className={`md:col-span-6 ${addTaskPanelClass}`}>
                        <p className={addTaskPanelTitleClass}>Task details</p>
                        <div className="mt-3 grid gap-4 md:grid-cols-6">
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Title</label>
                            <input
                              name="title"
                              placeholder="Task title"
                              className={addTaskControlClass}
                              defaultValue={selectedTemplate?.title || ""}
                              required
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className={addTaskLabelClass}>Client</label>
                            <select
                              name="client_id"
                              className={addTaskControlClass}
                              defaultValue=""
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
                              defaultValue=""
                            >
                              <option value="">Project (N/A)</option>
                              {projects?.map((project) => {
                                const projectClientName = getRelationName(project.clients, "");
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
                        </div>
                      </div>
                      <RecurrenceFields
                        initialFrequency={initialRecurrenceFrequency}
                        initialDueTime={selectedTemplate?.due_time || undefined}
                        initialLeadDays={selectedTemplate?.recurrence_lead_days ?? 7}
                      />
                      <div className="md:col-span-6 flex justify-end">
                        <button
                          type="submit"
                          className="w-full rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white sm:w-auto"
                        >
                          Create task
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={sortedTasks}
          users={users || []}
          clients={clients || []}
          projects={projects || []}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          openSubtasksByParentId={openSubtasksByParentId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          returnTo={returnTo}
          initialFilters={{
            status: selectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: selectedClientIds,
            project: selectedProjectIds,
          }}
          onUpdate={updateTaskInlineAction}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
          includeWatching={includeWatching}
          watchToggleUrl={watchToggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          initialView={selectedView}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
        />
      </section>
    </div>
  );
}



