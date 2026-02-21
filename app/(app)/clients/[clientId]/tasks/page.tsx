import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
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
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import { updateTaskInlineAction } from "../../../tasks/actions";
import { normalizeTasksTabKey } from "../../../tasks/_components/TasksTabs";
import AssigneeMultiSelect from "../../../tasks/_components/AssigneeMultiSelect";
import TemplateAutoSelect from "../../../tasks/_components/TemplateAutoSelect";
import RecurrenceFields from "../../../tasks/_components/RecurrenceFields";
import TasksView from "../../../tasks/TasksView";
import { DEFAULT_RECURRENCE_TZ } from "@/lib/recurrence";
import { parseTaskScheduleFormData } from "@/lib/taskSchedule";
import { randomUUID } from "node:crypto";
import { withPerfTiming } from "@/lib/perf";
import {
  createTaskLikeRoot,
  TaskCreateDbError,
  TaskCreateInputError,
} from "@/lib/tasks/createTaskLikeRoot";
import {
  ensureClientPageEditAccess,
  ensureClientPageViewAccess,
  getClientPageAccessData,
} from "../_lib/clientPageAccess";
import RouteModalOverlay from "../../../_components/RouteModalOverlay";

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
  "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm leading-5 text-slate-700 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
const addTaskInlineControlClass =
  "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm leading-5 text-slate-700 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
const addTaskPanelClass =
  "rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:p-5";
const addTaskPanelTitleClass =
  "text-xs font-semibold uppercase tracking-wide text-slate-500";
const tasksPageSize = 50;

function isTemplateStatusEnumError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return message.includes("invalid input value for enum") && message.includes("template");
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

export default async function ClientTasksPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    created?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    project?: string | string[];
    hide?: string;
    view?: string;
    sort?: string;
    dir?: string;
    tab?: string;
    create_mode?: string;
    template_task_id?: string;
    page?: string;
  }>;
}) {
  noStore();
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await withPerfTiming("clients.tasks.auth", () =>
    supabase.auth.getUser()
  );
  const authUserId = authData.user?.id;
  const authEmail = String(authData.user?.email || "").trim().toLowerCase();
  if (!authUserId) {
    redirect("/login");
  }
  const { data: statusOptionsRaw } = await withPerfTiming("clients.tasks.status_options", () =>
    supabase
      .from("status_options")
      .select("entity_type,value,position")
      .order("entity_type", { ascending: true })
      .order("position", { ascending: true })
      .order("value", { ascending: true })
  );
  const statusOptions = buildStatusOptions(
    "task",
    (statusOptionsRaw || []) as StatusOptionRow[],
    TASK_STATUS_OPTIONS
  );
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedPrioritiesRaw = parseCsvParam(searchParams?.priority);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const selectedProjectIdsRaw = parseCsvParam(searchParams?.project);
  let selectedDue = (searchParams?.due || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const activeTab = normalizeTasksTabKey(searchParams?.tab);
  const wantsAddDialog = activeTab === "add";

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();

  const sortKey = normalizeTaskSortKey(searchParams?.sort);
  const sortDir = normalizeTaskSortDir(searchParams?.dir);
  const viewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const hasExplicitFilterParams =
    typeof searchParams?.status !== "undefined" ||
    typeof searchParams?.priority !== "undefined" ||
    typeof searchParams?.assignee !== "undefined" ||
    typeof searchParams?.project !== "undefined" ||
    typeof searchParams?.due !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    hasExplicitView;
  const pageParam = Number.parseInt(String(searchParams?.page || "1"), 10);
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const tasksRangeFrom = (currentPage - 1) * tasksPageSize;
  const tasksRangeTo = tasksRangeFrom + tasksPageSize;
  const { data: client } = await withPerfTiming("clients.tasks.client", () =>
    supabase.from("clients").select("id,name").eq("id", params.clientId).single()
  );

  if (!client) {
    notFound();
  }
  const { accessByKey: clientPageAccessByKey, visibleTabs } = await withPerfTiming(
    "clients.tasks.page_access",
    () => getClientPageAccessData({ supabase, clientId })
  );
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "tasks",
    accessByKey: clientPageAccessByKey,
  });
  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const [projectsResult, usersResult] = await Promise.all([
    withPerfTiming("clients.tasks.projects", () =>
      supabase
        .from("projects")
        .select("id,name")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
    ),
    withPerfTiming("clients.tasks.users", () =>
      supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true })
    ),
  ]);
  const projects = projectsResult.data;
  const users = usersResult.data;

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const userIdSet = new Set((users || []).map((user) => user.id));
  const defaultAssigneeUserId =
    (authEmail &&
      (users || []).find(
        (user) => String(user.email || "").trim().toLowerCase() === authEmail
      )?.id) ||
    (userIdSet.has(authUserId) ? authUserId : null);
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));

  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "priority", selectedPriorities);
  setCsvParam(returnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  setCsvParam(returnParams, "project", selectedProjectIds);
  returnParams.set("hide", hideCompleted ? "1" : "0");
  returnParams.set("sort", sortKey);
  returnParams.set("dir", sortDir);
  if (currentPage > 1) {
    returnParams.set("page", String(currentPage));
  }
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  const returnTo = returnParams.toString()
    ? `/clients/${clientId}/tasks?${returnParams}`
    : `/clients/${clientId}/tasks`;
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString()
    ? `/clients/${clientId}/tasks?${toggleParams}`
    : `/clients/${clientId}/tasks`;
  const buildClientTasksUrl = (
    tab: "list" | "add",
    params?: { error?: string; success?: string; created?: string }
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
    if (params?.created) {
      sp.set("created", params.created);
    }
    const qs = sp.toString();
    return qs ? `/clients/${clientId}/tasks?${qs}` : `/clients/${clientId}/tasks`;
  };
  const buildAddTaskUrl = (mode: "new" | "template", templateId?: string) => {
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
    return qs ? `/clients/${clientId}/tasks?${qs}` : `/clients/${clientId}/tasks?tab=add`;
  };
  const buildTaskListPageUrl = (pageNumber: number) => {
    const normalizedPage = Number.isFinite(pageNumber) && pageNumber > 1 ? Math.floor(pageNumber) : 1;
    const sp = new URLSearchParams(returnParams);
    if (normalizedPage > 1) {
      sp.set("page", String(normalizedPage));
    } else {
      sp.delete("page");
    }
    const qs = sp.toString();
    return qs ? `/clients/${clientId}/tasks?${qs}` : `/clients/${clientId}/tasks`;
  };
  const tasksTabUrls = {
    list: buildClientTasksUrl("list"),
    add: buildClientTasksUrl("add"),
  };
  const addTaskModeUrls = {
    new: buildAddTaskUrl("new"),
    template: buildAddTaskUrl("template", templateTaskId || undefined),
  };
  const sharedAddTaskUrl = `/tasks?tab=add&client=${encodeURIComponent(clientId)}`;

  if (wantsAddDialog) {
    redirect(sharedAddTaskUrl);
  }

  let tasksRequest = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,client_id,project_id"
    )
    .eq("client_id", clientId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });
  if (selectedStatuses.length) {
    tasksRequest = tasksRequest.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
  }
  if (selectedPriorities.length) {
    tasksRequest = tasksRequest.in("priority", selectedPriorities);
  }
  const wantsUnassigned = selectedAssignees.includes("unassigned");
  const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");
  if (wantsUnassigned && selectedAssigneeIds.length) {
    tasksRequest = tasksRequest.or(
      `assignee_user_id.is.null,assignee_user_id.in.(${selectedAssigneeIds.join(",")})`
    );
  } else if (wantsUnassigned) {
    tasksRequest = tasksRequest.is("assignee_user_id", null);
  } else if (selectedAssigneeIds.length) {
    tasksRequest = tasksRequest.in("assignee_user_id", selectedAssigneeIds);
  }
  if (selectedProjectIds.length) {
    tasksRequest = tasksRequest.in("project_id", selectedProjectIds);
  }
  const wantsCompletedStatuses =
    selectedStatuses.includes("completed") || selectedStatuses.includes("cancelled");
  const wantsTemplateStatus = selectedStatuses.includes("template");
  if (!wantsTemplateStatus && statusOptions.includes("template")) {
    tasksRequest = tasksRequest.neq("status", "template");
  }
  if (hideCompleted && !wantsCompletedStatuses) {
    tasksRequest = tasksRequest.not("status", "in", "(completed,cancelled)");
  }
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (selectedDue === "overdue") {
    tasksRequest = tasksRequest.lt("due_date", todayIso);
  } else if (selectedDue === "next_7") {
    const next = new Date(today);
    next.setDate(next.getDate() + 7);
    const nextIso = next.toISOString().slice(0, 10);
    tasksRequest = tasksRequest.gte("due_date", todayIso).lte("due_date", nextIso);
  } else if (selectedDue === "none") {
    tasksRequest = tasksRequest.is("due_date", null);
  }

  tasksRequest = tasksRequest.range(tasksRangeFrom, tasksRangeTo);
  const { data: tasksRaw } = await withPerfTiming("clients.tasks.rows", () => tasksRequest);
  const hasNextPage = (tasksRaw || []).length > tasksPageSize;
  const hasPreviousPage = currentPage > 1;
  const projectNameById = new Map((projects || []).map((project) => [project.id, project.name]));
  const tasks = ((tasksRaw || []).slice(0, tasksPageSize) as Array<{
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
  }>).map((task) => ({
    ...task,
    clients: { name: client.name },
    projects: task.project_id ? { name: projectNameById.get(task.project_id) || "" } : null,
  }));
  const previousPageUrl = hasPreviousPage ? buildTaskListPageUrl(currentPage - 1) : null;
  const nextPageUrl = hasNextPage ? buildTaskListPageUrl(currentPage + 1) : null;

  const taskIds = (tasks || []).map((task) => task.id).filter(Boolean);
  const assigneesByTask: Record<string, string[]> = {};
  if (taskIds.length) {
    const { data: assigneeRows } = await withPerfTiming("clients.tasks.assignees", () =>
      supabase.from("task_assignees").select("task_id,user_id").in("task_id", taskIds)
    );
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
  const taskIdsForSubtaskCounts = (sortedTasks || []).map((t) => t.id).filter(Boolean) as string[];
  if (taskIdsForSubtaskCounts.length) {
    const { data: subtasksForCountsRaw, error: subtasksForCountsError } = await withPerfTiming(
      "clients.tasks.open_subtask_counts",
      () =>
        supabase
          .from("tasks")
          .select("parent_task_id")
          .in("parent_task_id", taskIdsForSubtaskCounts)
          .not("status", "in", "(completed,cancelled)")
    );

    if (!subtasksForCountsError) {
      const subtasksForCounts = (subtasksForCountsRaw || []) as Array<{
        parent_task_id: string | null;
      }>;
      for (const row of subtasksForCounts) {
        const parentId = row.parent_task_id;
        if (!parentId) continue;
        openSubtaskCountByTaskId[parentId] = (openSubtaskCountByTaskId[parentId] || 0) + 1;
      }
    }
  }
  const taskTemplatesFromTasksResponse =
    createMode === "template"
      ? await withPerfTiming("clients.tasks.templates", () =>
          supabase
            .from("tasks")
            .select("id,title,status,priority,due_time,recurrence_frequency,recurrence_lead_days")
            .eq("status", "template")
            .is("parent_task_id", null)
            .order("title", { ascending: true })
        )
      : {
          data: [] as Array<{
            id: string;
            title: string;
            status: string;
            priority: string;
            due_time: string | null;
            recurrence_frequency: string | null;
            recurrence_lead_days: number | null;
          }>,
          error: null,
        };
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
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  }>;
  const taskTemplates = taskTemplatesFromTasksRaw.map((row) => ({
    ...row,
    name: row.title,
    status: "to_do",
  }));
  const templateOptions = taskTemplates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name || tpl.title,
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

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    await ensureClientPageEditAccess({
      supabase,
      clientId,
      pageKey: "tasks",
      redirectPath: `/clients/${clientId}/tasks`,
    });
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      redirect("/login");
    }
    const title = String(formData.get("title") || "").trim();
    const projectId = String(formData.get("project_id") || "").trim() || null;
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const priority = String(formData.get("priority") || "medium");
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const templateTaskIdFromForm = String(formData.get("template_task_id") || "").trim();

    if (!title) {
      redirect(buildClientTasksUrl("add", { error: "Title is required" }));
    }

    const scheduleResult = parseTaskScheduleFormData(formData, DEFAULT_RECURRENCE_TZ);
    if (scheduleResult.error || !scheduleResult.value) {
      redirect(buildClientTasksUrl("add", { error: scheduleResult.error || "Invalid schedule" }));
    }
    const schedule = scheduleResult.value;

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
        redirect(buildClientTasksUrl("add", { error: templateTaskResponse.error.message }));
      }
      if (templateAssigneesResponse.error) {
        redirect(buildClientTasksUrl("add", { error: templateAssigneesResponse.error.message }));
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
    let taskId: string;
    let primaryAssignee: string | null;
    let effectiveAssigneeIds: string[];
    try {
      const created = await createTaskLikeRoot({
        supabase,
        context: "clients.tasks.createTask",
        title,
        status,
        priority,
        clientId,
        projectId,
        dueDate: schedule.dueDate,
        dueTime: schedule.dueTime,
        startDate: schedule.startDate,
        createdByUserId: authData.user.id,
        assigneeUserId,
        assigneeUserIds: uniqueAssigneeIds,
        defaultAssigneeUserId: defaultAssigneeUserId || null,
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
      });
      taskId = created.taskId;
      primaryAssignee = created.primaryAssignee;
      effectiveAssigneeIds = created.effectiveAssigneeIds;
    } catch (error) {
      const message =
        error instanceof TaskCreateDbError
          ? formatDbError(error.context, error.dbError)
          : error instanceof TaskCreateInputError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unable to create task";
      redirect(buildClientTasksUrl("add", { error: message }));
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
        redirect(buildClientTasksUrl("add", { error: subtaskTemplatesError.message }));
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
          redirect(buildClientTasksUrl("add", { error: taskAssigneesError.message }));
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
        const subtaskPlans = subtaskTemplates.map((tpl) => {
          const subtaskAssigneeIds = Array.from(
            new Set(assigneeIdsBySubtaskTemplateId[tpl.id] || [])
          );
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
              assignee_user_id: subtaskAssigneeIds[0] || primaryAssignee || null,
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
            buildClientTasksUrl("add", {
              error: formatDbError(
                "clients.tasks.createTask.templateSubtasks.tasks.insert",
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
            redirect(buildClientTasksUrl("add", { error: subtaskAssigneesError.message }));
          }
        }
      }
    }

    revalidatePath(`/clients/${clientId}/tasks`);
    redirect(
      buildClientTasksUrl("list", {
        success: "Task created",
        created: taskId,
      })
    );
  }
  async function updateTaskInline(input: Parameters<typeof updateTaskInlineAction>[0]) {
    "use server";
    const supabase = createSupabaseServerClient();
    await ensureClientPageEditAccess({
      supabase,
      clientId,
      pageKey: "tasks",
      redirectPath: `/clients/${clientId}/tasks`,
    });
    return updateTaskInlineAction(input);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Tasks
        </h1>
        <ClientTabs clientId={clientId} active="tasks" tabs={visibleTabs} />
      </section>

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

      <div className="flex justify-start">
        <Link
          href={sharedAddTaskUrl}
          className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          Add task
        </Link>
      </div>

      {wantsAddDialog ? (
        <RouteModalOverlay
          closeHref={tasksTabUrls.list}
          overlayLabel="Close add task dialog"
        >
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-h-[92vh] max-w-none overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-5xl md:rounded-2xl">
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
                        basePath={`/clients/${clientId}/tasks`}
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
                          <input type="hidden" name="template_task_id" value={selectedTemplate.id} />
                        </>
                      ) : null}
                      <input type="hidden" name="client_id" value={client.id} />
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
                              name="client_id_display"
                              className={addTaskControlClass}
                              defaultValue={client.id}
                              disabled
                            >
                              <option value={client.id}>{client.name}</option>
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
                              {projects?.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))}
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
        </RouteModalOverlay>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={sortedTasks || []}
          users={users || []}
          clients={[client]}
          projects={(projects || []).map((project) => ({
            ...project,
            client_id: client.id,
            clients: [{ name: client.name }],
          }))}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          initialView={selectedView}
          returnTo={returnTo}
          initialFilters={{
            status: selectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: [client.id],
            project: selectedProjectIds,
          }}
          onUpdate={updateTaskInline}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
          includeWatching={false}
          watchToggleUrl={toggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          basePath={`/clients/${clientId}/tasks`}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
          filterPersistenceUserId={authUserId}
          filterPersistenceScope={`client:${clientId}`}
          hasExplicitFilterParams={hasExplicitFilterParams}
        />
      </section>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Page {currentPage}
        </p>
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





