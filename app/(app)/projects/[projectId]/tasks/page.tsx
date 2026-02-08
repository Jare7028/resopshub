import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "../_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import ProjectTaskInlineRow from "./ProjectTaskInlineRow";
import AssigneeMultiSelect from "@/app/(app)/tasks/_components/AssigneeMultiSelect";
import RecurrenceFields from "@/app/(app)/tasks/_components/RecurrenceFields";
import {
  DEFAULT_RECURRENCE_TZ,
  getFirstOccurrence,
  getNextOccurrence,
  type RecurrenceConfig,
} from "@/lib/recurrence";

const statusOptions = [
  "backlog",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export default async function ProjectTasksPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
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

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment) {
      redirect("/projects?error=Not%20assigned%20to%20that%20project");
    }
  } else if (!isAdmin && !currentUserId) {
    redirect("/projects?error=User%20profile%20missing");
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id,title,status,priority,start_date,due_date,assignee_user_id,parent_task_id")
    .eq("project_id", projectId)
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

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
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
    const parentTaskId = String(formData.get("parent_task_id") || "");
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
          redirect(`/projects/${projectId}/tasks?error=${encodeURIComponent(assigneeError.message)}`);
        }
      }
    }

    revalidatePath(`/projects/${projectId}/tasks`);
  }

  async function updateTaskInline(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const taskId = String(formData.get("task_id") || "").trim();
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
    const returnTo = `/projects/${projectId}/tasks`;

    if (!taskId) {
      redirect(`${returnTo}?error=Missing%20task%20id`);
    }

    if (formData.has("status")) {
      updates.status = status;
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
          redirect(`${returnTo}?error=${encodeURIComponent(assigneeError.message)}`);
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

    const { error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", taskId)
      .eq("project_id", projectId);

    if (error) {
      redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(returnTo);
    redirect(returnTo);
  }

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
        <h2 className="text-lg font-semibold text-slate-900">Add task</h2>
        <form action={createTask} className="mt-4 grid gap-4 md:grid-cols-6">
          <input
            name="title"
            placeholder="Task title"
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                <th className="px-6 py-3">Task</th>
                <th className="px-6 py-3">Assignee</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Start</th>
                <th className="px-6 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks?.length ? (
                tasks.map((task) => (
                  <ProjectTaskInlineRow
                    key={task.id}
                    task={task}
                    assigneeUserIds={assigneesByTask[task.id] || []}
                    users={users || []}
                    statusOptions={statusOptions}
                    priorityOptions={priorityOptions}
                    onUpdate={updateTaskInline}
                  />
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={6}>
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


