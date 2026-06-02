import { cookies } from "next/headers";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam } from "@/lib/queryParams";
import { TASK_STATUS_OPTIONS, coerceTaskStatusList } from "@/lib/taskStatus";
import {
  DASHBOARD_DEFAULT_CURRENCY,
  DASHBOARD_FILTER_COOKIE_NAME,
  normalizeDashboardCurrency,
} from "./filterState";
import type { DashboardFiltersState } from "./types";

export const rangeOptions = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

const taskPriorities = ["low", "medium", "high", "critical"] as const;

type DashboardBlockedState = {
  state: "blocked";
  title: string;
  message: string;
};

type DashboardReadyState = {
  state: "ready";
  selectedFocus: string | null;
  filters: DashboardFiltersState;
  currentUserId: string;
  isAdmin: boolean;
  watchedProjectIds: string[];
  explicitTaskIds: string[];
  clients: Array<{ id: string; name: string; status: string | null; start_date: string | null }>;
  projects: Array<{
    id: string;
    name: string;
    status: string | null;
    client_id: string | null;
    updated_at?: string | null;
  }>;
  users: Array<{ id: string; full_name: string | null; email: string | null }>;
  rangeStart: string | null;
};

export type DashboardBaseData = DashboardBlockedState | DashboardReadyState;

function parseSavedFilters(raw: string | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }
}

export async function getDashboardData(props: {
  searchParams?: Promise<{
    range?: string;
    client?: string | string[];
    project?: string | string[];
    user?: string | string[];
    status?: string | string[];
    priority?: string | string[];
    currency?: string;
    focus?: string;
  }>;
}): Promise<DashboardBaseData> {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();

  const authUser = await getCurrentRequestUser(supabase, "dashboard.auth");
  const authEmail = authUser?.email;
  if (!authEmail) {
    return {
      state: "blocked",
      title: "Dashboard",
      message: "Please sign in to view reporting.",
    };
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const currentUserId = currentUser?.id || null;
  const isAdmin = currentUser?.role === "admin";
  if (!currentUserId) {
    return {
      state: "blocked",
      title: "Dashboard",
      message: "Create a user profile before viewing reporting.",
    };
  }

  const cookieStore = await cookies();
  const savedFilters = parseSavedFilters(cookieStore.get(DASHBOARD_FILTER_COOKIE_NAME)?.value);

  const getSaved = (key: string) => {
    const value = savedFilters[key];
    return typeof value === "string" ? value : undefined;
  };
  const getSavedList = (key: string) => parseCsvParam(savedFilters[key]);

  let selectedRange = (searchParams?.range ?? getSaved("range") ?? "all").trim();
  const selectedClientIds =
    searchParams?.client !== undefined ? parseCsvParam(searchParams.client) : getSavedList("client");
  const selectedProjectIds =
    searchParams?.project !== undefined ? parseCsvParam(searchParams.project) : getSavedList("project");
  const selectedUserIds =
    searchParams?.user !== undefined ? parseCsvParam(searchParams.user) : getSavedList("user");
  const selectedStatusesRaw =
    searchParams?.status !== undefined ? parseCsvParam(searchParams.status) : getSavedList("status");
  const selectedPrioritiesRaw =
    searchParams?.priority !== undefined ? parseCsvParam(searchParams.priority) : getSavedList("priority");
  const selectedCurrency = normalizeDashboardCurrency(
    searchParams?.currency ?? getSaved("currency") ?? DASHBOARD_DEFAULT_CURRENCY
  );
  const selectedFocus = String(searchParams?.focus || "").trim() || null;

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw);
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    taskPriorities.includes(priority as (typeof taskPriorities)[number])
  );

  const allowedRangeValues = new Set<string>(rangeOptions.map((option) => option.value));
  if (!allowedRangeValues.has(selectedRange)) {
    selectedRange = "all";
  }

  const [{ data: clientsRaw }, { data: usersRaw }] = await Promise.all([
    supabase.from("clients").select("id,name,status,start_date").order("name", { ascending: true }),
    supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
  ]);
  const clients = (clientsRaw || []) as Array<{
    id: string;
    name: string;
    status: string | null;
    start_date: string | null;
  }>;
  const users = (usersRaw || []) as Array<{ id: string; full_name: string | null; email: string | null }>;

  let visibleProjectIds: string[] = [];
  let watchedProjectIds: string[] = [];
  let explicitTaskIds: string[] = [];

  if (!isAdmin) {
    const [{ data: assignments }, { data: projectWatchers }] = await Promise.all([
      supabase.from("project_users").select("project_id").eq("user_id", currentUserId),
      supabase.from("project_watchers").select("project_id").eq("user_id", currentUserId),
    ]);
    watchedProjectIds = (projectWatchers || [])
      .map((row) => row.project_id)
      .filter(Boolean) as string[];
    const memberProjectIds = (assignments || [])
      .map((assignment) => assignment.project_id)
      .filter(Boolean) as string[];
    visibleProjectIds = Array.from(new Set([...memberProjectIds, ...watchedProjectIds]));

    const [{ data: taskAssignees }, { data: taskWatchers }] = await Promise.all([
      supabase.from("task_assignees").select("task_id").eq("user_id", currentUserId),
      supabase.from("task_watchers").select("task_id").eq("user_id", currentUserId),
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
    projects = (projectData || []) as typeof projects;
  }

  const clientIdSet = new Set(clients.map((client) => client.id));
  const filteredClientIds = selectedClientIds.filter((id) => clientIdSet.has(id));
  const projectIdSet = new Set(projects.map((project) => project.id));
  const filteredProjectIds = selectedProjectIds.filter((id) => projectIdSet.has(id));
  const userIdSet = new Set(users.map((user) => user.id));
  const filteredUserIds = selectedUserIds.filter((id) => userIdSet.has(id));

  const now = new Date();
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

  return {
    state: "ready",
    selectedFocus,
    filters: {
      range: selectedRange,
      client: filteredClientIds,
      project: filteredProjectIds,
      user: filteredUserIds,
      status: selectedStatuses,
      priority: selectedPriorities,
      currency: selectedCurrency,
    },
    currentUserId,
    isAdmin,
    watchedProjectIds,
    explicitTaskIds,
    clients,
    projects,
    users,
    rangeStart,
  };
}

export const dashboardTaskStatuses = TASK_STATUS_OPTIONS;
export const dashboardTaskPriorities = taskPriorities;
