import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import TasksView from "./TasksView";
import TasksFilters from "./TasksFilters";
import AssigneeMultiSelect from "./_components/AssigneeMultiSelect";
import {
  DEFAULT_RECURRENCE_TZ,
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";
import RecurrenceFields from "./_components/RecurrenceFields";

const statusOptions = [
  "backlog",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export default async function TasksPage(props: {
  searchParams?: Promise<{
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    client?: string | string[];
    project?: string | string[];
    hide?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();

  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedPrioritiesRaw = parseCsvParam(searchParams?.priority);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const selectedClientIdsRaw = parseCsvParam(searchParams?.client);
  const selectedProjectIdsRaw = parseCsvParam(searchParams?.project);
  let selectedDue = (searchParams?.due || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";

  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const selectedStatuses = selectedStatusesRaw.filter((status) =>
    statusOptions.includes(status as (typeof statusOptions)[number])
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

  const userIdSet = new Set((users || []).map((user) => user.id));
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const selectedClientIds = selectedClientIdsRaw.filter((id) => clientIdSet.has(id));

  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));

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

  const returnTo = returnParams.toString() ? `/tasks?${returnParams}` : "/tasks";
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `/tasks?${toggleParams}` : "/tasks";

  let request = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,created_at,assignee_user_id,client_id,project_id,projects(name),clients(name)"
    )
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

  if (selectedClientIds.length) {
    request = request.in("client_id", selectedClientIds);
  }

  if (selectedProjectIds.length) {
    request = request.in("project_id", selectedProjectIds);
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
    const status = String(formData.get("status") || "backlog");
    const priority = String(formData.get("priority") || "medium");
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
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
    const clientIdRaw = String(formData.get("client_id") || "").trim();
    const projectIdRaw = String(formData.get("project_id") || "").trim();
    let clientId = clientIdRaw || null;
    const projectId = projectIdRaw || null;

    if (!title) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=Title%20is%20required`
        : `${returnTo}?error=Title%20is%20required`;
      redirect(errorUrl);
    }

    if (!dueDate || !dueTime) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=Deadline%20date%20and%20time%20are%20required`
        : `${returnTo}?error=Deadline%20date%20and%20time%20are%20required`;
      redirect(errorUrl);
    }

    if (projectId && !clientId) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("client_id")
        .eq("id", projectId)
        .maybeSingle();

      if (error) {
        const errorUrl = returnTo.includes("?")
          ? `${returnTo}&error=${encodeURIComponent(error.message)}`
          : `${returnTo}?error=${encodeURIComponent(error.message)}`;
        redirect(errorUrl);
      }

      clientId = project?.client_id || null;
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
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(error.message)}`
        : `${returnTo}?error=${encodeURIComponent(error.message)}`;
      redirect(errorUrl);
    }

    const taskId = created?.id;
    if (taskId && assigneeIds.length) {
      const uniqueIds = Array.from(
        new Set(assigneeIds.filter((value) => value !== "unassigned"))
      );
      if (uniqueIds.length) {
        const inserts = uniqueIds.map((userId) => ({
          task_id: taskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          const errorUrl = returnTo.includes("?")
            ? `${returnTo}&error=${encodeURIComponent(assigneeError.message)}`
            : `${returnTo}?error=${encodeURIComponent(assigneeError.message)}`;
          redirect(errorUrl);
        }
      }
    }

    revalidatePath("/tasks");
    const successUrl = returnTo.includes("?")
      ? `${returnTo}&success=Task%20created`
      : `${returnTo}?success=Task%20created`;
    redirect(successUrl);
  }

  async function updateTaskInline(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const taskId = String(formData.get("task_id") || "").trim();
    const clientId = String(formData.get("client_id") || "").trim();
    const projectId = String(formData.get("project_id") || "").trim();
    const status = String(formData.get("status") || "").trim();
    const priority = String(formData.get("priority") || "").trim();
    const assignee = String(formData.get("assignee_user_id") || "").trim();
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const startDate = String(formData.get("start_date") || "").trim();
    const dueDate = String(formData.get("due_date") || "").trim();
    const updates: Record<string, string | null> = {};

    if (!taskId) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=Missing%20task%20id`
        : `${returnTo}?error=Missing%20task%20id`;
      redirect(errorUrl);
    }

    if (formData.has("status")) {
      updates.status = status;
    }

    if (formData.has("client_id")) {
      updates.client_id = clientId || null;
    }

    if (formData.has("project_id")) {
      updates.project_id = projectId || null;
    }

    if (formData.has("priority")) {
      updates.priority = priority;
    }

    if (formData.has("assignee_user_id")) {
      updates.assignee_user_id = assignee || null;
    }

    if (formData.has("assignee_user_ids")) {
      const uniqueIds = Array.from(new Set(assigneeIds));
      await supabase.from("task_assignees").delete().eq("task_id", taskId);
      if (uniqueIds.length) {
        const inserts = uniqueIds.map((userId) => ({
          task_id: taskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          const errorUrl = returnTo.includes("?")
            ? `${returnTo}&error=${encodeURIComponent(assigneeError.message)}`
            : `${returnTo}?error=${encodeURIComponent(assigneeError.message)}`;
          redirect(errorUrl);
        }
      }
      updates.assignee_user_id = uniqueIds[0] || null;
    }

    if (formData.has("start_date")) {
      updates.start_date = startDate || null;
    }

    if (formData.has("due_date")) {
      updates.due_date = dueDate || null;
    }

    if (!Object.keys(updates).length) {
      redirect(returnTo);
    }

    const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);

    if (error) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(error.message)}`
        : `${returnTo}?error=${encodeURIComponent(error.message)}`;
      redirect(errorUrl);
    }

    revalidatePath("/tasks");
    redirect(returnTo);
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

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-6 py-4 text-lg font-semibold text-slate-900">
          Add task
        </summary>
        <div className="border-t border-slate-200 px-6 pb-6">
          <form action={createTask} className="mt-4 grid gap-4 md:grid-cols-6">
            <input
              name="title"
              placeholder="Task title"
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <select
              name="client_id"
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">Client (N/A)</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select
              name="project_id"
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            <div className="md:col-span-2 relative">
              <AssigneeMultiSelect
                users={users || []}
                name="assignee_user_ids"
              />
            </div>
            <select
              name="status"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue="backlog"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              name="priority"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue="medium"
            >
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <RecurrenceFields className="md:col-span-6" />
            <input
              type="date"
              name="start_date"
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Create task
            </button>
          </form>
        </div>
      </details>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-6 py-4 text-lg font-semibold text-slate-900">
          Filters
        </summary>
        <div className="border-t border-slate-200 px-6 pb-6">
          <TasksFilters
            statusOptions={statusOptions}
            priorityOptions={priorityOptions}
            dueOptions={dueDateFilters}
            users={users || []}
            clients={clients || []}
            projects={projects || []}
            hideCompleted={hideCompleted}
            initialFilters={{
              status: selectedStatuses,
              priority: selectedPriorities,
              assignee: selectedAssignees,
              due: selectedDue,
              client: selectedClientIds,
              project: selectedProjectIds,
            }}
          />
        </div>
      </details>

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={tasks || []}
          users={users || []}
          clients={clients || []}
          projects={projects || []}
          assigneesByTask={assigneesByTask}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          onUpdate={updateTaskInline}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
        />
      </section>
    </div>
  );
}



