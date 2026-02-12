import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import DashboardFilters from "./DashboardFilters";
import { parseCsvParam } from "@/lib/queryParams";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  formatTaskStatusLabel,
  normalizeTaskStatus,
} from "@/lib/taskStatus";

const taskStatuses = TASK_STATUS_OPTIONS;
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

const formatSuggestionStatusLabel = (status: string) =>
  status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export default async function DashboardPage(props: {
  searchParams?: Promise<{
    range?: string;
    client?: string | string[];
    project?: string | string[];
    user?: string | string[];
    status?: string | string[];
    priority?: string | string[];
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();

  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">Please sign in to view reporting.</p>
      </div>
    );
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  const currentUserId = currentUser?.id || null;
  const isAdmin = currentUser?.role === "admin";
  if (!currentUserId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">
          Create a user profile before viewing reporting.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const savedFilters = (() => {
    const raw = cookieStore.get("resopshub_dashboard_filters")?.value;
    if (!raw) return {};
    try {
      return JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  })();

  const getSaved = (key: string) => {
    const value = savedFilters[key];
    return typeof value === "string" ? value : undefined;
  };

  let selectedRange = (searchParams?.range ?? getSaved("range") ?? "all").trim();

  const getSavedList = (key: string) => parseCsvParam(savedFilters[key]);

  const selectedClientIds =
    searchParams?.client !== undefined
      ? parseCsvParam(searchParams.client)
      : getSavedList("client");

  const selectedProjectIds =
    searchParams?.project !== undefined
      ? parseCsvParam(searchParams.project)
      : getSavedList("project");

  const selectedUserIds =
    searchParams?.user !== undefined
      ? parseCsvParam(searchParams.user)
      : getSavedList("user");

  const selectedStatusesRaw =
    searchParams?.status !== undefined
      ? parseCsvParam(searchParams.status)
      : getSavedList("status");

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw);

  let selectedPriorities =
    searchParams?.priority !== undefined
      ? parseCsvParam(searchParams.priority)
      : getSavedList("priority");

  const allowedRangeValues = new Set<string>(
    rangeOptions.map((option) => option.value)
  );
  if (!allowedRangeValues.has(selectedRange)) {
    selectedRange = "all";
  }

  selectedPriorities = selectedPriorities.filter((priority) =>
    taskPriorities.includes(priority as (typeof taskPriorities)[number])
  );

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name,status,start_date")
    .order("name", { ascending: true });

  let visibleProjectIds: string[] = [];
  let watchedProjectIds: string[] = [];
  let explicitTaskIds: string[] = [];

  if (!isAdmin) {
    const [{ data: assignments }, { data: projectWatchers }] = await Promise.all([
      supabase
        .from("project_users")
        .select("project_id")
        .eq("user_id", currentUserId),
      supabase
        .from("project_watchers")
        .select("project_id")
        .eq("user_id", currentUserId),
    ]);

    watchedProjectIds = (projectWatchers || [])
      .map((row) => row.project_id)
      .filter(Boolean) as string[];

    const memberProjectIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];

    visibleProjectIds = Array.from(new Set([...memberProjectIds, ...watchedProjectIds]));

    const [{ data: taskAssignees }, { data: taskWatchers }] = await Promise.all([
      supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", currentUserId),
      supabase
        .from("task_watchers")
        .select("task_id")
        .eq("user_id", currentUserId),
    ]);

    explicitTaskIds = Array.from(
      new Set([
        ...(taskAssignees || []).map((row) => row.task_id).filter(Boolean),
        ...(taskWatchers || []).map((row) => row.task_id).filter(Boolean),
      ])
    ) as string[];
  }
  let projects: Array<{
    id: string;
    name: string;
    status: string | null;
    client_id: string | null;
    updated_at?: string | null;
  }> = [];

  if (isAdmin || visibleProjectIds.length) {
    let projectsQuery = supabase
      .from("projects")
      .select("id,name,status,client_id,updated_at")
      .order("name", { ascending: true });

    if (!isAdmin) {
      projectsQuery = projectsQuery.in("id", visibleProjectIds);
    }

    const { data: projectData } = await projectsQuery;
    projects = projectData || [];
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  let myTaskAssignments: Array<{ task_id: string | null }> = [];
  try {
    const { data } = await supabase
      .from("task_assignees")
      .select("task_id")
      .eq("user_id", currentUserId);
    myTaskAssignments = (data || []) as Array<{ task_id: string | null }>;
  } catch {
    myTaskAssignments = [];
  }

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const filteredClientIds = selectedClientIds.filter((id) => clientIdSet.has(id));

  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const filteredProjectIds = selectedProjectIds.filter((id) => projectIdSet.has(id));

  const userIdSet = new Set((users || []).map((user) => user.id));
  const filteredUserIds = selectedUserIds.filter((id) => userIdSet.has(id));

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

  let tasks: Array<{
    id: string;
    title: string;
    status: string | null;
    priority: string | null;
    due_date: string | null;
    assignee_user_id: string | null;
    project_id: string | null;
    client_id: string | null;
    created_at: string | null;
    projects?: { id?: string | null; name?: string | null; status?: string | null } | { id?: string | null; name?: string | null; status?: string | null }[] | null;
    clients?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null;
  }> = [];

  const canQueryTasks = true;

  if (canQueryTasks) {
    let tasksQuery = supabase
      .from("tasks")
      .select(
        "id,title,status,priority,due_date,assignee_user_id,project_id,client_id,created_at,projects(id,name,status),clients(id,name)"
      )
      .is("parent_task_id", null);

    if (filteredClientIds.length) {
      tasksQuery = tasksQuery.in("client_id", filteredClientIds);
    }

    if (filteredProjectIds.length) {
      tasksQuery = tasksQuery.in("project_id", filteredProjectIds);
    }

    if (filteredUserIds.length) {
      tasksQuery = tasksQuery.in("assignee_user_id", filteredUserIds);
    }

    if (selectedStatuses.length) {
      tasksQuery = tasksQuery.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
    }

    if (selectedPriorities.length) {
      tasksQuery = tasksQuery.in("priority", selectedPriorities);
    }

    if (rangeStart) {
      tasksQuery = tasksQuery.gte("created_at", rangeStart).lte("created_at", now.toISOString());
    }

    if (!isAdmin) {
      const orParts: string[] = [`assignee_user_id.eq.${currentUserId}`];

      if (explicitTaskIds.length) {
        orParts.push(`id.in.(${explicitTaskIds.join(",")})`);
      }

      // If a user watches a project, include its tasks in dashboard visibility.
      if (watchedProjectIds.length) {
        orParts.push(`project_id.in.(${watchedProjectIds.join(",")})`);
      }

      tasksQuery = tasksQuery.or(orParts.join(","));
    }

    const { data: taskData } = await tasksQuery;
    tasks = (taskData || []) as typeof tasks;
  }

  const openTasks = (tasks || []).filter(
    (task) => task.status !== "completed" && task.status !== "cancelled"
  );

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekIso = toIsoDate(nextWeek);

  const myTaskIdSet = new Set((myTaskAssignments || []).map((row) => row.task_id));
  const myOpenTasks = openTasks.filter(
    (task) => task.assignee_user_id === currentUserId || myTaskIdSet.has(task.id)
  );
  const myBlockedTasks = myOpenTasks.filter((task) => task.status === "blocked");
  const myOverdueTasks = myOpenTasks.filter(
    (task) => task.due_date && task.due_date < todayIso
  );
  const myDueSoonTasks = myOpenTasks.filter(
    (task) => task.due_date && task.due_date >= todayIso && task.due_date <= nextWeekIso
  );

  const blockedTasks = openTasks.filter((task) => task.status === "blocked");
  const overdueTasks = openTasks.filter(
    (task) => task.due_date && task.due_date < todayIso
  );
  const dueSoonTasks = openTasks.filter(
    (task) => task.due_date && task.due_date >= todayIso && task.due_date <= nextWeekIso
  );

  const filteredProjectsAllStatuses = (projects || []).filter((project) => {
    if (filteredClientIds.length && !filteredClientIds.includes(project.client_id || "")) {
      return false;
    }
    if (filteredProjectIds.length && !filteredProjectIds.includes(project.id)) {
      return false;
    }
    return true;
  });

  const projectStatusCounts = new Map<string, number>();
  filteredProjectsAllStatuses.forEach((project) => {
    const status = project.status || "planned";
    projectStatusCounts.set(status, (projectStatusCounts.get(status) || 0) + 1);
  });

  const plannedProjectsCount = projectStatusCounts.get("planned") || 0;
  const activeProjectsCount = projectStatusCounts.get("active") || 0;
  const onHoldProjectsCount = projectStatusCounts.get("on_hold") || 0;
  const completedProjectsCount = projectStatusCounts.get("completed") || 0;
  const cancelledProjectsCount = projectStatusCounts.get("cancelled") || 0;

  const activeProjects = filteredProjectsAllStatuses.filter((project) =>
    projectActiveStatuses.includes(project.status as (typeof projectActiveStatuses)[number])
  );

  const filteredProjects = activeProjects.filter((project) => {
    if (filteredClientIds.length && !filteredClientIds.includes(project.client_id || "")) {
      return false;
    }
    if (filteredProjectIds.length && !filteredProjectIds.includes(project.id)) {
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
    const clientName = getRelationName(task.clients, "Unknown");
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
    const status = normalizeTaskStatus(task.status) || "unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  });

  const allStatusCounts = new Map<string, number>();
  (tasks || []).forEach((task) => {
    const status = normalizeTaskStatus(task.status) || "unknown";
    allStatusCounts.set(status, (allStatusCounts.get(status) || 0) + 1);
  });

  const priorityCounts = new Map<string, number>();
  openTasks.forEach((task) => {
    const priority = task.priority || "unknown";
    priorityCounts.set(priority, (priorityCounts.get(priority) || 0) + 1);
  });

  const totalOpen = openTasks.length || 1;
  const statusDistribution = taskStatuses
    .map((status) => ({
      label: formatTaskStatusLabel(status),
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

  const totalAllTasks = (tasks || []).length || 1;
  const allStatusDistribution = taskStatuses
    .map((status) => ({
      label: formatTaskStatusLabel(status),
      value: allStatusCounts.get(status) || 0,
      percent: Math.round(((allStatusCounts.get(status) || 0) / totalAllTasks) * 100),
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
        projectName: getRelationName(task.projects, "Untitled project"),
        clientName: getRelationName(task.clients, "Unknown"),
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

  const projectIdsForCoverage = filteredProjectsAllStatuses.map((project) => project.id);
  let projectsWithoutAssignees = 0;
  let projectsWithoutWatchers = 0;
  if (projectIdsForCoverage.length) {
    try {
      const [{ data: projectAssignments }, { data: projectWatchers }] = await Promise.all([
        supabase
          .from("project_users")
          .select("project_id")
          .in("project_id", projectIdsForCoverage),
        supabase
          .from("project_watchers")
          .select("project_id")
          .in("project_id", projectIdsForCoverage),
      ]);

      const assignedProjectIdSet = new Set(
        (projectAssignments || []).map((row) => row.project_id).filter(Boolean)
      );
      const watchedProjectIdSet = new Set(
        (projectWatchers || []).map((row) => row.project_id).filter(Boolean)
      );

      projectsWithoutAssignees = projectIdsForCoverage.filter(
        (projectId) => !assignedProjectIdSet.has(projectId)
      ).length;
      projectsWithoutWatchers = projectIdsForCoverage.filter(
        (projectId) => !watchedProjectIdSet.has(projectId)
      ).length;
    } catch {
      projectsWithoutAssignees = 0;
      projectsWithoutWatchers = 0;
    }
  }

  let activityQuery = supabase
    .from("tasks")
    .select("id,title,created_at,project_id,client_id,projects(name),clients(name)")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(6);

  if (filteredClientIds.length) {
    activityQuery = activityQuery.in("client_id", filteredClientIds);
  }

  if (filteredProjectIds.length) {
    activityQuery = activityQuery.in("project_id", filteredProjectIds);
  }

  if (filteredUserIds.length) {
    activityQuery = activityQuery.in("assignee_user_id", filteredUserIds);
  }

  if (rangeStart) {
    activityQuery = activityQuery.gte("created_at", rangeStart).lte("created_at", now.toISOString());
  }

  if (!isAdmin) {
    const orParts: string[] = [`assignee_user_id.eq.${currentUserId}`];

    if (explicitTaskIds.length) {
      orParts.push(`id.in.(${explicitTaskIds.join(",")})`);
    }

    if (watchedProjectIds.length) {
      orParts.push(`project_id.in.(${watchedProjectIds.join(",")})`);
    }

    activityQuery = activityQuery.or(orParts.join(","));
  }

  const { data: recentTasks } = await activityQuery;

  const recentActivity = (recentTasks || []).map((task) => ({
  item: `Task created: ${task.title}`,
  meta: `${getRelationName(task.clients, "No client")} · ${
    task.created_at ? new Date(task.created_at).toLocaleDateString("en-US") : "-"
  }`,
}));

  const newTasksLabel =
    selectedRange === "all"
      ? "Total tasks"
      : `New tasks (${rangeOptions.find((option) => option.value === selectedRange)?.label ?? ""})`;

  const { data: suggestionRows } = await supabase
    .from("feature_suggestions")
    .select("id,title,status,created_at")
    .order("created_at", { ascending: false });

  const { data: suggestionVotes } = await supabase
    .from("feature_suggestion_votes")
    .select("suggestion_id");

  let unreadChatCount = 0;
  try {
    const { data: chatMembershipRows } = await supabase
      .from("chat_conversation_members")
      .select("conversation_id,last_read_at")
      .eq("user_id", currentUserId);

    unreadChatCount = chatMembershipRows?.length
      ? (
          await Promise.all(
            chatMembershipRows.map(async (membership) => {
              let query = supabase
                .from("chat_messages")
                .select("id", { count: "exact", head: true })
                .eq("conversation_id", membership.conversation_id)
                .neq("sender_id", currentUserId);
              if (membership.last_read_at) {
                query = query.gt("created_at", membership.last_read_at);
              }
              const { count } = await query;
              return count || 0;
            })
          )
        ).reduce((sum, value) => sum + value, 0)
      : 0;
  } catch {
    unreadChatCount = 0;
  }

  const suggestionVoteCounts = new Map<string, number>();
  (suggestionVotes || []).forEach((vote) => {
    suggestionVoteCounts.set(
      vote.suggestion_id,
      (suggestionVoteCounts.get(vote.suggestion_id) || 0) + 1
    );
  });

  const suggestionStatusCounts = new Map<string, number>();
  (suggestionRows || []).forEach((row) => {
    const status = row.status || "idea";
    suggestionStatusCounts.set(
      status,
      (suggestionStatusCounts.get(status) || 0) + 1
    );
  });

  const ideasCount = suggestionStatusCounts.get("idea") || 0;
  const needsCheckingCount = suggestionStatusCounts.get("needs_checking") || 0;
  const plannedCount = suggestionStatusCounts.get("planned") || 0;
  const completedCount = suggestionStatusCounts.get("completed") || 0;
  const rejectedCount = suggestionStatusCounts.get("rejected") || 0;

  const taskSnapshotCards = [
    { label: "Open tasks", value: openTasks.length.toString(), accent: "text-slate-900" },
    { label: "Blocked tasks", value: blockedTasks.length.toString(), accent: "text-amber-600" },
    { label: "Overdue tasks", value: overdueTasks.length.toString(), accent: "text-red-600" },
    { label: "Due in 7 days", value: dueSoonTasks.length.toString(), accent: "text-amber-700" },
    {
      label: newTasksLabel,
      value: (tasks || []).length.toString(),
      accent: "text-slate-900",
    },
  ];

  const projectSnapshotCards = [
    {
      label: "Planned projects",
      value: plannedProjectsCount.toString(),
      accent: "text-slate-900",
    },
    {
      label: "Active projects",
      value: activeProjectsCount.toString(),
      accent: "text-emerald-600",
    },
    {
      label: "On hold projects",
      value: onHoldProjectsCount.toString(),
      accent: "text-amber-700",
    },
    {
      label: "Completed projects",
      value: completedProjectsCount.toString(),
      accent: "text-slate-500",
    },
    {
      label: "Cancelled projects",
      value: cancelledProjectsCount.toString(),
      accent: "text-rose-500",
    },
  ];

  const featureSnapshotCards = [
    {
      label: "Ideas",
      value: ideasCount.toString(),
      accent: "text-slate-900",
    },
    {
      label: "Needs checking",
      value: needsCheckingCount.toString(),
      accent: "text-slate-900",
    },
    {
      label: "Planned",
      value: plannedCount.toString(),
      accent: "text-slate-900",
    },
    {
      label: "Completed",
      value: completedCount.toString(),
      accent: "text-slate-500",
    },
    {
      label: "Rejected",
      value: rejectedCount.toString(),
      accent: "text-rose-500",
    },
  ];

  const topSuggestions = (suggestionRows || [])
    .map((row) => ({
      ...row,
      votes: suggestionVoteCounts.get(row.id) || 0,
    }))
    .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  const clientStatusCounts = new Map<string, number>();
  (clients || []).forEach((client) => {
    const status = client.status || "prospect";
    clientStatusCounts.set(status, (clientStatusCounts.get(status) || 0) + 1);
  });
  const clientsMissingStartDate = (clients || []).filter(
    (client) => !client.start_date
  ).length;

  const openSuggestionStatuses = new Set(["idea", "needs_checking", "planned"]);
  const topOpenSuggestion = (suggestionRows || [])
    .map((row) => ({
      ...row,
      votes: suggestionVoteCounts.get(row.id) || 0,
    }))
    .filter((row) => openSuggestionStatuses.has(row.status || "idea"))
    .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1))[0];

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
        <DashboardFilters
          rangeOptions={rangeOptions}
          clients={clients || []}
          projects={projects || []}
          users={users || []}
          statusOptions={taskStatuses}
          priorityOptions={taskPriorities}
          initialFilters={{
            range: selectedRange,
            client: filteredClientIds,
            project: filteredProjectIds,
            user: filteredUserIds,
            status: selectedStatuses,
            priority: selectedPriorities,
          }}
        />
      </section>

      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Tasks
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {taskSnapshotCards.map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {card.label}
                </p>
                <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Projects
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {projectSnapshotCards.map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {card.label}
                </p>
                <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Feature Requests
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {featureSnapshotCards.map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {card.label}
                </p>
                <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>
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

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">All tasks by status</h2>
          <div className="mt-4 space-y-3">
            {allStatusDistribution.length ? (
              allStatusDistribution.map((item) => (
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
              <p className="text-sm text-slate-500">No tasks yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Feature suggestions</h2>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
              Idea: {ideasCount}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
              Needs checking: {needsCheckingCount}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
              Planned: {plannedCount}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
              Completed: {completedCount}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
              Rejected: {rejectedCount}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {topSuggestions.length ? (
              topSuggestions.map((idea) => (
                <div
                  key={idea.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">{idea.title}</p>
                    <p className="text-xs text-slate-500">
                      {formatSuggestionStatusLabel(idea.status || "idea")}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {idea.votes} vote{idea.votes === 1 ? "" : "s"}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No suggestions yet.</p>
            )}
          </div>
          <div className="mt-4">
            <Link
              href="/feature-suggestions"
              className="text-sm font-semibold text-slate-700 hover:underline"
            >
              View all suggestions
            </Link>
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
