import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ProjectTabs from "../_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import ProjectTaskInlineRow from "./ProjectTaskInlineRow";

const statusOptions = [
  "backlog",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;
const priorityOptions = ["low", "medium", "high", "critical"] as const;
const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export default async function ProjectTasksPage({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams?: { error?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,client_id")
    .eq("id", params.projectId)
    .single();

  if (!project) {
    notFound();
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id,title,status,priority,start_date,due_date,assignee_user_id,parent_task_id")
    .eq("project_id", project.id)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const status = String(formData.get("status") || "backlog");
    const priority = String(formData.get("priority") || "medium");
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "");
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const parentTaskId = String(formData.get("parent_task_id") || "");

    if (!title) {
      redirect(`/projects/${project.id}/tasks?error=Title%20is%20required`);
    }

    const payload: Record<string, unknown> = {
      client_id: project.client_id,
      project_id: project.id,
      title,
      status,
      priority,
      due_date: dueDate || null,
      assignee_user_id: assigneeUserId || null,
      parent_task_id: parentTaskId || null,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (startDate) {
      payload.start_date = startDate;
    }

    const { error } = await supabase.from("tasks").insert(payload);

    if (error) {
      redirect(`/projects/${project.id}/tasks?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/projects/${project.id}/tasks`);
  }

  async function updateTaskInline(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const taskId = String(formData.get("task_id") || "").trim();
    const status = String(formData.get("status") || "").trim();
    const priority = String(formData.get("priority") || "").trim();
    const assignee = String(formData.get("assignee_user_id") || "").trim();
    const startDate = String(formData.get("start_date") || "").trim();
    const dueDate = String(formData.get("due_date") || "").trim();
    const updates: Record<string, string | null> = {};
    const returnTo = `/projects/${project.id}/tasks`;

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
      .eq("project_id", project.id);

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
        <ProjectTabs projectId={project.id} active="tasks" />
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
          <select
            name="assignee_user_id"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Unassigned</option>
            {users?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email}
              </option>
            ))}
          </select>
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
          <input
            type="date"
            name="start_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            name="due_date"
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


