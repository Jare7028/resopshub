import { notFound, redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import ProjectTabs from "../_components/ProjectTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import TasksView from "@/app/(app)/tasks/TasksView";
import {
  coerceTaskStatusList,
  expandTaskStatusFilterForQuery,
  filterTaskStatusOptionsWithMetadata,
} from "@/lib/taskStatus";
import {
  buildStatusColorMap,
  buildHiddenStatusValues,
  buildStatusOptionsWithMetadata,
  type StatusOptionRow,
} from "@/lib/statusOptions";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "@/lib/taskSorting";
import { updateTaskInlineAction } from "../../../tasks/actions";
import { loadAssignmentGroups } from "@/lib/assignmentGroups";

const priorityOptions = ["low", "medium", "high", "critical"] as const;
const dueDateFilters = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "none", label: "No due date" },
] as const;

export default async function ProjectTasksPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{
    error?: string;
    success?: string;
    created?: string;
    tab?: string;
    view?: string;
    status?: string | string[];
    priority?: string | string[];
    assignee?: string | string[];
    due?: string;
    hide?: string;
    sort?: string;
    dir?: string;
    create_mode?: string;
    template_task_id?: string;
  }>;
}) {
  noStore();
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: statusOptionsRaw } = await supabase
    .from("status_options")
    .select("entity_type,value,position,is_visible,counts_as_completed,color_hex")
    .order("entity_type", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });
  const taskStatusOptionsWithMetadata = filterTaskStatusOptionsWithMetadata(
    buildStatusOptionsWithMetadata(
      "task",
      (statusOptionsRaw || []) as StatusOptionRow[],
      []
    )
  );
  const statusOptions = taskStatusOptionsWithMetadata.map((status) => status.value);
  const taskStatusColorMap = buildStatusColorMap("task", taskStatusOptionsWithMetadata);
  const hiddenTaskStatusValues = buildHiddenStatusValues("task", taskStatusOptionsWithMetadata);
  const hiddenTaskStatusSet = new Set(hiddenTaskStatusValues);
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
    typeof searchParams?.due !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    hasExplicitView;
  const selectedStatuses = coerceTaskStatusList(parseCsvParam(searchParams?.status)).filter(
    (status) => statusOptions.includes(status)
  );
  const selectedPriorities = parseCsvParam(searchParams?.priority).filter((priority) =>
    priorityOptions.includes(priority as (typeof priorityOptions)[number])
  );
  const selectedAssigneesRaw = parseCsvParam(searchParams?.assignee);
  const hideCompleted = (searchParams?.hide ?? "1").trim() !== "0";
  let selectedDue = (searchParams?.due || "all").trim();
  const allowedDueValues = new Set<string>(
    dueDateFilters.map((filter) => filter.value)
  );
  if (!allowedDueValues.has(selectedDue)) {
    selectedDue = "all";
  }
  const createModeRaw = String(searchParams?.create_mode || "")
    .trim()
    .toLowerCase();
  const createMode: "new" | "template" =
    createModeRaw === "template" ? "template" : "new";
  const templateTaskId = String(searchParams?.template_task_id || "").trim();
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
  const basePath = `/projects/${projectId}/tasks`;
  const activeTab = String(searchParams?.tab || "").trim().toLowerCase();
  const hasLegacyProjectAddParams =
    typeof searchParams?.create_mode !== "undefined" ||
    typeof searchParams?.template_task_id !== "undefined";
  const sharedAddTaskParams = new URLSearchParams();
  sharedAddTaskParams.set("tab", "add");
  sharedAddTaskParams.set("project", projectId);
  if (createMode === "template") {
    sharedAddTaskParams.set("create_mode", "template");
    if (templateTaskId) {
      sharedAddTaskParams.set("template_task_id", templateTaskId);
    }
  }
  const sharedAddTaskUrl = `/tasks?${sharedAddTaskParams.toString()}`;

  if (!isAdmin && currentUserId) {
    const { data: assignment } = await supabase
      .from("project_users")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    const { data: watching } = await supabase
      .from("project_watchers")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (!assignment && !watching) {
      redirect("/projects?error=Not%20assigned%20to%20that%20project");
    }
  } else if (!isAdmin && !currentUserId) {
    redirect("/projects?error=User%20profile%20missing");
  }

  if (activeTab === "add" || hasLegacyProjectAddParams) {
    redirect(sharedAddTaskUrl);
  }

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const assignmentGroupsResult = await loadAssignmentGroups(supabase);
  const assignmentGroups = assignmentGroupsResult.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
  }));

  const userIdSet = new Set((users || []).map((user) => user.id));
  const selectedAssignees = selectedAssigneesRaw.filter(
    (value) => value === "unassigned" || userIdSet.has(value)
  );
  const returnParams = new URLSearchParams();
  setCsvParam(returnParams, "status", selectedStatuses);
  setCsvParam(returnParams, "priority", selectedPriorities);
  setCsvParam(returnParams, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    returnParams.set("due", selectedDue);
  }
  returnParams.set("hide", hideCompleted ? "1" : "0");
  returnParams.set("sort", sortKey);
  returnParams.set("dir", sortDir);
  if (selectedView !== "table") {
    returnParams.set("view", selectedView);
  }
  const returnTo = returnParams.toString() ? `${basePath}?${returnParams}` : basePath;
  const toggleParams = new URLSearchParams(returnParams);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  const toggleUrl = toggleParams.toString() ? `${basePath}?${toggleParams}` : basePath;
  let clientName: string | null = null;
  if (projectClientId) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("id", projectClientId)
      .maybeSingle();
    clientName = clientRow?.name || null;
  }
  const clients = projectClientId
    ? [{ id: projectClientId, name: clientName || "Client" }]
    : [];
  const projects = [
    {
      id: projectId,
      name: project.name,
      client_id: projectClientId,
      clients: clientName ? { name: clientName } : null,
    },
  ];

  let request = supabase
    .from("tasks")
    .select(
      "id,title,status,priority,start_date,due_date,due_time,created_at,assignee_user_id,parent_task_id,client_id,project_id,projects(name),clients(name)"
    )
    .eq("project_id", projectId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });

  if (selectedStatuses.length) {
    request = request.in("status", expandTaskStatusFilterForQuery(selectedStatuses));
  }

  if (selectedPriorities.length) {
    request = request.in("priority", selectedPriorities);
  }

  const wantsUnassigned = selectedAssignees.includes("unassigned");
  const selectedAssigneeIds = selectedAssignees.filter((value) => value !== "unassigned");
  let selectedAssigneeTaskIds: string[] = [];
  if (selectedAssigneeIds.length) {
    const { data: selectedAssigneeTaskRows } = await supabase
      .from("task_assignees")
      .select("task_id")
      .in("user_id", selectedAssigneeIds);
    selectedAssigneeTaskIds = Array.from(
      new Set(
        ((selectedAssigneeTaskRows || []) as Array<{ task_id: string | null }>)
          .map((row) => row.task_id)
          .filter((taskId): taskId is string => Boolean(taskId))
      )
    );
  }
  if (wantsUnassigned && selectedAssigneeIds.length) {
    const assigneeOrFilters = [
      "assignee_user_id.is.null",
      `assignee_user_id.in.(${selectedAssigneeIds.join(",")})`,
    ];
    if (selectedAssigneeTaskIds.length) {
      assigneeOrFilters.push(`id.in.(${selectedAssigneeTaskIds.join(",")})`);
    }
    request = request.or(assigneeOrFilters.join(","));
  } else if (wantsUnassigned) {
    request = request.is("assignee_user_id", null);
  } else if (selectedAssigneeIds.length) {
    if (selectedAssigneeTaskIds.length) {
      request = request.or(
        `assignee_user_id.in.(${selectedAssigneeIds.join(",")}),id.in.(${selectedAssigneeTaskIds.join(",")})`
      );
    } else {
      request = request.in("assignee_user_id", selectedAssigneeIds);
    }
  }

  const wantsHiddenStatuses = selectedStatuses.some((status) =>
    hiddenTaskStatusSet.has(status)
  );
  const wantsTemplateStatus = selectedStatuses.includes("template");
  if (!wantsTemplateStatus && statusOptions.includes("template")) {
    request = request.neq("status", "template");
  }
  if (hideCompleted && hiddenTaskStatusValues.length && !wantsHiddenStatuses) {
    request = request.not("status", "in", `(${hiddenTaskStatusValues.join(",")})`);
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
    let subtasksForCountsQuery = supabase
      .from("tasks")
      .select("parent_task_id")
      .in("parent_task_id", taskIdsForSubtaskCounts);

    if (hiddenTaskStatusValues.length) {
      subtasksForCountsQuery = subtasksForCountsQuery.not(
        "status",
        "in",
        `(${hiddenTaskStatusValues.join(",")})`
      );
    }

    const { data: subtasksForCountsRaw, error: subtasksForCountsError } =
      await subtasksForCountsQuery;

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

  const updateTaskInline = updateTaskInlineAction;

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

      {searchParams?.success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {searchParams.success}
        </p>
      ) : null}

      <div className="flex justify-start">
        <a
          href={sharedAddTaskUrl}
          className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          Add task
        </a>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <TasksView
          tasks={sortedTasks}
          users={users || []}
          groups={assignmentGroups}
          clients={clients}
          projects={projects}
          assigneesByTask={assigneesByTask}
          openSubtaskCountByTaskId={openSubtaskCountByTaskId}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          dueOptions={dueDateFilters}
          returnTo={returnTo}
          initialFilters={{
            status: selectedStatuses,
            priority: selectedPriorities,
            assignee: selectedAssignees,
            due: selectedDue,
            client: projectClientId ? [projectClientId] : [],
            project: [projectId],
          }}
          onUpdate={updateTaskInline}
          hideCompleted={hideCompleted}
          statusColorMap={taskStatusColorMap}
          toggleUrl={toggleUrl}
          includeWatching={false}
          watchToggleUrl={toggleUrl}
          sortKey={sortKey}
          sortDir={sortDir}
          initialView={selectedView}
          basePath={basePath}
          fixedParams={{
            project: projectId,
            ...(projectClientId ? { client: projectClientId } : {}),
          }}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="tasks"
          filterPersistenceUserId={currentUserId || authData.user?.id || null}
          filterPersistenceScope={`project:${projectId}`}
          hasExplicitFilterParams={hasExplicitFilterParams}
        />
      </section>
    </div>
  );
}
