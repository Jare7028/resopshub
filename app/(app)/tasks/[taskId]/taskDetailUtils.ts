import type { TaskSortDir, TaskSortKey } from "@/lib/taskSorting";

export type TaskDetailTabKey =
  | "details"
  | "assignees"
  | "watchers"
  | "subtasks"
  | "notes"
  | "audit";

export type TaskSubtaskView = "table" | "gantt" | "board";

export function buildTaskUrl(
  taskId: string,
  tab: TaskDetailTabKey,
  params?: {
    error?: string;
    success?: string;
    addField?: "1" | "0";
    created?: string;
  }
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
  if (params?.addField === "1") {
    sp.set("add_field", "1");
  }
  if (params?.created) {
    sp.set("created", params.created);
  }

  const qs = sp.toString();
  return qs ? `/tasks/${taskId}?${qs}` : `/tasks/${taskId}`;
}

export function formatDbError(
  context: string,
  error:
    | { message: string; code?: string; details?: string | null; hint?: string | null }
    | null
    | undefined
) {
  if (!error) return context;
  const parts = [`[${context}]`, error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

export function normalizeTaskSubtaskView(value: string | null | undefined): TaskSubtaskView {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "gantt" || normalized === "board" || normalized === "table"
    ? normalized
    : "table";
}

export function normalizeTaskDueFilter(
  value: string | null | undefined,
  allowedValues: ReadonlySet<string>
) {
  const normalized = String(value || "all").trim();
  return allowedValues.has(normalized) ? normalized : "all";
}

export function getRelationName(
  relation:
    | { name?: string | null }
    | { name?: string | null }[]
    | null
    | undefined,
  fallback: string
) {
  if (Array.isArray(relation)) {
    return relation[0]?.name ?? fallback;
  }
  return relation?.name ?? fallback;
}

export function getUserDisplayName(
  userId: string | null,
  assigneeMap: ReadonlyMap<string, string | null | undefined>
) {
  if (!userId) return "System";
  return assigneeMap.get(userId) || "Unknown user";
}

export function buildSubtasksReturnParams({
  selectedStatuses,
  selectedPriorities,
  selectedAssignees,
  selectedDue,
  selectedClientIds,
  selectedProjectIds,
  hideCompleted,
  sortKey,
  sortDir,
  selectedSubtaskView,
}: {
  selectedStatuses: readonly string[];
  selectedPriorities: readonly string[];
  selectedAssignees: readonly string[];
  selectedDue: string;
  selectedClientIds: readonly string[];
  selectedProjectIds: readonly string[];
  hideCompleted: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  selectedSubtaskView: TaskSubtaskView;
}) {
  const params = new URLSearchParams();
  params.set("tab", "subtasks");
  setCsvParam(params, "status", selectedStatuses);
  setCsvParam(params, "priority", selectedPriorities);
  setCsvParam(params, "assignee", selectedAssignees);
  if (selectedDue !== "all") {
    params.set("due", selectedDue);
  }
  setCsvParam(params, "client", selectedClientIds);
  setCsvParam(params, "project", selectedProjectIds);
  params.set("hide", hideCompleted ? "1" : "0");
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  if (selectedSubtaskView !== "table") {
    params.set("view", selectedSubtaskView);
  }
  return params;
}

export function buildSubtasksReturnUrl(
  taskId: string,
  params: URLSearchParams
) {
  return `/tasks/${taskId}?${params.toString()}`;
}

export function buildSubtasksToggleUrl(
  taskId: string,
  params: URLSearchParams,
  hideCompleted: boolean
) {
  const toggleParams = new URLSearchParams(params);
  toggleParams.set("hide", hideCompleted ? "0" : "1");
  return buildSubtasksReturnUrl(taskId, toggleParams);
}

function setCsvParam(
  params: URLSearchParams,
  key: string,
  values: readonly string[]
) {
  if (!values.length) return;
  params.set(key, values.join(","));
}
