import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
import AssigneeMultiSelect from "../../../tasks/_components/AssigneeMultiSelect";
import RecurrenceFields from "../../../tasks/_components/RecurrenceFields";
import TasksView from "../../../tasks/TasksView";
import {
  DEFAULT_RECURRENCE_TZ,
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

function isTemplateStatusEnumError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return message.includes("invalid input value for enum") && message.includes("template");
}

export default async function ClientTasksPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    project?: string | string[];
    hide?: string;
    view?: string;
    sort?: string;
    dir?: string;
    create_mode?: string;
    template_task_id?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
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
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedPrioritiesRaw = parseCsvParam(searchParams?.priority);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const selectedProjectIdsRaw = parseCsvParam(searchParams?.project);
  let selectedDue = (searchParams?.due || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";

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
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }
  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const userIdSet = new Set((users || []).map((user) => user.id));
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

  let tasksRequest = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,client_id,project_id,projects(name),clients(name)"
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

  const { data: tasks } = await tasksRequest;

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
  }
  const taskTemplatesFromTasksResponse = await supabase
    .from("tasks")
    .select("id,title,status,priority,due_time,recurrence_frequency,recurrence_lead_days")
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
    const projectId = String(formData.get("project_id") || "").trim() || null;
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const priority = String(formData.get("priority") || "medium");
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const templateTaskIdFromForm = String(formData.get("template_task_id") || "").trim();
    const recurrenceFrequencyRaw = String(formData.get("recurrence_frequency") || "")
      .trim()
      .toLowerCase();
    const recurrenceLeadDays = Number(formData.get("recurrence_lead_days") || 7) || 7;
    const recurrenceTimezone =
      String(formData.get("recurrence_timezone") || "").trim() ||
      DEFAULT_RECURRENCE_TZ;
    const recurrenceFrequency =
      recurrenceFrequencyRaw === "daily" ||
      recurrenceFrequencyRaw === "weekly" ||
      recurrenceFrequencyRaw === "monthly" ||
      recurrenceFrequencyRaw === "yearly"
        ? (recurrenceFrequencyRaw as RecurrenceConfig["frequency"])
        : null;

    if (!title) {
      redirect(`${returnTo}?error=${encodeURIComponent("Title is required")}`);
    }

    if (!dueDate || !dueTime) {
      redirect(
        `${returnTo}?error=${encodeURIComponent("Deadline date and time are required")}`
      );
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
        redirect(`${returnTo}?error=${encodeURIComponent(templateTaskResponse.error.message)}`);
      }
      if (templateAssigneesResponse.error) {
        redirect(`${returnTo}?error=${encodeURIComponent(templateAssigneesResponse.error.message)}`);
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
    const primaryAssignee = uniqueAssigneeIds[0] || assigneeUserId || "";

    let recurrenceConfig: RecurrenceConfig | null = null;
    let recurrenceNextDate: string | null = null;

    if (recurrenceFrequency) {
      const startDateForRecurrence = dueDate;
      const weekDay = new Date(`${startDateForRecurrence}T00:00:00Z`).getUTCDay();
      const monthDay = Number(startDateForRecurrence.split("-")[2]);

      recurrenceConfig = {
        frequency: recurrenceFrequency,
        interval: 1,
        startDate: startDateForRecurrence,
        endDate: null,
        weekdays: recurrenceFrequency === "weekly" ? [weekDay] : null,
        monthDay: recurrenceFrequency === "monthly" ? monthDay : null,
        monthWeek: null,
        monthWeekday: null,
      };

      const firstOccurrence = dueDate || getFirstOccurrence(recurrenceConfig);
      if (firstOccurrence) {
        recurrenceNextDate = getNextOccurrence(recurrenceConfig, firstOccurrence);
      }
    }

    const payload: Record<string, unknown> = {
      client_id: clientId,
      project_id: projectId,
      title,
      status,
      priority,
      due_date: dueDate || null,
      due_time: dueTime || null,
      assignee_user_id: primaryAssignee || null,
      created_by_user_id: authData.user.id,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (recurrenceConfig && recurrenceNextDate) {
      payload.recurrence_frequency = recurrenceConfig.frequency;
      payload.recurrence_interval = recurrenceConfig.interval;
      payload.recurrence_weekdays = recurrenceConfig.weekdays;
      payload.recurrence_month_day = recurrenceConfig.monthDay;
      payload.recurrence_month_week = recurrenceConfig.monthWeek;
      payload.recurrence_month_weekday = recurrenceConfig.monthWeekday;
      payload.recurrence_start_date = recurrenceConfig.startDate;
      payload.recurrence_end_date = recurrenceConfig.endDate;
      payload.recurrence_lead_days = recurrenceLeadDays;
      payload.recurrence_next_date = recurrenceNextDate;
      payload.recurrence_timezone = recurrenceTimezone;
    }

    if (startDate) {
      payload.start_date = startDate;
    }

    const { data: created, error } = await supabase
      .from("tasks")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
    }

    const taskId = created?.id;
    if (taskId && uniqueAssigneeIds.length) {
        const inserts = uniqueAssigneeIds.map((userId) => ({
          task_id: taskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          redirect(`${returnTo}?error=${encodeURIComponent(assigneeError.message)}`);
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
        redirect(`${returnTo}?error=${encodeURIComponent(subtaskTemplatesError.message)}`);
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
          redirect(`${returnTo}?error=${encodeURIComponent(taskAssigneesError.message)}`);
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

        const { data: createdSubtasks, error: subtaskInsertError } = await supabase
          .from("tasks")
          .insert(subtaskPlans.map((plan) => plan.payload))
          .select("id");

        if (subtaskInsertError) {
          redirect(`${returnTo}?error=${encodeURIComponent(subtaskInsertError.message)}`);
        }

        const createdSubtaskRows = (createdSubtasks || []).filter((row) => Boolean(row.id));
        const inserts = createdSubtaskRows.flatMap((row, index) => {
          const explicitIds = subtaskPlans[index]?.assigneeIds || [];
          const effectiveIds = explicitIds.length ? explicitIds : uniqueAssigneeIds;
          return effectiveIds.map((userId) => ({ task_id: row.id, user_id: userId }));
        });
        if (inserts.length) {
          const { error: subtaskAssigneesError } = await supabase
            .from("task_assignees")
            .insert(inserts);
          if (subtaskAssigneesError) {
            redirect(`${returnTo}?error=${encodeURIComponent(subtaskAssigneesError.message)}`);
          }
        }
      }
    }

    revalidatePath(`/clients/${clientId}/tasks`);
    redirect(`${returnTo}?success=${encodeURIComponent("Task created")}`);
  }
  const updateTaskInline = updateTaskInlineAction;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Tasks
        </h1>
        <ClientTabs clientId={clientId} active="tasks" />
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
        <h2 className="text-lg font-semibold text-slate-900">Add task</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/clients/${clientId}/tasks`}
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
                  ? `/clients/${clientId}/tasks?create_mode=template&template_task_id=${encodeURIComponent(
                      templateTaskId
                    )}`
                  : `/clients/${clientId}/tasks?create_mode=template`
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
              action={`/clients/${clientId}/tasks`}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="create_mode" value="template" />
              <select
                name="template_task_id"
                defaultValue={templateTaskId || ""}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
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
        <form action={createTask} className="mt-4 grid gap-4 md:grid-cols-6">
          {createMode === "template" && templateTaskId ? (
            <>
              <input type="hidden" name="create_mode" value="template" />
              <input type="hidden" name="template_task_id" value={templateTaskId} />
            </>
          ) : null}
          <input
            name="title"
            placeholder="Task title"
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={selectedTemplate?.title || ""}
            required
          />
          <select
            name="project_id"
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Project (N/A)</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="md:col-span-2 relative">
            <AssigneeMultiSelect users={users || []} name="assignee_user_ids" />
          </div>
          <select
            name="status"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={selectedTemplate?.status || "to_do"}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {formatTaskStatusLabel(status)}
              </option>
            ))}
          </select>
          <select
            name="priority"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={selectedTemplate?.priority || "medium"}
          >
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <RecurrenceFields
            className="md:col-span-6"
            initialFrequency={initialRecurrenceFrequency}
            initialDueTime={selectedTemplate?.due_time || undefined}
            initialLeadDays={selectedTemplate?.recurrence_lead_days ?? 7}
          />
          <button
            type="submit"
            className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create task
          </button>
        </form>
      </section>

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
        />
      </section>
    </div>
  );
}





