import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import ClientTaskInlineRow from "./ClientTaskInlineRow";
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
import AssigneeMultiSelect from "../../../tasks/_components/AssigneeMultiSelect";
import RecurrenceFields from "../../../tasks/_components/RecurrenceFields";
import {
  DEFAULT_RECURRENCE_TZ,
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";

const statusOptions = TASK_STATUS_OPTIONS;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export default async function ClientTasksPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
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
  const returnTo = `/clients/${clientId}/tasks`;

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();

  const sortKey = normalizeTaskSortKey(searchParams?.sort);
  const sortDir = normalizeTaskSortDir(searchParams?.dir);
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
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

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,assignee_user_id,project_id,projects(name)"
    )
    .eq("client_id", clientId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

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

  const buildSortUrl = (key: ReturnType<typeof normalizeTaskSortKey>) => {
    const params = new URLSearchParams();
    const nextDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    params.set("sort", key);
    params.set("dir", nextDir);
    const query = params.toString();
    return query ? `/clients/${clientId}/tasks?${query}` : `/clients/${clientId}/tasks`;
  };

  const sortIndicator = (key: ReturnType<typeof normalizeTaskSortKey>) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

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

    const primaryAssignee =
      assigneeIds.find((value) => value !== "unassigned") ||
      (assigneeUserId || "");

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
    const uniqueAssigneeIds = Array.from(
        new Set(assigneeIds.filter((value) => value !== "unassigned"))
      );
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
        redirect(`${returnTo}?error=${encodeURIComponent(subtaskTemplatesError.message)}`);
      }

      if (subtaskTemplates.length) {
        const payloads = subtaskTemplates.map((tpl) => ({
          client_id: clientId,
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
          redirect(`${returnTo}?error=${encodeURIComponent(subtaskInsertError.message)}`);
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
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("title")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Task
                    {sortIndicator("title")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("project")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Project
                    {sortIndicator("project")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("assignees")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Assignee
                    {sortIndicator("assignees")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("status")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Status
                    {sortIndicator("status")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("priority")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Priority
                    {sortIndicator("priority")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("start")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Start
                    {sortIndicator("start")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <a
                    href={buildSortUrl("due")}
                    className="inline-flex items-center gap-2 hover:text-slate-900"
                  >
                    Due
                    {sortIndicator("due")}
                  </a>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks?.length ? (
                sortedTasks.map((task) => (
                  <ClientTaskInlineRow
                    key={task.id}
                    task={task}
                    assigneeUserIds={assigneesByTask[task.id] || []}
                    users={users || []}
                    projects={projects || []}
                    statusOptions={statusOptions}
                    priorityOptions={priorityOptions}
                    onUpdate={updateTaskInline}
                    returnTo={returnTo}
                  />
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={7}>
                    No tasks yet.
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




