import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import TaskNotesEditorClient from "./TaskNotesEditorClient";
import TaskTabs, {
  normalizeTaskTabKey,
  type TaskTabKey,
} from "./_components/TaskTabs";
import ConfirmDelete from "../../_components/ConfirmDelete";
import {
  TASK_STATUS_OPTIONS,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";

const statusOptions = TASK_STATUS_OPTIONS;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

function buildTaskUrl(
  taskId: string,
  tab: TaskTabKey,
  params?: { error?: string; success?: string }
) {
  const sp = new URLSearchParams();

  if (tab !== "details") {
    sp.set("tab", tab);
  }
  if (params?.error) {
    sp.set("error", params.error);
  }
  if (params?.success) {
    sp.set("success", params.success);
  }

  const qs = sp.toString();
  return qs ? `/tasks/${taskId}?${qs}` : `/tasks/${taskId}`;
}

export default async function TaskDetailPage(props: {
  params: Promise<{ taskId: string }>;
  searchParams?: Promise<{ error?: string; success?: string; tab?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: task } = await supabase
    .from("tasks")
    .select(
      "id,title,description,status,priority,start_date,due_date,due_time,assignee_user_id,project_id,client_id,content,last_edited_at,last_edited_by_user_id,projects(name),clients(name)"
    )
    .eq("id", params.taskId)
    .single();

  if (!task) {
    notFound();
  }

  const taskId = task.id;
  const activeTab = normalizeTaskTabKey(searchParams?.tab);
  const taskStatus = task.status;
  const taskPriority = task.priority;
  const taskClientId = task.client_id;
  const taskProjectId = task.project_id;
  const taskAssigneeUserId = task.assignee_user_id;

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  const formatDueTime = (value: string | null | undefined) => {
    if (!value) {
      return "";
    }
    const time = value.slice(0, 5);
    const parsed = new Date(`1970-01-01T${time}:00`);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    return parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const { data: taskAssignees } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", taskId);
  const assignedUserIds = new Set(
    (taskAssignees || []).map((row) => row.user_id).filter(Boolean)
  );
  if (task.assignee_user_id) {
    assignedUserIds.add(task.assignee_user_id);
  }

  const { data: taskWatchers } = await supabase
    .from("task_watchers")
    .select("user_id")
    .eq("task_id", taskId);
  const watcherUserIds = new Set(
    (taskWatchers || []).map((row) => row.user_id).filter(Boolean)
  );

  const assigneeMap = new Map(
    users?.map((user) => [user.id, user.full_name || user.email]) || []
  );
  const lastEditedAtLabel = task.last_edited_at
    ? new Date(task.last_edited_at).toLocaleString("en-US")
    : null;
  const lastEditedByLabel = task.last_edited_by_user_id
    ? assigneeMap.get(task.last_edited_by_user_id) || "Unknown user"
    : null;

  const { data: subtasks } = await supabase
    .from("tasks")
    .select("id,title,status,priority,start_date,due_date,due_time,assignee_user_id")
    .eq("parent_task_id", task.id)
    .order("created_at", { ascending: false });

  async function updateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const existingStatus = normalizeTaskStatusOrDefault(taskStatus);
    const status = normalizeTaskStatusOrDefault(
      String(formData.get("status") || existingStatus),
      existingStatus
    );
    const priority = String(formData.get("priority") || taskPriority);
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "");
    const dueTime = String(formData.get("due_time") || "");
    const assignee = String(formData.get("assignee_user_id") || "");

    if (!title) {
      redirect(buildTaskUrl(taskId, "details", { error: "Task name is required" }));
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        title,
        status,
        priority,
        start_date: startDate || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        assignee_user_id: assignee || null,
      })
      .eq("id", taskId);

    if (error) {
      redirect(buildTaskUrl(taskId, "details", { error: error.message }));
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "details", { success: "Saved" }));
  }

  async function updateTaskAssignees(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("task_assignees").delete().eq("task_id", taskId);

    const uniqueIds = Array.from(new Set(selectedIds));
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({
        task_id: taskId,
        user_id: userId,
      }));
      const { error } = await supabase.from("task_assignees").insert(inserts);
      if (error) {
        redirect(buildTaskUrl(taskId, "assignees", { error: error.message }));
      }
    }

    const primaryAssignee = uniqueIds[0] || null;
    if (primaryAssignee !== taskAssigneeUserId) {
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ assignee_user_id: primaryAssignee })
        .eq("id", taskId);
      if (updateError) {
        redirect(buildTaskUrl(taskId, "assignees", { error: updateError.message }));
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "assignees", { success: "Assignees updated" }));
  }

  async function updateTaskWatchers(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const selectedIds = formData
      .getAll("watcher_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    await supabase.from("task_watchers").delete().eq("task_id", taskId);

    const uniqueIds = Array.from(new Set(selectedIds));
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({
        task_id: taskId,
        user_id: userId,
      }));
      const { error } = await supabase.from("task_watchers").insert(inserts);
      if (error) {
        redirect(buildTaskUrl(taskId, "watchers", { error: error.message }));
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "watchers", { success: "Watchers updated" }));
  }

  async function createSubtask(formData: FormData) {
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
    const dueDate = String(formData.get("due_date") || "");
    const dueTime = String(formData.get("due_time") || "");
    const assignee = String(formData.get("assignee_user_id") || "");
    const assigneeIds = formData
      .getAll("assignee_user_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);

    if (!title) {
      redirect(
        buildTaskUrl(taskId, "subtasks", { error: "Subtask title is required" })
      );
    }

    const primaryAssignee =
      assigneeIds.find((value) => value !== "unassigned") || assignee;

    const payload: Record<string, unknown> = {
      client_id: taskClientId,
      project_id: taskProjectId,
      parent_task_id: taskId,
      title,
      status,
      priority,
      due_date: dueDate || null,
      due_time: dueTime || null,
      assignee_user_id: primaryAssignee || null,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (startDate) {
      payload.start_date = startDate;
    }

    const { data: created, error } = await supabase
      .from("tasks")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      redirect(buildTaskUrl(taskId, "subtasks", { error: error.message }));
    }

    const subtaskId = created?.id;
    if (subtaskId && assigneeIds.length) {
      const uniqueIds = Array.from(
        new Set(assigneeIds.filter((value) => value !== "unassigned"))
      );
      if (uniqueIds.length) {
        const inserts = uniqueIds.map((userId) => ({
          task_id: subtaskId,
          user_id: userId,
        }));
        const { error: assigneeError } = await supabase
          .from("task_assignees")
          .insert(inserts);
        if (assigneeError) {
          redirect(
            buildTaskUrl(taskId, "subtasks", { error: assigneeError.message })
          );
        }
      }
    }

    revalidatePath(`/tasks/${taskId}`);
    redirect(buildTaskUrl(taskId, "subtasks", { success: "Subtask created" }));
  }

  async function deleteTask() {
    "use server";
    const supabase = createSupabaseServerClient();

    // Best-effort: delete subtasks first to avoid FK/parent references.
    const { error: subtaskError } = await supabase
      .from("tasks")
      .delete()
      .eq("parent_task_id", taskId);

    if (subtaskError) {
      redirect(buildTaskUrl(taskId, activeTab, { error: subtaskError.message }));
    }

    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) {
      redirect(buildTaskUrl(taskId, activeTab, { error: error.message }));
    }

    revalidatePath("/tasks");
    redirect("/tasks?success=Task%20deleted");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Task
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">{task.title}</h1>
          <form action={deleteTask}>
            <ConfirmDelete
              name={task.title}
              itemType="Task"
              triggerLabel="Delete task"
              confirmLabel="Permanently delete"
            />
          </form>
        </div>
        <div className="text-sm text-slate-600">
          <p>
            Client:{" "}
            {task.client_id ? (
              <Link href={`/clients/${task.client_id}`} className="hover:underline">
                {getRelationName(task.clients, "View client")}
              </Link>
            ) : (
              <span className="text-slate-500">--</span>
            )}
          </p>
          <p>
            Project:{" "}
            {task.project_id ? (
              <Link href={`/projects/${task.project_id}`} className="hover:underline">
                {getRelationName(task.projects, "View project")}
              </Link>
            ) : (
              <span className="text-slate-500">--</span>
            )}
          </p>
        </div>
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

      <TaskTabs taskId={taskId} active={activeTab} />

      {activeTab === "details" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task details</h2>
          </div>
          <div className="px-6 pb-6">
          <form action={updateTask} className="mt-4 grid gap-4 md:grid-cols-4">
            <input
              name="title"
              defaultValue={task.title}
              className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <div className="grid gap-1">
              <label
                htmlFor="task-status"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Status
              </label>
              <select
                id="task-status"
                name="status"
                defaultValue={normalizeTaskStatusOrDefault(task.status)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-priority"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Priority
              </label>
              <select
                id="task-priority"
                name="priority"
                defaultValue={task.priority}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Primary assignee
              </label>
              <select
                name="assignee_user_id"
                defaultValue={task.assignee_user_id || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {users?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-start-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Start date
              </label>
              <input
                id="task-start-date"
                type="date"
                name="start_date"
                defaultValue={task.start_date || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-due-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due date
              </label>
              <input
                id="task-due-date"
                type="date"
                name="due_date"
                defaultValue={task.due_date || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="task-due-time"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due time
              </label>
              <input
                id="task-due-time"
                type="time"
                name="due_time"
                defaultValue={task.due_time ? task.due_time.slice(0, 5) : ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save task
            </button>
          </form>
        </div>
      </section>
    ) : null}

      {activeTab === "assignees" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task assignees</h2>
          </div>
          <div className="px-6 pb-6">
          {users?.length ? (
            <form action={updateTaskAssignees} className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      name="assignee_user_ids"
                      value={user.id}
                      defaultChecked={assignedUserIds.has(user.id)}
                    />
                    <span>{user.full_name || user.email}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Save assignees
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No users found.</p>
          )}
        </div>
      </section>
    ) : null}

      {activeTab === "watchers" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Task watchers</h2>
          </div>
          <div className="px-6 pb-6">
          <p className="mt-4 text-sm text-slate-600">
            Watchers can view and edit this task without being an assignee.
          </p>
          {users?.length ? (
            <form action={updateTaskWatchers} className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      name="watcher_user_ids"
                      value={user.id}
                      defaultChecked={watcherUserIds.has(user.id)}
                    />
                    <span>{user.full_name || user.email}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Save watchers
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No users found.</p>
          )}
        </div>
      </section>
    ) : null}

      {activeTab === "subtasks" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Add subtask</h2>
          </div>
          <div className="px-6 pb-6">
          <form action={createSubtask} className="mt-4 grid gap-4 md:grid-cols-5">
            <div className="grid gap-1 md:col-span-2">
              <label
                htmlFor="subtask-title"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Title
              </label>
              <input
                id="subtask-title"
                name="title"
                placeholder="Subtask title"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assignees
              </label>
              <select
                name="assignee_user_ids"
                multiple
                className="h-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {users?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">Hold Ctrl/Cmd to select multiple.</p>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-status"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Status
              </label>
              <select
                id="subtask-status"
                name="status"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                defaultValue="to_do"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-priority"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Priority
              </label>
              <select
                id="subtask-priority"
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
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-start-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Start date
              </label>
              <input
                id="subtask-start-date"
                type="date"
                name="start_date"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-due-date"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due date
              </label>
              <input
                id="subtask-due-date"
                type="date"
                name="due_date"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <label
                htmlFor="subtask-due-time"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Due time
              </label>
              <input
                id="subtask-due-time"
                type="time"
                name="due_time"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Create subtask
            </button>
          </form>
        </div>
      </section>
    ) : null}

      {activeTab === "subtasks" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Subtasks</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Subtask</th>
                <th className="px-6 py-3">Assignee</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Start</th>
                <th className="px-6 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {subtasks?.length ? (
                subtasks.map((subtask) => (
                  <tr key={subtask.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      <Link href={`/tasks/${subtask.id}`} className="hover:underline">
                        {subtask.title}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {subtask.assignee_user_id
                        ? assigneeMap.get(subtask.assignee_user_id) || "Unknown"
                        : "Unassigned"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {formatTaskStatusLabel(subtask.status)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{subtask.priority}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {subtask.start_date
                        ? new Date(subtask.start_date).toLocaleDateString("en-US")
                        : "--"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {subtask.due_date
                        ? `${new Date(subtask.due_date).toLocaleDateString("en-US")}${
                            subtask.due_time ? ` ${formatDueTime(subtask.due_time)}` : ""
                          }`
                        : "--"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={6}>
                    No subtasks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
      {activeTab === "notes" ? (
        <TaskNotesEditorClient
          taskId={task.id}
          initialContent={task.content ?? null}
          lastEditedAtLabel={lastEditedAtLabel}
          lastEditedByLabel={lastEditedByLabel}
        />
      ) : null}
    </div>
  );
}

