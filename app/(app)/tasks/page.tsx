import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import TasksView from "./TasksView";

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
    status?: string;
    priority?: string;
    assignee?: string;
    due?: string;
    client?: string;
    project?: string;
    hide?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const selectedStatus = (searchParams?.status || "all").trim();
  const selectedPriority = (searchParams?.priority || "all").trim();
  const selectedAssignee = (searchParams?.assignee || "all").trim();
  const selectedDue = (searchParams?.due || "all").trim();
  const selectedClient = (searchParams?.client || "all").trim();
  const selectedProject = (searchParams?.project || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const returnParams = new URLSearchParams();

  if (selectedStatus !== "all") {
    returnParams.set("status", selectedStatus);
  }

  if (selectedPriority !== "all") {
    returnParams.set("priority", selectedPriority);
  }

  if (selectedAssignee !== "all") {
    returnParams.set("assignee", selectedAssignee);
  }

  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }

  if (selectedClient !== "all") {
    returnParams.set("client", selectedClient);
  }

  if (selectedProject !== "all") {
    returnParams.set("project", selectedProject);
  }

  returnParams.set("hide", hideCompleted ? "1" : "0");

  const returnTo = returnParams.toString() ? `/tasks?${returnParams}` : "/tasks";
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `/tasks?${toggleParams}` : "/tasks";

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

  let request = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,created_at,assignee_user_id,client_id,project_id,projects(name),clients(name)"
    )
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

  if (selectedStatus !== "all") {
    request = request.eq("status", selectedStatus);
  }

  if (selectedPriority !== "all") {
    request = request.eq("priority", selectedPriority);
  }

  if (selectedAssignee === "unassigned") {
    request = request.is("assignee_user_id", null);
  } else if (selectedAssignee !== "all") {
    request = request.eq("assignee_user_id", selectedAssignee);
  }

  if (selectedClient !== "all") {
    request = request.eq("client_id", selectedClient);
  }

  if (selectedProject !== "all") {
    request = request.eq("project_id", selectedProject);
  }

  if (hideCompleted) {
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

  async function seedAdminUser() {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const email = authData.user?.email;

    if (!email) {
      redirect("/tasks?error=Unable%20to%20read%20auth%20user");
    }

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      redirect("/tasks?success=User%20already%20exists");
    }

    const { error } = await supabase.from("users").insert({
      email,
      full_name: authData.user?.user_metadata?.full_name || "Admin User",
      role: "admin",
      status: "active",
    });

    if (error) {
      redirect(`/tasks?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/tasks");
    redirect("/tasks?success=Admin%20user%20created");
  }

  async function createTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const status = String(formData.get("status") || "backlog");
    const priority = String(formData.get("priority") || "medium");
    const startDate = String(formData.get("start_date") || "");
    const dueDate = String(formData.get("due_date") || "");
    const assigneeUserId = String(formData.get("assignee_user_id") || "");
    const clientIdRaw = String(formData.get("client_id") || "").trim();
    const projectIdRaw = String(formData.get("project_id") || "").trim();
    let clientId = clientIdRaw || null;
    let projectId = projectIdRaw || null;

    if (!title) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=Title%20is%20required`
        : `${returnTo}?error=Title%20is%20required`;
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

    const payload: Record<string, unknown> = {
      client_id: clientId,
      project_id: projectId,
      title,
      status,
      priority,
      due_date: dueDate || null,
      assignee_user_id: assigneeUserId || null,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: defaultContentText,
    };

    if (startDate) {
      payload.start_date = startDate;
    }

    const { error } = await supabase.from("tasks").insert(payload);

    if (error) {
      const errorUrl = returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(error.message)}`
        : `${returnTo}?error=${encodeURIComponent(error.message)}`;
      redirect(errorUrl);
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
            Create a profile for the current auth user to enable task assignment.
          </p>
          <form action={seedAdminUser} className="mt-3">
            <button
              type="submit"
              className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Create admin user profile
            </button>
          </form>
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
            <select
              name="assignee_user_id"
              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            name="due_date"
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
          <form className="mt-4 grid gap-4 md:grid-cols-6">
            <select
              name="status"
              defaultValue={selectedStatus}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              name="priority"
              defaultValue={selectedPriority}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All priorities</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <select
              name="assignee"
              defaultValue={selectedAssignee}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.email}
                </option>
              ))}
            </select>
            <select
              name="due"
              defaultValue={selectedDue}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {dueDateFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <select
              name="client"
              defaultValue={selectedClient}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All clients</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select
              name="project"
              defaultValue={selectedProject}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All projects</option>
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
            <button
              type="submit"
              className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Apply filters
            </button>
          </form>
        </div>
      </details>

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={tasks || []}
          users={users || []}
          clients={clients || []}
          projects={projects || []}
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



