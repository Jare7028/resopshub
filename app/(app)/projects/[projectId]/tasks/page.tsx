import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "../_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import AssigneeMultiSelect from "@/app/(app)/tasks/_components/AssigneeMultiSelect";
import RecurrenceFields from "@/app/(app)/tasks/_components/RecurrenceFields";
import TasksView from "@/app/(app)/tasks/TasksView";
import { DEFAULT_RECURRENCE_TZ } from "@/lib/recurrence";
import { parseTaskScheduleFormData } from "@/lib/taskSchedule";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
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
import { randomUUID } from "node:crypto";
import {
  createTaskLikeRoot,
  TaskCreateDbError,
  TaskCreateInputError,
} from "@/lib/tasks/createTaskLikeRoot";

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

export default async function ProjectTasksPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    created?: string;
    view?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    hide?: string;
    sort?: string;
    dir?: string;
    create_mode?: string;
    template_task_id?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
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
    typeof searchParams?.due !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    hasExplicitView;
  const selectedStatuses = coerceTaskStatusList(parseCsvParam(searchParams?.status)).filter(
    (status) => statusOptions.includes(status)
  );
  const selectedPriorities = parseCsvParam(searchParams?.priority).filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  let selectedDue = (searchParams?.due || "all").trim();
  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }
  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();
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
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,client_id")
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  const projectId = project.id;
  const projectClientId = project.client_id;
  const basePath = `/projects/${projectId}/tasks`;

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    const { data: watching } = await supabase
      .from("project_watchers")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment && !watching) {
      redirect("/projects?error=Not%20assigned%20to%20that%20project");
    }
  } else if (!isAdmin && !currentUserId) {
    redirect("/projects?error=User%20profile%20missing");
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const userIdSet = new Set((users || []).map((user) => user.id));
  const defaultAssigneeUserId =
    (currentUserId && userIdSet.has(currentUserId) && currentUserId) ||
    (authData.user?.id && userIdSet.has(authData.user.id) ? authData.user.id : null);
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "priority", selectedPriorities);
  setCsvParam(returnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  returnParams.set("hide", hideCompleted ? "1" : "0");
  returnParams.set("sort", sortKey);
  returnParams.set("dir", sortDir);
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  const returnTo = returnParams.toString() ? `${basePath}?${returnParams}` : basePath;
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `${basePath}?${toggleParams}` : basePath;
  let clientName: string | null = null;
  if (projectClientId) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("id", projectClientId)
      .maybeSingle();
    clientName = clientRow?.name || null;
  }
  const clients = projectClientId
    ? [{ id: projectClientId, name: clientName || "Client" }]
    : [];
  const projects = [
    {
      id: projectId,
      name: project.name,
      client_id: projectClientId,
      clients: clientName ? { name: clientName } : null,
    },
  ];

  let request = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,parent_task_id,client_id,project_id,projects(name),clients(name)"
    )
    .eq("project_id", projectId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

  if (selectedStatuses.length) {
    request = request.in("status", selectedStatuses);
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

  const wantsCompletedStatuses =
    selectedStatuses.includes("completed") || selectedStatuses.includes("cancelled");
  const wantsTemplateStatus = selectedStatuses.includes("template");
  if (!wantsTemplateStatus && statusOptions.includes("template")) {
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
  const taskIdsForSubtaskCounts = (sortedTasks || []).map((t) => t.id).filter(Boolean) as string[];
  if (taskIdsForSubtaskCounts.length) {
    const { data: subtasksForCountsRaw, error: subtasksForCountsError } = await supabase
      .from("tasks")
      .select("parent_task_id")
      .in("parent_task_id", taskIdsForSubtaskCounts)
      .not("status", "in", "(completed,cancelled)");

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
      ? await supabase
          .from("tasks")
          .select("id,title,status,priority,due_time,recurrence_frequency,recurrence_lead_days")
          .eq("status", "template")
          .is("parent_task_id", null)
          .order("title", { ascending: true })
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
    const parentTaskId = String(formData.get("parent_task_id") || "");
    const templateTaskIdFromForm = String(formData.get("template_task_id") || "").trim();

    if (!title) {
      redirect(`/projects/${projectId}/tasks?error=Title%20is%20required`);
    }

    const scheduleResult = parseTaskScheduleFormData(formData, DEFAULT_RECURRENCE_TZ);
    if (scheduleResult.error || !scheduleResult.value) {
      redirect(
        `/projects/${projectId}/tasks?error=${encodeURIComponent(
          scheduleResult.error || "Invalid schedule"
        )}`
      );
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
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(templateTaskResponse.error.message)}`);
      }
      if (templateAssigneesResponse.error) {
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(templateAssigneesResponse.error.message)}`);
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
        context: "projects.tasks.createTask",
        title,
        status,
        priority,
        clientId: projectClientId,
        projectId,
        parentTaskId: parentTaskId || null,
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
      redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(message)}`);
    }

    if (taskId && templateTaskIdFromForm && !parentTaskId) {
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
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(subtaskTemplatesError.message)}`);
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
          redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(taskAssigneesError.message)}`);
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
        const payloads = subtaskTemplates.map((tpl) => {
          const subtaskAssigneeIds = Array.from(
            new Set(assigneeIdsBySubtaskTemplateId[tpl.id] || [])
          );
          return {
            assigneeIds: subtaskAssigneeIds,
            payload: {
              client_id: projectClientId,
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

        const subtaskRows = payloads.map((row) => ({
          id: randomUUID(),
          ...row.payload,
        }));

        const { error: subtaskInsertError } = await supabase
          .from("tasks")
          .insert(subtaskRows);

        if (subtaskInsertError) {
          redirect(
            `/projects/${projectId}/tasks?error=${encodeURIComponent(
              formatDbError(
                "projects.tasks.createTask.templateSubtasks.tasks.insert",
                subtaskInsertError
              )
            )}`
          );
        }

        const inserts = subtaskRows.flatMap((row, index) => {
          const explicitIds = payloads[index]?.assigneeIds || [];
          const effectiveIds = explicitIds.length ? explicitIds : effectiveAssigneeIds;
          return effectiveIds.map((userId) => ({ task_id: row.id as string, user_id: userId }));
        });
        if (inserts.length) {
          const { error: subtaskAssigneesError } = await supabase
            .from("task_assignees")
            .insert(inserts);
          if (subtaskAssigneesError) {
            redirect(
              `/projects/${projectId}/tasks?error=${encodeURIComponent(subtaskAssigneesError.message)}`
            );
          }
        }
      }
    }

    revalidatePath(`/projects/${projectId}/tasks`);
    redirect(
      `/projects/${projectId}/tasks?success=Task%20created&created=${encodeURIComponent(taskId)}`
    );
  }
  const updateTaskInline = updateTaskInlineAction;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {project.name} . Tasks
        </h1>
        <ProjectTabs projectId={projectId} active="tasks" />
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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <details>
          <summary className="cursor-pointer text-lg font-semibold text-slate-900">
            Add task
          </summary>
          <div className="mx-auto mt-3 w-full max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Link
                  href={`/projects/${projectId}/tasks`}
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
                      ? `/projects/${projectId}/tasks?create_mode=template&template_task_id=${encodeURIComponent(
                          templateTaskId
                        )}`
                      : `/projects/${projectId}/tasks?create_mode=template`
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
                  action={`/projects/${projectId}/tasks`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="create_mode" value="template" />
                  <select
                    name="template_task_id"
                    defaultValue={templateTaskId || ""}
                    className={addTaskInlineControlClass}
                    disabled={Boolean(taskTemplatesError)}
                  >
                    <option value="">Select a template</option>
                    {taskTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-10 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    disabled={Boolean(taskTemplatesError)}
                  >
                    Apply
                  </button>
                  <Link
                    href="/settings?tab=templates&templates=tasks"
                    className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    Manage templates
                  </Link>
                </form>
              ) : null}
            </div>

            {createMode === "template" && taskTemplatesError ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Template status is not fully set up yet. Run `sql/task_status_add_template.sql`,
                then run `sql/task_templates_as_tasks.sql`, then refresh this page.
              </p>
            ) : null}
            <form action={createTask} className="mt-5 grid gap-5 md:grid-cols-6">
              {createMode === "template" && templateTaskId ? (
                <>
                  <input type="hidden" name="create_mode" value="template" />
                  <input type="hidden" name="template_task_id" value={templateTaskId} />
                </>
              ) : null}
              <div className={`md:col-span-6 ${addTaskPanelClass}`}>
                <p className={addTaskPanelTitleClass}>Task details</p>
                <div className="mt-3 grid gap-4 md:grid-cols-6">
                  <div className="md:col-span-3">
                    <label className={addTaskLabelClass}>Title</label>
                    <input
                      name="title"
                      placeholder="Task title"
                      className={addTaskControlClass}
                      defaultValue={selectedTemplate?.title || ""}
                      required
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className={addTaskLabelClass}>Parent task</label>
                    <select
                      name="parent_task_id"
                      className={addTaskControlClass}
                      defaultValue=""
                    >
                      <option value="">Parent task (optional)</option>
                      {tasks?.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
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
          </div>
        </details>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={sortedTasks}
          users={users || []}
          clients={clients}
          projects={projects}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          returnTo={returnTo}
          initialFilters={{
            status: selectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: projectClientId ? [projectClientId] : [],
            project: [projectId],
          }}
          onUpdate={updateTaskInline}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
          includeWatching={false}
          watchToggleUrl={toggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          initialView={selectedView}
          basePath={basePath}
          fixedParams={{
            project: projectId,
            ...(projectClientId ? { client: projectClientId } : {}),
          }}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
          filterPersistenceUserId={currentUserId || authData.user?.id || null}
          filterPersistenceScope={`project:${projectId}`}
          hasExplicitFilterParams={hasExplicitFilterParams}
        />
      </section>
    </div>
  );
}



