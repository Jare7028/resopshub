import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const taskStatuses = ["backlog", "in_progress", "blocked", "completed", "cancelled"] as const;
const taskPriorities = ["low", "medium", "high", "critical"] as const;
const projectActiveStatuses = ["planned", "active", "on_hold"] as const;

const rangeOptions = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: {
    range?: string;
    client?: string;
    project?: string;
    user?: string;
    status?: string;
    priority?: string;
  };
}) {
  const supabase = createSupabaseServerClient();

  const selectedRange = (searchParams?.range || "all").trim();
  const selectedClient = (searchParams?.client || "all").trim();
  const selectedProject = (searchParams?.project || "all").trim();
  const selectedUser = (searchParams?.user || "all").trim();
  const selectedStatus = (searchParams?.status || "all").trim();
  const selectedPriority = (searchParams?.priority || "all").trim();

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name,status,client_id,updated_at")
    .order("name", { ascending: true });

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const now = new Date();
  const todayIso = toIsoDate(now);
  let rangeStart: string | null = null;

  if (selectedRange === "7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    rangeStart = start.toISOString();
  } else if (selectedRange === "30d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    rangeStart = start.toISOString();
  } else if (selectedRange === "90d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    rangeStart = start.toISOString();
  }

  let tasksQuery = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,due_date,assignee_user_id,project_id,client_id,created_at,projects(id,name,status),clients(id,name)"
    )
    .is("parent_task_id", null);

  if (selectedClient !== "all") {
    tasksQuery = tasksQuery.eq("client_id", selectedClient);
  }

  if (selectedProject !== "all") {
    tasksQuery = tasksQuery.eq("project_id", selectedProject);
  }

  if (selectedUser !== "all") {
    tasksQuery = tasksQuery.eq("assignee_user_id", selectedUser);
  }

  if (selectedStatus !== "all") {
    tasksQuery = tasksQuery.eq("status", selectedStatus);
  }

  if (selectedPriority !== "all") {
    tasksQuery = tasksQuery.eq("priority", selectedPriority);
  }

  if (rangeStart) {
    tasksQuery = tasksQuery.gte("created_at", rangeStart).lte("created_at", now.toISOString());
  }

  const { data: tasks } = await tasksQuery;

  const openTasks = (tasks || []).filter(
    (task) => task.status !== "completed" && task.status !== "cancelled"
  );

  const blockedTasks = openTasks.filter((task) => task.status === "blocked");
  const overdueTasks = openTasks.filter(
    (task) => task.due_date && task.due_date < todayIso
  );

  const activeProjects = (projects || []).filter((project) =>
    projectActiveStatuses.includes(project.status as (typeof projectActiveStatuses)[number])
  );

  const filteredProjects = activeProjects.filter((project) => {
    if (selectedClient !== "all" && project.client_id !== selectedClient) {
      return false;
    }
    if (selectedProject !== "all" && project.id !== selectedProject) {
      return false;
    }
    return true;
  });

  const projectCountByClient = new Map<string, number>();
  filteredProjects.forEach((project) => {
    if (!project.client_id) {
      return;
    }
    projectCountByClient.set(
      project.client_id,
      (projectCountByClient.get(project.client_id) || 0) + 1
    );
  });

  const clientWorkloadMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      open: number;
      blocked: number;
      overdue: number;
      projects: number;
      activity: string | null;
    }
  >();

  openTasks.forEach((task) => {
    const clientId = task.client_id;
    const clientName = task.clients?.name || "Unknown";
    if (!clientId) {
      return;
    }
    if (!clientWorkloadMap.has(clientId)) {
      clientWorkloadMap.set(clientId, {
        clientId,
        clientName,
        open: 0,
        blocked: 0,
        overdue: 0,
        projects: projectCountByClient.get(clientId) || 0,
        activity: null,
      });
    }
    const entry = clientWorkloadMap.get(clientId);
    if (!entry) {
      return;
    }
    entry.open += 1;
    if (task.status === "blocked") {
      entry.blocked += 1;
    }
    if (task.due_date && task.due_date < todayIso) {
      entry.overdue += 1;
    }
    if (task.created_at) {
      if (!entry.activity || task.created_at > entry.activity) {
        entry.activity = task.created_at;
      }
    }
  });

  const clientWorkload = Array.from(clientWorkloadMap.values()).sort(
    (a, b) => b.open - a.open
  );

  const userWorkloadMap = new Map<
    string,
    { userId: string; userName: string; open: number; blocked: number; overdue: number; projects: number }
  >();

  openTasks.forEach((task) => {
    const userId = task.assignee_user_id || "unassigned";
    const userName =
      task.assignee_user_id && users
        ? users.find((user) => user.id === task.assignee_user_id)?.full_name ||
          users.find((user) => user.id === task.assignee_user_id)?.email ||
          "Unknown"
        : "Unassigned";

    if (!userWorkloadMap.has(userId)) {
      userWorkloadMap.set(userId, {
        userId,
        userName,
        open: 0,
        blocked: 0,
        overdue: 0,
        projects: 0,
      });
    }
    const entry = userWorkloadMap.get(userId);
    if (!entry) {
      return;
    }
    entry.open += 1;
    if (task.status === "blocked") {
      entry.blocked += 1;
    }
    if (task.due_date && task.due_date < todayIso) {
      entry.overdue += 1;
    }
  });

  userWorkloadMap.forEach((entry, key) => {
    const projectIds = new Set(
      openTasks
        .filter((task) => (task.assignee_user_id || "unassigned") === key)
        .map((task) => task.project_id)
        .filter(Boolean)
    );
    entry.projects = projectIds.size;
  });

  const userWorkload = Array.from(userWorkloadMap.values()).sort(
    (a, b) => b.open - a.open
  );

  const statusCounts = new Map<string, number>();
  openTasks.forEach((task) => {
    const status = task.status || "unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  });

  const priorityCounts = new Map<string, number>();
  openTasks.forEach((task) => {
    const priority = task.priority || "unknown";
    priorityCounts.set(priority, (priorityCounts.get(priority) || 0) + 1);
  });

  const totalOpen = openTasks.length || 1;
  const statusDistribution = taskStatuses
    .map((status) => ({
      label: status.replace("_", " "),
      value: statusCounts.get(status) || 0,
      percent: Math.round(((statusCounts.get(status) || 0) / totalOpen) * 100),
    }))
    .filter((item) => item.value > 0);

  const priorityDistribution = taskPriorities
    .map((priority) => ({
      label: priority,
      value: priorityCounts.get(priority) || 0,
      percent: Math.round(((priorityCounts.get(priority) || 0) / totalOpen) * 100),
    }))
    .filter((item) => item.value > 0);

  const projectHealthMap = new Map<
    string,
    { projectId: string; projectName: string; clientName: string; open: number; blocked: number; overdue: number }
  >();

  openTasks.forEach((task) => {
    if (!task.project_id) {
      return;
    }
    if (!projectHealthMap.has(task.project_id)) {
      projectHealthMap.set(task.project_id, {
        projectId: task.project_id,
        projectName: task.projects?.name || "Untitled project",
        clientName: task.clients?.name || "Unknown",
        open: 0,
        blocked: 0,
        overdue: 0,
      });
    }
    const entry = projectHealthMap.get(task.project_id);
    if (!entry) {
      return;
    }
    entry.open += 1;
    if (task.status === "blocked") {
      entry.blocked += 1;
    }
    if (task.due_date && task.due_date < todayIso) {
      entry.overdue += 1;
    }
  });

  const projectHealth = Array.from(projectHealthMap.values()).sort(
    (a, b) => b.open - a.open
  );

  let activityQuery = supabase
    .from("tasks")
    .select("id,title,created_at,project_id,client_id,projects(name),clients(name)")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(6);

  if (selectedClient !== "all") {
    activityQuery = activityQuery.eq("client_id", selectedClient);
  }

  if (selectedProject !== "all") {
    activityQuery = activityQuery.eq("project_id", selectedProject);
  }

  if (selectedUser !== "all") {
    activityQuery = activityQuery.eq("assignee_user_id", selectedUser);
  }

  if (rangeStart) {
    activityQuery = activityQuery.gte("created_at", rangeStart).lte("created_at", now.toISOString());
  }

  const { data: recentTasks } = await activityQuery;

  const recentActivity = (recentTasks || []).map((task) => ({
    item: `Task created: ${task.title}`,
    meta: `${task.clients?.name ?? "No client"} · ${
      task.created_at ? new Date(task.created_at).toLocaleDateString("en-US") : "-"
    }`,
  }));

  const newTasksLabel =
    selectedRange === "all"
      ? "Total tasks"
      : `New tasks (${rangeOptions.find((option) => option.value === selectedRange)?.label ?? ""})`;

  const snapshotCards = [
    { label: "Open tasks", value: openTasks.length.toString(), accent: "text-slate-900" },
    { label: "Blocked tasks", value: blockedTasks.length.toString(), accent: "text-amber-600" },
    { label: "Overdue tasks", value: overdueTasks.length.toString(), accent: "text-red-600" },
    {
      label: "Active projects",
      value: filteredProjects.length.toString(),
      accent: "text-slate-900",
    },
    {
      label: newTasksLabel,
      value: (tasks || []).length.toString(),
      accent: "text-slate-900",
    },
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Manager overview
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-600">
            Quick visibility into active work across clients, users, and projects.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form className="grid gap-3 md:grid-cols-6">
          <select
            name="range"
            defaultValue={selectedRange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {rangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            name="user"
            defaultValue={selectedUser}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All users</option>
            {users?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={selectedStatus}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            {taskStatuses.map((status) => (
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
            {taskPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
        </form>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {snapshotCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Work by client</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Open</th>
                  <th className="px-6 py-3">Blocked</th>
                  <th className="px-6 py-3">Overdue</th>
                  <th className="px-6 py-3">Projects</th>
                  <th className="px-6 py-3">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {clientWorkload.length ? (
                  clientWorkload.map((row) => (
                    <tr key={row.clientId} className="border-t border-slate-200">
                      <td className="px-6 py-3 font-medium text-slate-900">
                        <Link href={`/clients/${row.clientId}`} className="hover:underline">
                          {row.clientName}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-slate-600">{row.open}</td>
                      <td className="px-6 py-3 text-slate-600">{row.blocked}</td>
                      <td className="px-6 py-3 text-slate-600">{row.overdue}</td>
                      <td className="px-6 py-3 text-slate-600">{row.projects}</td>
                      <td className="px-6 py-3 text-slate-600">
                        {row.activity
                          ? new Date(row.activity).toLocaleDateString("en-US")
                          : "-"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-6 py-6 text-slate-500" colSpan={6}>
                      No client activity found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Work by user</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Open</th>
                  <th className="px-6 py-3">Blocked</th>
                  <th className="px-6 py-3">Overdue</th>
                  <th className="px-6 py-3">Projects</th>
                </tr>
              </thead>
              <tbody>
                {userWorkload.length ? (
                  userWorkload.map((row) => (
                    <tr key={row.userId} className="border-t border-slate-200">
                      <td className="px-6 py-3 font-medium text-slate-900">{row.userName}</td>
                      <td className="px-6 py-3 text-slate-600">{row.open}</td>
                      <td className="px-6 py-3 text-slate-600">{row.blocked}</td>
                      <td className="px-6 py-3 text-slate-600">{row.overdue}</td>
                      <td className="px-6 py-3 text-slate-600">{row.projects}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-6 py-6 text-slate-500" colSpan={5}>
                      No user workload found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Open tasks by status</h2>
          <div className="mt-4 space-y-3">
            {statusDistribution.length ? (
              statusDistribution.map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>{item.label}</span>
                    <span>{item.value}</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-slate-700"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No open tasks yet.</p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Open tasks by priority</h2>
          <div className="mt-4 space-y-3">
            {priorityDistribution.length ? (
              priorityDistribution.map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>{item.label}</span>
                    <span>{item.value}</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-slate-700"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No open tasks yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Projects at a glance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Project</th>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Open</th>
                <th className="px-6 py-3">Blocked</th>
                <th className="px-6 py-3">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {projectHealth.length ? (
                projectHealth.map((project) => (
                  <tr key={project.projectId} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      <Link
                        href={`/projects/${project.projectId}`}
                        className="hover:underline"
                      >
                        {project.projectName}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-600">{project.clientName}</td>
                    <td className="px-6 py-3 text-slate-600">{project.open}</td>
                    <td className="px-6 py-3 text-slate-600">{project.blocked}</td>
                    <td className="px-6 py-3 text-slate-600">{project.overdue}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
                    No project activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Recent activity</h2>
        <div className="mt-4 space-y-3">
          {recentActivity.length ? (
            recentActivity.map((activity) => (
              <div
                key={activity.item}
                className="flex flex-col gap-1 rounded-md border border-slate-200 px-4 py-3 text-sm"
              >
                <span className="font-medium text-slate-900">{activity.item}</span>
                <span className="text-xs text-slate-500">{activity.meta}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No recent activity yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
