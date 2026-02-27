import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import DashboardFilters from "./DashboardFilters";
import DashboardCurrencySelect from "./DashboardCurrencySelect";
import DashboardSnapshotCard from "./DashboardSnapshotCard";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { withPerfTiming } from "@/lib/perf";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  formatTaskStatusLabel,
  normalizeTaskStatus,
} from "@/lib/taskStatus";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  buildEmployeeInfoExchangeRateMap,
  convertEmployeeInfoCurrencyAmount,
  formatEmployeeInfoCurrencyAmount,
  normalizeEmployeeInfoCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";
import {
  computeClientBillingSnapshot,
  convertSnapshotAmountsToCurrency,
  hasStringId as hasBillingStringId,
  type BillingProfileRevenueRow,
  type EmployeeInfoColumnRow,
  type EmployeeInfoRecordRow,
  type EmployeeInfoValueRow,
} from "@/lib/billing/billingSnapshot";
import { DASHBOARD_DEFAULT_CURRENCY, normalizeDashboardCurrency } from "./filterState";
import type {
  DashboardFiltersState,
  DashboardFocusKey,
  DashboardSnapshotCard as DashboardSnapshotCardData,
} from "./types";

type DashboardViewKey =
  | "overview"
  | "finance"
  | "delivery"
  | "workload"
  | "requests"
  | "activity";

const taskStatuses = TASK_STATUS_OPTIONS;
const taskPriorities = ["low", "medium", "high", "critical"] as const;
const projectActiveStatuses = ["planned", "active", "on_hold"] as const;
const rangeOptions = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;
const dashboardFocusKeys = new Set<DashboardFocusKey>([
  "finance",
  "people",
  "task_delivery",
  "feature_requests",
  "work_by_client",
  "work_by_user",
  "projects_glance",
  "recent_activity",
]);
const dashboardViewKeys = new Set<DashboardViewKey>([
  "overview",
  "finance",
  "delivery",
  "workload",
  "requests",
  "activity",
]);
const dashboardViews: Array<{ key: DashboardViewKey; label: string; description: string }> = [
  { key: "overview", label: "Overview", description: "Top KPIs across the workspace" },
  { key: "finance", label: "Finance", description: "Revenue, costs, and margin" },
  { key: "delivery", label: "Delivery", description: "Tasks, projects, and execution health" },
  { key: "workload", label: "Workload", description: "Client and team capacity" },
  { key: "requests", label: "Requests", description: "Feature demand and status" },
  { key: "activity", label: "Activity", description: "Recent movement and updates" },
];

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const formatSuggestionStatusLabel = (status: string) =>
  status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDashboardViewKey(value: string | undefined): DashboardViewKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return dashboardViewKeys.has(normalized as DashboardViewKey)
    ? (normalized as DashboardViewKey)
    : "overview";
}

function isLeaveDateColumn(column: { key: string; label: string; column_kind: string }) {
  if (column.column_kind !== "date") return false;
  const keyToken = normalizeToken(column.key);
  const labelToken = normalizeToken(column.label);
  const hasLeaveDateWords = (token: string) => token.includes("leave") && token.includes("date");
  return (
    keyToken === "leave_date" ||
    labelToken === "leave_date" ||
    hasLeaveDateWords(keyToken) ||
    hasLeaveDateWords(labelToken)
  );
}

export default async function DashboardPage(props: {
  searchParams?: Promise<{
    range?: string;
    client?: string | string[];
    project?: string | string[];
    user?: string | string[];
    status?: string | string[];
    priority?: string | string[];
    currency?: string;
    focus?: string;
    view?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const selectedFocusRaw = String(searchParams?.focus || "").trim();
  const selectedFocus = dashboardFocusKeys.has(selectedFocusRaw as DashboardFocusKey)
    ? (selectedFocusRaw as DashboardFocusKey)
    : null;
  const selectedView = normalizeDashboardViewKey(searchParams?.view);
  const supabase = createSupabaseServerClient();

  const { data: authData } = await withPerfTiming("dashboard.auth", () =>
    supabase.auth.getUser()
  );
  const authEmail = authData.user?.email;
  if (!authEmail) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">Please sign in to view reporting.</p>
      </div>
    );
  }

  const { data: currentUser } = await withPerfTiming("dashboard.current_user", () =>
    supabase.from("users").select("id,role").eq("email", authEmail).maybeSingle()
  );

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
  const selectedCurrency = normalizeDashboardCurrency(
    searchParams?.currency ?? getSaved("currency") ?? DASHBOARD_DEFAULT_CURRENCY
  );

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

  const [{ data: clients }, { data: users }] = await Promise.all([
    withPerfTiming("dashboard.clients", () =>
      supabase
        .from("clients")
        .select("id,name,status,start_date")
        .order("name", { ascending: true })
    ),
    withPerfTiming("dashboard.users", () =>
      supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true })
    ),
  ]);

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

  const clientIdSet = new Set((clients || []).map((client) => client.id));
  const filteredClientIds = selectedClientIds.filter((id) => clientIdSet.has(id));

  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const filteredProjectIds = selectedProjectIds.filter((id) => projectIdSet.has(id));

  const userIdSet = new Set((users || []).map((user) => user.id));
  const filteredUserIds = selectedUserIds.filter((id) => userIdSet.has(id));
  const clientNameById = (clients || []).reduce<Record<string, string>>((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {});
  const projectNameById = (projects || []).reduce<Record<string, string>>((acc, project) => {
    acc[project.id] = project.name;
    return acc;
  }, {});
  const projectClientByProjectId = new Map(
    (projects || []).map((project) => [project.id, String(project.client_id || "").trim()])
  );

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
    title: string;
    status: string | null;
    priority: string | null;
    due_date: string | null;
    assignee_user_id: string | null;
    project_id: string | null;
    client_id: string | null;
    created_at: string | null;
  }> = [];

  let tasksQuery = supabase
    .from("tasks")
    .select("title,status,priority,due_date,assignee_user_id,project_id,client_id,created_at")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

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

  const { data: taskData } = await withPerfTiming("dashboard.tasks", () => tasksQuery);
  tasks = (taskData || []) as typeof tasks;

  const openTasks = (tasks || []).filter(
    (task) => task.status !== "completed" && task.status !== "cancelled"
  );

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekIso = toIsoDate(nextWeek);

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
    const clientName = clientId ? clientNameById[clientId] || "Unknown" : "Unknown";
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
  const userNameById = new Map<string, string>();
  (users || []).forEach((user) => {
    userNameById.set(user.id, user.full_name || user.email || "Unknown");
  });
  const projectIdsByUserId = new Map<string, Set<string>>();

  openTasks.forEach((task) => {
    const userId = task.assignee_user_id || "unassigned";
    const userName = task.assignee_user_id
      ? userNameById.get(task.assignee_user_id) || "Unknown"
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
    if (task.project_id) {
      if (!projectIdsByUserId.has(userId)) {
        projectIdsByUserId.set(userId, new Set<string>());
      }
      projectIdsByUserId.get(userId)?.add(task.project_id);
    }
  });

  userWorkloadMap.forEach((entry, key) => {
    entry.projects = projectIdsByUserId.get(key)?.size || 0;
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
        projectName: projectNameById[task.project_id] || "Untitled project",
        clientName:
          (task.client_id ? clientNameById[task.client_id] : null) ||
          clientNameById[projectClientByProjectId.get(task.project_id) || ""] ||
          "Unknown",
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

  const recentActivity = (tasks || []).slice(0, 6).map((task) => ({
    item: `Task created: ${task.title}`,
    meta: `${task.client_id ? clientNameById[task.client_id] || "No client" : "No client"} - ${
      task.created_at ? new Date(task.created_at).toLocaleDateString("en-US") : "-"
    }`,
  }));

  const allVisibleClientIds = (clients || [])
    .map((client) => String(client.id || "").trim())
    .filter(Boolean);
  const hasClientScopeFilter = filteredClientIds.length > 0;
  const hasProjectScopeFilter = filteredProjectIds.length > 0;
  const hasTaskMetaScopeFilter =
    filteredUserIds.length > 0 || selectedStatuses.length > 0 || selectedPriorities.length > 0;
  const projectScopedClientIds = Array.from(
    new Set(
      filteredProjectIds
        .map((projectId) => projectClientByProjectId.get(projectId) || "")
        .filter(Boolean)
    )
  );
  const scopedClientIdsFromLoadedTasks = Array.from(
    new Set(
      (tasks || [])
        .map((row) => String(row.client_id || "").trim())
        .filter(Boolean)
    )
  );

  let scopedClientIds: string[] = [];
  if (!hasClientScopeFilter && !hasProjectScopeFilter && !hasTaskMetaScopeFilter) {
    scopedClientIds = allVisibleClientIds;
  } else if (hasClientScopeFilter && !hasProjectScopeFilter && !hasTaskMetaScopeFilter) {
    scopedClientIds = filteredClientIds;
  } else if (!hasClientScopeFilter && hasProjectScopeFilter && !hasTaskMetaScopeFilter) {
    scopedClientIds = projectScopedClientIds;
  } else if (!rangeStart) {
    // Reuse the already-loaded task result set when range is "all" to avoid an extra scan.
    scopedClientIds = scopedClientIdsFromLoadedTasks;
  } else {
    let scopedTasksQuery = supabase
      .from("tasks")
      .select("client_id")
      .is("parent_task_id", null);

    if (filteredClientIds.length) {
      scopedTasksQuery = scopedTasksQuery.in("client_id", filteredClientIds);
    }

    if (filteredProjectIds.length) {
      scopedTasksQuery = scopedTasksQuery.in("project_id", filteredProjectIds);
    }

    if (filteredUserIds.length) {
      scopedTasksQuery = scopedTasksQuery.in("assignee_user_id", filteredUserIds);
    }

    if (selectedStatuses.length) {
      scopedTasksQuery = scopedTasksQuery.in(
        "status",
        expandTaskStatusFilterForQuery(selectedStatuses)
      );
    }

    if (selectedPriorities.length) {
      scopedTasksQuery = scopedTasksQuery.in("priority", selectedPriorities);
    }

    if (!isAdmin) {
      const scopedOrParts: string[] = [`assignee_user_id.eq.${currentUserId}`];

      if (explicitTaskIds.length) {
        scopedOrParts.push(`id.in.(${explicitTaskIds.join(",")})`);
      }

      if (watchedProjectIds.length) {
        scopedOrParts.push(`project_id.in.(${watchedProjectIds.join(",")})`);
      }

      scopedTasksQuery = scopedTasksQuery.or(scopedOrParts.join(","));
    }

    const { data: scopedTasksRaw } = await withPerfTiming(
      "dashboard.scoped_tasks",
      () => scopedTasksQuery
    );
    scopedClientIds = Array.from(
      new Set(
        ((scopedTasksRaw || []) as Array<{ client_id: string | null }>)
          .map((row) => String(row.client_id || "").trim())
          .filter(Boolean)
      )
    );
  }

  const financeWarnings: string[] = [];
  let financeRoleCostRows: Array<{ roleLabel: string; totalCost: number; employeeCount: number }> = [];
  let financeSummary = {
    currencyCode: selectedCurrency,
    revenueTotal: 0,
    costTotal: 0,
    marginTotal: 0,
    marginPercent: null as number | null,
    scopedClientCount: scopedClientIds.length,
    activeEmployeeCount: 0,
    risks: {
      negativeMarginClients: 0,
      missingBillingProfiles: 0,
    },
    isEmptyScope: scopedClientIds.length === 0,
  };

  if (scopedClientIds.length) {
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    let billingRows: Array<BillingProfileRevenueRow & { client_id: string }> = [];
    const [
      billingResultBase,
      employeeRecordsResult,
      employeeColumnsResultBase,
      exchangeRatesResult,
    ] = await Promise.all([
      supabase
        .from("billing_profiles")
        .select(
          "client_id,currency,hourly_rate,total_billable_hours,revenue_charge_items,monthly_cost_items"
        )
        .in("client_id", scopedClientIds),
      supabase
        .from("employee_info_records")
        .select("id,full_name,client_id")
        .in("client_id", scopedClientIds),
      supabase
        .from("employee_info_columns")
        .select(
          "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
        )
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("employee_info_exchange_rates")
        .select("base_currency_code,quote_currency_code,rate,effective_month_start")
        .order("effective_month_start", { ascending: false }),
    ]);

    let billingResult = billingResultBase as unknown as {
      data: Array<Record<string, unknown>> | null;
      error: { message?: string; code?: string } | null;
    };

    if (isSupabaseMissingColumnError(billingResult.error)) {
      const fallbackWithCharges = await supabase
        .from("billing_profiles")
        .select("client_id,currency,hourly_rate,total_billable_hours,revenue_charge_items")
        .in("client_id", scopedClientIds);
      if (isSupabaseMissingColumnError(fallbackWithCharges.error)) {
        const fallbackMinimal = await supabase
          .from("billing_profiles")
          .select("client_id,currency,hourly_rate,total_billable_hours")
          .in("client_id", scopedClientIds);
        billingResult = {
          data: (fallbackMinimal.data || []).map((row) => ({
            ...row,
            revenue_charge_items: [],
            monthly_cost_items: [],
          })),
          error: fallbackMinimal.error,
        };
      } else {
        billingResult = {
          data: (fallbackWithCharges.data || []).map((row) => ({
            ...row,
            monthly_cost_items: [],
          })),
          error: fallbackWithCharges.error,
        };
      }
    }

    if (isSupabaseMissingTableError(billingResult.error)) {
      financeWarnings.push("Billing profiles table is missing.");
      billingRows = [];
    } else if (billingResult.error) {
      financeWarnings.push(`Could not load billing profiles (${billingResult.error.message}).`);
      billingRows = [];
    } else {
      billingRows = ((billingResult.data || []) as Array<BillingProfileRevenueRow & { client_id: string }>).filter(
        (row) => !!row.client_id
      );
    }

    let employeeRecords: EmployeeInfoRecordRow[] = [];
    if (isSupabaseMissingTableError(employeeRecordsResult.error)) {
      financeWarnings.push("Employee Info is not set up yet.");
    } else if (employeeRecordsResult.error) {
      financeWarnings.push(`Could not load Employee Info records (${employeeRecordsResult.error.message}).`);
    } else {
      employeeRecords = ((employeeRecordsResult.data || []) as EmployeeInfoRecordRow[]).filter((row) =>
        hasBillingStringId(row)
      );
    }

    let employeeColumns: EmployeeInfoColumnRow[] = [];
    let employeeColumnsResult = employeeColumnsResultBase as unknown as {
      data: Array<Record<string, unknown>> | null;
      error: { message?: string; code?: string } | null;
    };
    if (isSupabaseMissingColumnError(employeeColumnsResult.error)) {
      const fallbackColumns = await supabase
        .from("employee_info_columns")
        .select("id,key,label,column_kind,formula,options_json,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      employeeColumnsResult = {
        data: (fallbackColumns.data || []).map((column) => ({
          ...column,
          formula_currency_mode: "display",
          formula_currency_code: "USD",
        })),
        error: fallbackColumns.error,
      };
    }
    if (isSupabaseMissingTableError(employeeColumnsResult.error)) {
      financeWarnings.push("Employee Info columns table is missing.");
    } else if (employeeColumnsResult.error) {
      financeWarnings.push(`Could not load Employee Info columns (${employeeColumnsResult.error.message}).`);
    } else {
      employeeColumns = ((employeeColumnsResult.data || []) as EmployeeInfoColumnRow[]).filter((row) =>
        hasBillingStringId(row)
      );
    }

    let employeeValues: EmployeeInfoValueRow[] = [];
    const employeeRecordIds = employeeRecords.map((row) => row.id).filter(Boolean);
    if (employeeRecordIds.length) {
      let employeeValuesResult = (await supabase
        .from("employee_info_values")
        .select("record_id,column_id,text_value,option_value,money_currency_code")
        .in("record_id", employeeRecordIds)) as unknown as {
        data: Array<Record<string, unknown>> | null;
        error: { message?: string; code?: string } | null;
      };
      if (isSupabaseMissingColumnError(employeeValuesResult.error)) {
        const fallbackValues = await supabase
          .from("employee_info_values")
          .select("record_id,column_id,text_value,option_value")
          .in("record_id", employeeRecordIds);
        employeeValuesResult = {
          data: (fallbackValues.data || []).map((row) => ({
            ...row,
            money_currency_code: null,
          })),
          error: fallbackValues.error,
        };
      }
      if (employeeValuesResult.error && !isSupabaseMissingTableError(employeeValuesResult.error)) {
        financeWarnings.push(`Could not load Employee Info values (${employeeValuesResult.error.message}).`);
      } else {
        employeeValues = (employeeValuesResult.data || []) as EmployeeInfoValueRow[];
      }
    }

    const leaveDateColumnIds = new Set(
      employeeColumns.filter((column) => isLeaveDateColumn(column)).map((column) => column.id)
    );

    if (employeeRecords.length && employeeValues.length && leaveDateColumnIds.size) {
      const inactiveRecordIdSet = new Set<string>();
      employeeValues.forEach((valueRow) => {
        if (!leaveDateColumnIds.has(valueRow.column_id)) return;
        const leaveDateValue = String(valueRow.text_value || valueRow.option_value || "").trim();
        if (leaveDateValue) {
          inactiveRecordIdSet.add(valueRow.record_id);
        }
      });
      if (inactiveRecordIdSet.size) {
        employeeRecords = employeeRecords.filter((record) => !inactiveRecordIdSet.has(record.id));
        const activeRecordIdSet = new Set(employeeRecords.map((row) => row.id));
        employeeValues = employeeValues.filter((valueRow) => activeRecordIdSet.has(valueRow.record_id));
      }
    }

    let exchangeRateRows: EmployeeInfoExchangeRateRow[] = [];
    if (exchangeRatesResult.error && !isSupabaseMissingTableError(exchangeRatesResult.error)) {
      financeWarnings.push(`Could not load Employee Info FX rates (${exchangeRatesResult.error.message}).`);
    } else {
      exchangeRateRows = (exchangeRatesResult.data || []) as EmployeeInfoExchangeRateRow[];
    }

    const billingByClientId = new Map<string, BillingProfileRevenueRow>();
    billingRows.forEach((row) => {
      if (!billingByClientId.has(row.client_id)) {
        billingByClientId.set(row.client_id, row);
      }
    });

    const targetCurrencyCode = normalizeEmployeeInfoCurrencyCode(selectedCurrency);
    const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, monthStart);
    const employeeRecordsByClientId = new Map<string, EmployeeInfoRecordRow[]>();
    const recordClientByRecordId = new Map<string, string>();
    employeeRecords.forEach((record) => {
      const clientId = String(record.client_id || "").trim();
      if (!clientId) {
        return;
      }
      if (!employeeRecordsByClientId.has(clientId)) {
        employeeRecordsByClientId.set(clientId, []);
      }
      employeeRecordsByClientId.get(clientId)?.push(record);
      recordClientByRecordId.set(record.id, clientId);
    });

    const employeeValuesByClientId = new Map<string, EmployeeInfoValueRow[]>();
    employeeValues.forEach((valueRow) => {
      const clientId = recordClientByRecordId.get(valueRow.record_id);
      if (!clientId) {
        return;
      }
      if (!employeeValuesByClientId.has(clientId)) {
        employeeValuesByClientId.set(clientId, []);
      }
      employeeValuesByClientId.get(clientId)?.push(valueRow);
    });

    const roleCostTotals = new Map<string, { roleLabel: string; totalCost: number; employeeCount: number }>();
    let revenueTotal = 0;
    let costTotal = 0;
    let marginTotal = 0;
    let negativeMarginClients = 0;
    let missingBillingProfiles = 0;

    scopedClientIds.forEach((clientId) => {
      const profile = billingByClientId.get(clientId) || null;
      if (!profile) {
        missingBillingProfiles += 1;
      }
      const clientRecords = employeeRecordsByClientId.get(clientId) || [];
      const clientValues = employeeValuesByClientId.get(clientId) || [];

      const snapshot = computeClientBillingSnapshot({
        clientId,
        clientName: clientNameById[clientId] || "Unknown",
        billingProfile: profile,
        employeeRecords: clientRecords,
        employeeColumns,
        employeeValues: clientValues,
        exchangeRateRows,
        monthStart,
      });
      const converted = convertSnapshotAmountsToCurrency({
        snapshot,
        targetCurrencyCode,
        exchangeRateRows,
        monthStart,
      });
      revenueTotal += converted.estimatedMonthlyRevenue;
      costTotal += converted.employeeMonthlyCosts;
      marginTotal += converted.estimatedMonthlyMargin;
      if (snapshot.estimatedMonthlyMargin < 0) {
        negativeMarginClients += 1;
      }
      snapshot.employeeMonthlyCostSummary.breakdownRows.forEach((row) => {
        let roleCostInTargetCurrency = row.totalAmount;
        if (snapshot.billingCurrencyCode !== targetCurrencyCode) {
          const convertedRoleCost = convertEmployeeInfoCurrencyAmount({
            amount: row.totalAmount,
            fromCurrencyCode: snapshot.billingCurrencyCode,
            toCurrencyCode: targetCurrencyCode,
            exchangeRateMap,
          });
          if (convertedRoleCost === null) {
            return;
          }
          roleCostInTargetCurrency = convertedRoleCost;
        }
        const roleLabel = row.roleLabel || "Unspecified role";
        const currentRoleTotals = roleCostTotals.get(roleLabel) || {
          roleLabel,
          totalCost: 0,
          employeeCount: 0,
        };
        currentRoleTotals.totalCost += roleCostInTargetCurrency;
        currentRoleTotals.employeeCount += row.employeeCount;
        roleCostTotals.set(roleLabel, currentRoleTotals);
      });
    });
    const activeEmployeeCount = employeeRecords.length;
    financeRoleCostRows = Array.from(roleCostTotals.values())
      .sort((left, right) => {
        if (right.totalCost !== left.totalCost) {
          return right.totalCost - left.totalCost;
        }
        if (right.employeeCount !== left.employeeCount) {
          return right.employeeCount - left.employeeCount;
        }
        return left.roleLabel.localeCompare(right.roleLabel);
      })
      .slice(0, 3);

    financeSummary = {
      currencyCode: selectedCurrency,
      revenueTotal,
      costTotal,
      marginTotal,
      marginPercent: revenueTotal > 0 ? (marginTotal / revenueTotal) * 100 : null,
      scopedClientCount: scopedClientIds.length,
      activeEmployeeCount,
      risks: {
        negativeMarginClients,
        missingBillingProfiles,
      },
      isEmptyScope: false,
    };
  }

  const newTasksLabel =
    selectedRange === "all"
      ? "Total tasks"
      : `New tasks (${rangeOptions.find((option) => option.value === selectedRange)?.label ?? ""})`;

  const [{ data: suggestionRows }, { data: suggestionVotes }] = await Promise.all([
    supabase
      .from("feature_suggestions")
      .select("id,title,status,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("feature_suggestion_votes")
      .select("suggestion_id"),
  ]);

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

  const filtersForQuery: DashboardFiltersState = {
    range: selectedRange,
    client: filteredClientIds,
    project: filteredProjectIds,
    user: filteredUserIds,
    status: selectedStatuses,
    priority: selectedPriorities,
    currency: selectedCurrency,
  };
  const dashboardQueryParams = new URLSearchParams();
  if (filtersForQuery.range && filtersForQuery.range !== "all") {
    dashboardQueryParams.set("range", filtersForQuery.range);
  }
  if (filtersForQuery.client.length) {
    dashboardQueryParams.set("client", filtersForQuery.client.join(","));
  }
  if (filtersForQuery.project.length) {
    dashboardQueryParams.set("project", filtersForQuery.project.join(","));
  }
  if (filtersForQuery.user.length) {
    dashboardQueryParams.set("user", filtersForQuery.user.join(","));
  }
  if (filtersForQuery.status.length) {
    dashboardQueryParams.set("status", filtersForQuery.status.join(","));
  }
  if (filtersForQuery.priority.length) {
    dashboardQueryParams.set("priority", filtersForQuery.priority.join(","));
  }
  if (filtersForQuery.currency !== DASHBOARD_DEFAULT_CURRENCY) {
    dashboardQueryParams.set("currency", filtersForQuery.currency);
  }

  const focusViewMap: Record<DashboardFocusKey, DashboardViewKey> = {
    finance: "finance",
    people: "finance",
    task_delivery: "delivery",
    feature_requests: "requests",
    work_by_client: "workload",
    work_by_user: "workload",
    projects_glance: "activity",
    recent_activity: "activity",
  };

  const buildDashboardViewHref = (
    viewKey: DashboardViewKey,
    focusKey?: DashboardFocusKey | null
  ) => {
    const params = new URLSearchParams(dashboardQueryParams.toString());
    if (viewKey !== "overview") {
      params.set("view", viewKey);
    }
    if (focusKey) {
      params.set("focus", focusKey);
    } else {
      params.delete("focus");
    }
    const query = params.toString();
    return query ? `/dashboard?${query}` : "/dashboard";
  };

  const buildDashboardSelfHref = (focusKey: DashboardFocusKey) => {
    return buildDashboardViewHref(focusViewMap[focusKey], focusKey);
  };

  const buildTasksHref = (options?: {
    status?: string[];
    due?: "overdue" | "next_7";
  }) => {
    const params = new URLSearchParams();
    setCsvParam(params, "client", filteredClientIds);
    setCsvParam(params, "project", filteredProjectIds);
    setCsvParam(params, "assignee", filteredUserIds);
    setCsvParam(params, "priority", selectedPriorities);
    setCsvParam(params, "status", options?.status || selectedStatuses);
    if (options?.due) {
      params.set("due", options.due);
    }
    const query = params.toString();
    return query ? `/tasks?${query}` : "/tasks";
  };

  const buildProjectsHref = (options?: { status?: string[] }) => {
    const params = new URLSearchParams();
    setCsvParam(params, "client", filteredClientIds);
    setCsvParam(params, "assignee", filteredUserIds);
    setCsvParam(params, "status", options?.status || []);
    const query = params.toString();
    return query ? `/projects?${query}` : "/projects";
  };

  const buildFeatureSuggestionsHref = (status?: string) => {
    const params = new URLSearchParams();
    if (status) {
      params.set("status", status);
      if (status === "completed" || status === "rejected") {
        params.set("hide", "0");
      }
    }
    const query = params.toString();
    return query ? `/feature-suggestions?${query}` : "/feature-suggestions";
  };

  const taskSnapshotCards: DashboardSnapshotCardData[] = [
    {
      key: "open_tasks",
      label: "Open tasks",
      value: openTasks.length.toString(),
      accent: "text-slate-900",
      href: buildTasksHref(),
    },
    {
      key: "blocked_tasks",
      label: "Blocked tasks",
      value: blockedTasks.length.toString(),
      accent: "text-amber-600",
      href: buildTasksHref({ status: ["blocked"] }),
    },
    {
      key: "overdue_tasks",
      label: "Overdue tasks",
      value: overdueTasks.length.toString(),
      accent: "text-red-600",
      href: buildTasksHref({ due: "overdue" }),
    },
    {
      key: "due_7_days",
      label: "Due in 7 days",
      value: dueSoonTasks.length.toString(),
      accent: "text-amber-700",
      href: buildTasksHref({ due: "next_7" }),
    },
    {
      key: "task_range_total",
      label: newTasksLabel,
      value: (tasks || []).length.toString(),
      accent: "text-slate-900",
      href: buildTasksHref(),
    },
  ];

  const projectSnapshotCards: DashboardSnapshotCardData[] = [
    {
      key: "planned_projects",
      label: "Planned projects",
      value: plannedProjectsCount.toString(),
      accent: "text-slate-900",
      href: buildProjectsHref({ status: ["planned"] }),
    },
    {
      key: "active_projects",
      label: "Active projects",
      value: activeProjectsCount.toString(),
      accent: "text-emerald-600",
      href: buildProjectsHref({ status: ["active"] }),
    },
    {
      key: "hold_projects",
      label: "On hold projects",
      value: onHoldProjectsCount.toString(),
      accent: "text-amber-700",
      href: buildProjectsHref({ status: ["on_hold"] }),
    },
    {
      key: "completed_projects",
      label: "Completed projects",
      value: completedProjectsCount.toString(),
      accent: "text-slate-500",
      href: buildProjectsHref({ status: ["completed"] }),
    },
    {
      key: "cancelled_projects",
      label: "Cancelled projects",
      value: cancelledProjectsCount.toString(),
      accent: "text-rose-500",
      href: buildProjectsHref({ status: ["cancelled"] }),
    },
  ];

  const featureSnapshotCards: DashboardSnapshotCardData[] = [
    {
      key: "ideas",
      label: "Ideas",
      value: ideasCount.toString(),
      accent: "text-slate-900",
      href: buildFeatureSuggestionsHref("idea"),
    },
    {
      key: "needs_checking",
      label: "Needs checking",
      value: needsCheckingCount.toString(),
      accent: "text-slate-900",
      href: buildFeatureSuggestionsHref("needs_checking"),
    },
    {
      key: "planned",
      label: "Planned",
      value: plannedCount.toString(),
      accent: "text-slate-900",
      href: buildFeatureSuggestionsHref("planned"),
    },
    {
      key: "completed",
      label: "Completed",
      value: completedCount.toString(),
      accent: "text-slate-500",
      href: buildFeatureSuggestionsHref("completed"),
    },
    {
      key: "rejected",
      label: "Rejected",
      value: rejectedCount.toString(),
      accent: "text-rose-500",
      href: buildFeatureSuggestionsHref("rejected"),
    },
  ];

  const financePeopleSnapshotCards: DashboardSnapshotCardData[] = [
    {
      key: "finance_revenue",
      label: "Estimated monthly revenue",
      value: formatEmployeeInfoCurrencyAmount(financeSummary.revenueTotal, financeSummary.currencyCode),
      accent: "text-slate-900",
      helper: financeSummary.isEmptyScope ? "No scoped clients from current filters" : "",
      href: buildDashboardSelfHref("finance"),
      focus: "finance",
    },
    {
      key: "finance_cost",
      label: "Employee monthly costs",
      value: formatEmployeeInfoCurrencyAmount(financeSummary.costTotal, financeSummary.currencyCode),
      accent: "text-slate-900",
      href: buildDashboardSelfHref("finance"),
      focus: "finance",
    },
    {
      key: "finance_margin",
      label: "Estimated gross margin",
      value: formatEmployeeInfoCurrencyAmount(financeSummary.marginTotal, financeSummary.currencyCode),
      accent: financeSummary.marginTotal < 0 ? "text-red-700" : "text-slate-900",
      helper:
        financeSummary.marginPercent === null
          ? "-"
          : `${financeSummary.marginPercent.toFixed(1).replace(/\.0$/, "")}%`,
      href: buildDashboardSelfHref("finance"),
      focus: "finance",
    },
    {
      key: "people_active",
      label: "Employees in scope",
      value: String(financeSummary.activeEmployeeCount),
      accent: "text-slate-900",
      href: buildDashboardSelfHref("people"),
      focus: "people",
    },
    {
      key: "risk_negative",
      label: "Negative-margin clients",
      value: String(financeSummary.risks.negativeMarginClients),
      accent: financeSummary.risks.negativeMarginClients > 0 ? "text-red-700" : "text-slate-900",
      href: buildDashboardSelfHref("finance"),
      focus: "finance",
    },
    {
      key: "risk_profiles",
      label: "Missing billing profiles",
      value: String(financeSummary.risks.missingBillingProfiles),
      accent: financeSummary.risks.missingBillingProfiles > 0 ? "text-amber-700" : "text-slate-900",
      href: buildDashboardSelfHref("finance"),
      focus: "finance",
    },
  ];

  const topSuggestions = (suggestionRows || [])
    .map((row) => ({
      ...row,
      votes: suggestionVoteCounts.get(row.id) || 0,
    }))
    .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  const sectionFocusClass = (key: DashboardFocusKey) =>
    selectedFocus === key ? "rounded-xl ring-2 ring-emerald-200 ring-offset-2 ring-offset-slate-50" : "";

  const activeView = dashboardViews.find((view) => view.key === selectedView) || dashboardViews[0];
  const isOverviewView = selectedView === "overview";
  const showFinanceSection = isOverviewView || selectedView === "finance";
  const showDeliverySection = isOverviewView || selectedView === "delivery";
  const showWorkloadSection = selectedView === "workload";
  const showRequestsSection = isOverviewView || selectedView === "requests";
  const showActivitySection = isOverviewView || selectedView === "activity";

  const overviewSignalCards = [
    {
      key: "signal_open",
      label: "Open tasks",
      value: String(openTasks.length),
      href: buildDashboardViewHref("delivery", "task_delivery"),
    },
    {
      key: "signal_overdue",
      label: "Overdue tasks",
      value: String(overdueTasks.length),
      href: buildDashboardViewHref("delivery", "task_delivery"),
    },
    {
      key: "signal_margin",
      label: "Gross margin",
      value: formatEmployeeInfoCurrencyAmount(financeSummary.marginTotal, financeSummary.currencyCode),
      href: buildDashboardViewHref("finance", "finance"),
    },
    {
      key: "signal_requests",
      label: "Open suggestions",
      value: String(ideasCount + needsCheckingCount + plannedCount),
      href: buildDashboardViewHref("requests", "feature_requests"),
    },
  ];

  const activeFilterChips: string[] = [];
  if (selectedRange !== "all") {
    const rangeLabel = rangeOptions.find((option) => option.value === selectedRange)?.label || selectedRange;
    activeFilterChips.push(rangeLabel);
  }
  if (filteredClientIds.length) activeFilterChips.push(formatCountLabel(filteredClientIds.length, "client"));
  if (filteredProjectIds.length) activeFilterChips.push(formatCountLabel(filteredProjectIds.length, "project"));
  if (filteredUserIds.length) activeFilterChips.push(formatCountLabel(filteredUserIds.length, "user"));
  if (selectedStatuses.length) activeFilterChips.push(formatCountLabel(selectedStatuses.length, "status"));
  if (selectedPriorities.length) {
    activeFilterChips.push(formatCountLabel(selectedPriorities.length, "priority"));
  }
  if (!activeFilterChips.length) {
    activeFilterChips.push("No active filters");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Workspace Dashboard
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            <p className="max-w-xl text-sm text-slate-600">
              {activeView.description}. Use views to move between finance, delivery, workload, and requests.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {activeFilterChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <DashboardCurrencySelect
            filters={filtersForQuery}
            focus={selectedFocus}
            view={selectedView}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewSignalCards.map((card) => (
            <Link
              key={card.key}
              href={card.href}
              className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm transition-colors hover:bg-white"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{card.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <nav className="rounded-xl border border-slate-200 bg-white p-2">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {dashboardViews.map((view) => {
            const active = view.key === selectedView;
            return (
              <li key={view.key}>
                <Link
                  href={buildDashboardViewHref(view.key)}
                  className={`block rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold">{view.label}</p>
                  <p className={`text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>
                    {view.description}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <DashboardFilters
          rangeOptions={rangeOptions}
          clients={clients || []}
          projects={projects || []}
          users={users || []}
          statusOptions={taskStatuses}
          priorityOptions={taskPriorities}
          initialFilters={filtersForQuery}
          focus={selectedFocus}
          view={selectedView}
        />
      </section>

      {financeWarnings.length ? (
        <section className="space-y-2">
          {financeWarnings.map((warning) => (
            <p
              key={warning}
              className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
            >
              {warning}
            </p>
          ))}
        </section>
      ) : null}

      {showFinanceSection ? (
        <section id="finance" className={`space-y-3 ${sectionFocusClass("finance")}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Finance + People
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {financePeopleSnapshotCards.map((card) => (
              <DashboardSnapshotCard key={card.key} card={card} />
            ))}
          </div>
          {!isOverviewView ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Total Cost by Role</h3>
                <span className="text-xs text-slate-500">{financeSummary.currencyCode} per month</span>
              </div>
              {financeRoleCostRows.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-2 font-medium">Role</th>
                        <th className="px-2 py-2 text-right font-medium">Employees</th>
                        <th className="px-2 py-2 text-right font-medium">Monthly cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeRoleCostRows.map((row) => (
                        <tr key={row.roleLabel} className="border-t border-slate-100">
                          <td className="px-2 py-2 font-medium text-slate-900">{row.roleLabel}</td>
                          <td className="px-2 py-2 text-right text-slate-700">{row.employeeCount}</td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-900">
                            {formatEmployeeInfoCurrencyAmount(row.totalCost, financeSummary.currencyCode)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  {financeSummary.isEmptyScope
                    ? "No scoped clients from current filters."
                    : "No role cost data yet."}
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {showDeliverySection ? (
        <section id="task_delivery" className={`space-y-3 ${sectionFocusClass("task_delivery")}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Task + Delivery
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {taskSnapshotCards.map((card) => (
              <DashboardSnapshotCard key={card.key} card={card} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {projectSnapshotCards.map((card) => (
              <DashboardSnapshotCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {showRequestsSection ? (
        <section id="feature_requests" className={`space-y-3 ${sectionFocusClass("feature_requests")}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Feature Requests
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {featureSnapshotCards.map((card) => (
              <DashboardSnapshotCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {showDeliverySection && !isOverviewView ? (
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
      ) : null}

      {showWorkloadSection ? (
      <section className={`grid gap-6 lg:grid-cols-2 ${sectionFocusClass("work_by_client")}`}>
        <details className="rounded-lg border border-slate-200 bg-white" open={false}>
          <summary className="cursor-pointer select-none border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-900">
            Work by client ({clientWorkload.length})
          </summary>
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
                        {row.activity ? new Date(row.activity).toLocaleDateString("en-US") : "-"}
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
        </details>

        <details className="rounded-lg border border-slate-200 bg-white" open={false}>
          <summary className="cursor-pointer select-none border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-900">
            Work by user ({userWorkload.length})
          </summary>
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
        </details>
      </section>
      ) : null}

      {showRequestsSection && !isOverviewView ? (
      <section className={`grid gap-6 lg:grid-cols-2 ${sectionFocusClass("feature_requests")}`}>
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
      ) : null}

      {showActivitySection && !isOverviewView ? (
      <details className={`rounded-lg border border-slate-200 bg-white ${sectionFocusClass("projects_glance")}`} open={false}>
        <summary className="cursor-pointer select-none border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-900">
          Projects at a glance ({projectHealth.length})
        </summary>
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
      </details>
      ) : null}

      {showActivitySection ? (
      <section className={`rounded-lg border border-slate-200 bg-white p-6 ${sectionFocusClass("recent_activity")}`}>
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
      ) : null}
    </div>
  );
}

