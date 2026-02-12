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
import {
  DEFAULT_RECURRENCE_TZ,
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";
import {
  TASK_STATUS_OPTIONS,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import { updateTaskInlineAction } from "../../../tasks/actions";

const statusOptions = TASK_STATUS_OPTIONS;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export default async function ProjectTasksPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{
    error?: string;
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
  const sortKey = normalizeTaskSortKey(searchParams?.sort);
  const sortDir = normalizeTaskSortDir(searchParams?.dir);
  const viewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const selectedStatuses = parseCsvParam(searchParams?.status).filter((status) =>
    statusOptions.includes(status as (typeof statusOptions)[number])
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

  type TaskTemplateRow = {
    id: string;
    name: string;
    title: string;
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  };

  const { data: taskTemplatesRaw, error: taskTemplatesError } = await supabase
    .from("task_templates")
    .select(
      "id,name,title,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
    )
    .order("name", { ascending: true });

  const taskTemplates = (taskTemplatesError ? [] : taskTemplatesRaw || []) as TaskTemplateRow[];
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
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const parentTaskId = String(formData.get("parent_task_id") || "");
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
      redirect(`/projects/${projectId}/tasks?error=Title%20is%20required`);
    }

    if (!dueDate || !dueTime) {
      redirect(`/projects/${projectId}/tasks?error=Deadline%20date%20and%20time%20are%20required`);
    }

    const manualAssigneeIds = Array.from(
      new Set(assigneeIds.filter((value) => value !== "unassigned"))
    );
    let templateAssigneeIds: string[] = [];
    if (templateTaskIdFromForm) {
      const { data: templateAssigneeRows, error: templateAssigneesError } = await supabase
        .from("task_template_assignees")
        .select("user_id")
        .eq("task_template_id", templateTaskIdFromForm);
      if (templateAssigneesError && !isSupabaseMissingTableError(templateAssigneesError)) {
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(templateAssigneesError.message)}`);
      }
      templateAssigneeIds = (templateAssigneeRows || [])
        .map((row) => row.user_id)
        .filter(Boolean);
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
      client_id: projectClientId,
      project_id: projectId,
      title,
      status,
      priority,
      due_date: dueDate || null,
      due_time: dueTime || null,
      assignee_user_id: primaryAssignee || null,
      parent_task_id: parentTaskId || null,
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
      redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(error.message)}`);
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
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(assigneeError.message)}`);
      }
    }

    if (taskId && templateTaskIdFromForm && !parentTaskId) {
      const { data: subtaskTemplatesRaw, error: subtaskTemplatesError } = await supabase
        .from("task_template_subtasks")
        .select("id,title,description,status,priority,position")
        .eq("task_template_id", templateTaskIdFromForm)
        .order("position", { ascending: true });

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

      if (subtaskTemplatesError && !isSupabaseMissingTableError(subtaskTemplatesError)) {
        redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(subtaskTemplatesError.message)}`);
      }

      if (subtaskTemplates.length) {
        const payloads = subtaskTemplates.map((tpl) => ({
          client_id: projectClientId,
          project_id: projectId,
          parent_task_id: taskId,
          title: tpl.title,
          status: normalizeTaskStatusOrDefault(String(tpl.status || "to_do")),
          priority: String(tpl.priority || "medium"),
          due_date: null,
          due_time: null,
          assignee_user_id: primaryAssignee || null,
          content: DEFAULT_EDITOR_CONTENT,
          content_text: defaultContentText,
        }));

        const { data: createdSubtasks, error: subtaskInsertError } = await supabase
          .from("tasks")
          .insert(payloads)
          .select("id");

        if (subtaskInsertError) {
          redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(subtaskInsertError.message)}`);
        }

        const subtaskIds = (createdSubtasks || []).map((row) => row.id).filter(Boolean);
        if (subtaskIds.length && uniqueAssigneeIds.length) {
          const inserts = subtaskIds.flatMap((subtaskId) =>
            uniqueAssigneeIds.map((userId) => ({ task_id: subtaskId, user_id: userId }))
          );
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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <details>
          <summary className="cursor-pointer text-lg font-semibold text-slate-900">
            Add task
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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
              Templates are not set up yet. Run `sql/templates.sql` in Supabase SQL editor,
              then refresh this page.
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
              name="parent_task_id"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">Parent task (optional)</option>
              {tasks?.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <div className="relative">
              <AssigneeMultiSelect
                users={users || []}
                name="assignee_user_ids"
              />
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
          sortKey={sortKey}
          sortDir={sortDir}
          initialView={selectedView}
          basePath={basePath}
          fixedParams={{
            project: projectId,
            ...(projectClientId ? { client: projectClientId } : {}),
          }}
        />
      </section>
    </div>
  );
}



