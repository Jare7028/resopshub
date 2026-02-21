import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import {
  TASK_STATUS_OPTIONS,
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
} from "@/lib/taskStatus";
import {
  buildStatusOptions,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import { updateTaskInlineAction } from "../../../tasks/actions";
import { normalizeTasksTabKey } from "../../../tasks/_components/TasksTabs";
import TasksView from "../../../tasks/TasksView";
import { withPerfTiming } from "@/lib/perf";
import {
  ensureClientPageEditAccess,
  ensureClientPageViewAccess,
  getClientPageAccessData,
} from "../_lib/clientPageAccess";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;
const tasksPageSize = 50;

export default async function ClientTasksPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    created?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    project?: string | string[];
    hide?: string;
    view?: string;
    sort?: string;
    dir?: string;
    tab?: string;
    create_mode?: string;
    template_task_id?: string;
    page?: string;
  }>;
}) {
  noStore();
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await withPerfTiming("clients.tasks.auth", () =>
    supabase.auth.getUser()
  );
  const authUserId = authData.user?.id;
  if (!authUserId) {
    redirect("/login");
  }
  const { data: statusOptionsRaw } = await withPerfTiming("clients.tasks.status_options", () =>
    supabase
      .from("status_options")
      .select("entity_type,value,position")
      .order("entity_type", { ascending: true })
      .order("position", { ascending: true })
      .order("value", { ascending: true })
  );
  const statusOptions = buildStatusOptions(
    "task",
    (statusOptionsRaw || []) as StatusOptionRow[],
    TASK_STATUS_OPTIONS
  );
  const selectedStatusesRaw = parseCsvParam(searchParams?.status);
  const selectedPrioritiesRaw = parseCsvParam(searchParams?.priority);
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const selectedProjectIdsRaw = parseCsvParam(searchParams?.project);
  let selectedDue = (searchParams?.due || "all").trim();
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  const activeTab = normalizeTasksTabKey(searchParams?.tab);
  const wantsAddDialog = activeTab === "add";

  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();

  const sortKey = normalizeTaskSortKey(searchParams?.sort);
  const sortDir = normalizeTaskSortDir(searchParams?.dir);
  const viewRaw = String(searchParams?.view || "").trim().toLowerCase();
  const selectedView: "table" | "gantt" | "board" =
    viewRaw === "gantt" || viewRaw === "board" || viewRaw === "table"
      ? (viewRaw as "table" | "gantt" | "board")
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const hasExplicitFilterParams =
    typeof searchParams?.status !== "undefined" ||
    typeof searchParams?.priority !== "undefined" ||
    typeof searchParams?.assignee !== "undefined" ||
    typeof searchParams?.project !== "undefined" ||
    typeof searchParams?.due !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    hasExplicitView;
  const pageParam = Number.parseInt(String(searchParams?.page || "1"), 10);
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const tasksRangeFrom = (currentPage - 1) * tasksPageSize;
  const tasksRangeTo = tasksRangeFrom + tasksPageSize;
  const { data: client } = await withPerfTiming("clients.tasks.client", () =>
    supabase.from("clients").select("id,name").eq("id", params.clientId).single()
  );

  if (!client) {
    notFound();
  }
  const { accessByKey: clientPageAccessByKey, visibleTabs } = await withPerfTiming(
    "clients.tasks.page_access",
    () => getClientPageAccessData({ supabase, clientId })
  );
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "tasks",
    accessByKey: clientPageAccessByKey,
  });
  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }

  const [projectsResult, usersResult] = await Promise.all([
    withPerfTiming("clients.tasks.projects", () =>
      supabase
        .from("projects")
        .select("id,name")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
    ),
    withPerfTiming("clients.tasks.users", () =>
      supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true })
    ),
  ]);
  const projects = projectsResult.data;
  const users = usersResult.data;

  const selectedStatuses = coerceTaskStatusList(selectedStatusesRaw).filter((status) =>
    statusOptions.includes(status)
  );
  const selectedPriorities = selectedPrioritiesRaw.filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const userIdSet = new Set((users || []).map((user) => user.id));
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const projectIdSet = new Set((projects || []).map((project) => project.id));
  const selectedProjectIds = selectedProjectIdsRaw.filter((id) => projectIdSet.has(id));

  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "priority", selectedPriorities);
  setCsvParam(returnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  setCsvParam(returnParams, "project", selectedProjectIds);
  returnParams.set("hide", hideCompleted ? "1" : "0");
  returnParams.set("sort", sortKey);
  returnParams.set("dir", sortDir);
  if (currentPage > 1) {
    returnParams.set("page", String(currentPage));
  }
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  const returnTo = returnParams.toString()
    ? `/clients/${clientId}/tasks?${returnParams}`
    : `/clients/${clientId}/tasks`;
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString()
    ? `/clients/${clientId}/tasks?${toggleParams}`
    : `/clients/${clientId}/tasks`;
  const buildTaskListPageUrl = (pageNumber: number) => {
    const normalizedPage = Number.isFinite(pageNumber) && pageNumber > 1 ? Math.floor(pageNumber) : 1;
    const sp = new URLSearchParams(returnParams);
    if (normalizedPage > 1) {
      sp.set("page", String(normalizedPage));
    } else {
      sp.delete("page");
    }
    const qs = sp.toString();
    return qs ? `/clients/${clientId}/tasks?${qs}` : `/clients/${clientId}/tasks`;
  };
  const hasLegacyClientAddParams =
    typeof searchParams?.create_mode !== "undefined" ||
    typeof searchParams?.template_task_id !== "undefined";
  const sharedAddTaskParams = new URLSearchParams();
  sharedAddTaskParams.set("tab", "add");
  sharedAddTaskParams.set("client", clientId);
  if (createMode === "template") {
    sharedAddTaskParams.set("create_mode", "template");
    if (templateTaskId) {
      sharedAddTaskParams.set("template_task_id", templateTaskId);
    }
  }
  const sharedAddTaskUrl = `/tasks?${sharedAddTaskParams.toString()}`;

  if (wantsAddDialog || hasLegacyClientAddParams) {
    redirect(sharedAddTaskUrl);
  }

  let tasksRequest = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,client_id,project_id"
    )
    .eq("client_id", clientId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });
  if (selectedStatuses.length) {
    tasksRequest = tasksRequest.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
  }
  if (selectedPriorities.length) {
    tasksRequest = tasksRequest.in("priority", selectedPriorities);
  }
  const wantsUnassigned = selectedAssignees.includes("unassigned");
  const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");
  if (wantsUnassigned && selectedAssigneeIds.length) {
    tasksRequest = tasksRequest.or(
      `assignee_user_id.is.null,assignee_user_id.in.(${selectedAssigneeIds.join(",")})`
    );
  } else if (wantsUnassigned) {
    tasksRequest = tasksRequest.is("assignee_user_id", null);
  } else if (selectedAssigneeIds.length) {
    tasksRequest = tasksRequest.in("assignee_user_id", selectedAssigneeIds);
  }
  if (selectedProjectIds.length) {
    tasksRequest = tasksRequest.in("project_id", selectedProjectIds);
  }
  const wantsCompletedStatuses =
    selectedStatuses.includes("completed") || selectedStatuses.includes("cancelled");
  const wantsTemplateStatus = selectedStatuses.includes("template");
  if (!wantsTemplateStatus && statusOptions.includes("template")) {
    tasksRequest = tasksRequest.neq("status", "template");
  }
  if (hideCompleted && !wantsCompletedStatuses) {
    tasksRequest = tasksRequest.not("status", "in", "(completed,cancelled)");
  }
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (selectedDue === "overdue") {
    tasksRequest = tasksRequest.lt("due_date", todayIso);
  } else if (selectedDue === "next_7") {
    const next = new Date(today);
    next.setDate(next.getDate() + 7);
    const nextIso = next.toISOString().slice(0, 10);
    tasksRequest = tasksRequest.gte("due_date", todayIso).lte("due_date", nextIso);
  } else if (selectedDue === "none") {
    tasksRequest = tasksRequest.is("due_date", null);
  }

  tasksRequest = tasksRequest.range(tasksRangeFrom, tasksRangeTo);
  const { data: tasksRaw } = await withPerfTiming("clients.tasks.rows", () => tasksRequest);
  const hasNextPage = (tasksRaw || []).length > tasksPageSize;
  const hasPreviousPage = currentPage > 1;
  const projectNameById = new Map((projects || []).map((project) => [project.id, project.name]));
  const tasks = ((tasksRaw || []).slice(0, tasksPageSize) as Array<{
    id: string;
    title: string;
    status: string | null;
    priority: string | null;
    start_date: string | null;
    due_date: string | null;
    due_time: string | null;
    created_at: string | null;
    assignee_user_id: string | null;
    client_id: string | null;
    project_id: string | null;
  }>).map((task) => ({
    ...task,
    clients: { name: client.name },
    projects: task.project_id ? { name: projectNameById.get(task.project_id) || "" } : null,
  }));
  const previousPageUrl = hasPreviousPage ? buildTaskListPageUrl(currentPage - 1) : null;
  const nextPageUrl = hasNextPage ? buildTaskListPageUrl(currentPage + 1) : null;

  const taskIds = (tasks || []).map((task) => task.id).filter(Boolean);
  const assigneesByTask: Record<string, string[]> = {};
  if (taskIds.length) {
    const { data: assigneeRows } = await withPerfTiming("clients.tasks.assignees", () =>
      supabase.from("task_assignees").select("task_id,user_id").in("task_id", taskIds)
    );
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

  const openSubtaskCountByTaskId: Record<string, number> = {};
  const taskIdsForSubtaskCounts = (sortedTasks || []).map((t) => t.id).filter(Boolean) as string[];
  if (taskIdsForSubtaskCounts.length) {
    const { data: subtasksForCountsRaw, error: subtasksForCountsError } = await withPerfTiming(
      "clients.tasks.open_subtask_counts",
      () =>
        supabase
          .from("tasks")
          .select("parent_task_id")
          .in("parent_task_id", taskIdsForSubtaskCounts)
          .not("status", "in", "(completed,cancelled)")
    );

    if (!subtasksForCountsError) {
      const subtasksForCounts = (subtasksForCountsRaw || []) as Array<{
        parent_task_id: string | null;
      }>;
      for (const row of subtasksForCounts) {
        const parentId = row.parent_task_id;
        if (!parentId) continue;
        openSubtaskCountByTaskId[parentId] = (openSubtaskCountByTaskId[parentId] || 0) + 1;
      }
    }
  }
  async function updateTaskInline(input: Parameters<typeof updateTaskInlineAction>[0]) {
    "use server";
    const supabase = createSupabaseServerClient();
    await ensureClientPageEditAccess({
      supabase,
      clientId,
      pageKey: "tasks",
      redirectPath: `/clients/${clientId}/tasks`,
    });
    return updateTaskInlineAction(input);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Tasks
        </h1>
        <ClientTabs clientId={clientId} active="tasks" tabs={visibleTabs} />
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

      <div className="flex justify-start">
        <Link
          href={sharedAddTaskUrl}
          className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          Add task
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={sortedTasks || []}
          users={users || []}
          clients={[client]}
          projects={(projects || []).map((project) => ({
            ...project,
            client_id: client.id,
            clients: [{ name: client.name }],
          }))}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          initialView={selectedView}
          returnTo={returnTo}
          initialFilters={{
            status: selectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: [client.id],
            project: selectedProjectIds,
          }}
          onUpdate={updateTaskInline}
          hideCompleted={hideCompleted}
          toggleUrl={toggleUrl}
          includeWatching={false}
          watchToggleUrl={toggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          basePath={`/clients/${clientId}/tasks`}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
          filterPersistenceUserId={authUserId}
          filterPersistenceScope={`client:${clientId}`}
          hasExplicitFilterParams={hasExplicitFilterParams}
        />
      </section>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Page {currentPage}
        </p>
        <div className="flex items-center gap-2">
          {previousPageUrl ? (
            <Link
              href={previousPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Previous
            </Link>
          ) : null}
          {nextPageUrl ? (
            <Link
              href={nextPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}





