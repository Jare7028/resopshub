import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  type TaskSortDir,
  type TaskSortKey,
} from "@/lib/taskSorting";
import { setCsvParam } from "@/lib/queryParams";

export const TASK_FILTER_PERSISTENCE_KEY_PREFIX = "resolvable.task-filters.v1";

export type TaskViewMode = "table" | "gantt" | "board";

export type TaskFilterState = {
  status: string[];
  priority: string[];
  assignee: string[];
  due: string;
  client: string[];
  project: string[];
};

export type TaskTableColumnId =
  | "task"
  | "open_subtasks"
  | "client"
  | "project"
  | "status"
  | "priority"
  | "assignees"
  | "start"
  | "next_subtask_due"
  | "due";

export type PersistedTaskFilterState = TaskFilterState & {
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: TaskViewMode;
};

type BuildTaskListQueryInput = {
  filters: TaskFilterState;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: TaskViewMode;
  hideCompleted: boolean;
  includeWatching: boolean;
  searchQuery?: string;
  page?: number;
  fixedParams?: Record<string, string | null | undefined>;
};

type BuildTaskPreferenceFormDataInput = {
  filters: TaskFilterState;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: TaskViewMode;
  hideCompleted: boolean;
  includeWatching: boolean;
};

type TaskOptionId = {
  id: string | null | undefined;
};

type TaskDueOptionValue = {
  value: string | null | undefined;
};

type NormalizePersistedTaskFiltersInput = {
  parsed: Partial<Record<keyof PersistedTaskFilterState, unknown>>;
  initialFilters: TaskFilterState;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  users: readonly TaskOptionId[];
  dueOptions: readonly TaskDueOptionValue[];
  clients: readonly TaskOptionId[];
  projects: readonly TaskOptionId[];
  fallbackHideCompleted: boolean;
  fallbackIncludeWatching: boolean;
  fallbackSortKey: TaskSortKey;
  fallbackSortDir: TaskSortDir;
  fallbackView: TaskViewMode;
};

export type NormalizedPersistedTaskFilters = {
  filters: TaskFilterState;
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: TaskViewMode;
};

const TASK_REQUIRED_COLUMN_IDS = new Set<TaskTableColumnId>(["task"]);
const TASK_VIEW_MODES = new Set<TaskViewMode>(["table", "gantt", "board"]);

export function normalizeStorageList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

export function filterAllowedValues(values: string[], allowedValues: Set<string>) {
  return values.filter((value) => allowedValues.has(value));
}

function buildAllowedValueSet(values: readonly string[]) {
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

function buildAllowedIdSet(rows: readonly TaskOptionId[]) {
  return buildAllowedValueSet(rows.map((row) => row.id || ""));
}

function isTaskViewMode(value: string): value is TaskViewMode {
  return TASK_VIEW_MODES.has(value as TaskViewMode);
}

export function buildTaskFilterPersistenceKey({
  userId,
  scope,
}: {
  userId: string | null | undefined;
  scope: string | null | undefined;
}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;

  const rawScope = String(scope || "/tasks")
    .trim()
    .toLowerCase();
  const normalizedScope = rawScope || "/tasks";
  return `${TASK_FILTER_PERSISTENCE_KEY_PREFIX}:${normalizedUserId}:${normalizedScope}`;
}

export function buildTaskListQuery({
  filters,
  sortKey,
  sortDir,
  view,
  hideCompleted,
  includeWatching,
  searchQuery = "",
  page = 1,
  fixedParams = {},
}: BuildTaskListQueryInput) {
  const params = new URLSearchParams();

  Object.entries(fixedParams).forEach(([key, value]) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      params.set(key, normalized);
    }
  });

  setCsvParam(params, "status", filters.status);
  setCsvParam(params, "priority", filters.priority);
  if (filters.assignee.length) {
    setCsvParam(params, "assignee", filters.assignee);
  } else {
    params.set("assignee", "all");
  }
  setCsvParam(params, "client", filters.client);
  setCsvParam(params, "project", filters.project);

  if (filters.due && filters.due !== "all") params.set("due", filters.due);
  if (!hideCompleted) params.set("hide", "0");
  if (includeWatching) params.set("watch", "1");
  if (sortKey !== "created" || sortDir !== "desc") {
    params.set("sort", sortKey);
    params.set("dir", sortDir);
  }
  if (view !== "table") params.set("view", view);

  const normalizedSearchQuery = String(searchQuery || "").trim();
  if (normalizedSearchQuery) params.set("q", normalizedSearchQuery);
  if (page > 1) params.set("page", String(page));

  return params.toString();
}

export function buildTaskListUrl(
  basePath: string,
  input: BuildTaskListQueryInput
) {
  const query = buildTaskListQuery(input);
  return buildTaskListUrlFromQuery({ basePath, query });
}

export function buildTaskListUrlFromQuery({
  basePath,
  query,
  fallbackPath,
}: {
  basePath: string;
  query: string;
  fallbackPath?: string;
}) {
  const normalizedQuery = query.startsWith("?") ? query.slice(1) : query;
  if (normalizedQuery) return `${basePath}?${normalizedQuery}`;
  return fallbackPath || basePath;
}

export function getNextTaskSortDir({
  currentSortKey,
  currentSortDir,
  nextSortKey,
}: {
  currentSortKey: TaskSortKey;
  currentSortDir: TaskSortDir;
  nextSortKey: TaskSortKey;
}): TaskSortDir {
  return currentSortKey === nextSortKey && currentSortDir === "asc" ? "desc" : "asc";
}

export function buildTaskPreferenceFormData({
  filters,
  sortKey,
  sortDir,
  view,
  hideCompleted,
  includeWatching,
}: BuildTaskPreferenceFormDataInput) {
  const formData = new FormData();
  const setCsvField = (key: string, values: string[]) => {
    const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
    formData.set(key, cleaned.join(","));
  };

  setCsvField("status", filters.status);
  setCsvField("priority", filters.priority);
  setCsvField("assignee", filters.assignee);
  setCsvField("client", filters.client);
  setCsvField("project", filters.project);
  formData.set("due", filters.due || "all");
  formData.set("hide_completed", hideCompleted ? "1" : "0");
  formData.set("include_watching", includeWatching ? "1" : "0");
  formData.set("sort_key", sortKey);
  formData.set("sort_dir", sortDir);
  formData.set("view_mode", view);

  return formData;
}

export function normalizePersistedTaskFilters({
  parsed,
  initialFilters,
  statusOptions,
  priorityOptions,
  users,
  dueOptions,
  clients,
  projects,
  fallbackHideCompleted,
  fallbackIncludeWatching,
  fallbackSortKey,
  fallbackSortDir,
  fallbackView,
}: NormalizePersistedTaskFiltersInput): NormalizedPersistedTaskFilters {
  const statusSet = buildAllowedValueSet(statusOptions);
  const prioritySet = buildAllowedValueSet(priorityOptions);
  const assigneeSet = buildAllowedIdSet(users);
  assigneeSet.add("unassigned");
  const dueSet = buildAllowedValueSet(dueOptions.map((value) => value.value || ""));
  const clientSet = buildAllowedIdSet(clients);
  const projectSet = buildAllowedIdSet(projects);

  const restoredAssignees = filterAllowedValues(
    normalizeStorageList(parsed.assignee),
    assigneeSet
  );
  const parsedDue = String(parsed.due || "").trim();
  const parsedView = String(parsed.view || "").trim();

  return {
    filters: {
      status: filterAllowedValues(normalizeStorageList(parsed.status), statusSet),
      priority: filterAllowedValues(normalizeStorageList(parsed.priority), prioritySet),
      assignee: restoredAssignees.length > 0 ? restoredAssignees : initialFilters.assignee,
      due: dueSet.has(parsedDue) && parsedDue ? parsedDue : "all",
      client: filterAllowedValues(normalizeStorageList(parsed.client), clientSet),
      project: filterAllowedValues(normalizeStorageList(parsed.project), projectSet),
    },
    hideCompleted:
      typeof parsed.hideCompleted === "boolean"
        ? parsed.hideCompleted
        : fallbackHideCompleted,
    includeWatching:
      typeof parsed.includeWatching === "boolean"
        ? parsed.includeWatching
        : fallbackIncludeWatching,
    sortKey: normalizeTaskSortKey(String(parsed.sortKey || fallbackSortKey || "")),
    sortDir: normalizeTaskSortDir(String(parsed.sortDir || fallbackSortDir || "")),
    view: isTaskViewMode(parsedView) ? parsedView : fallbackView,
  };
}

export function normalizeVisibleTaskColumns(
  values: string[],
  knownColumnIds: TaskTableColumnId[]
) {
  const knownColumnIdSet = new Set<TaskTableColumnId>(knownColumnIds);
  const normalized = Array.from(
    new Set(
      values.filter((value): value is TaskTableColumnId =>
        knownColumnIdSet.has(value as TaskTableColumnId)
      )
    )
  );

  const withRequiredColumns = normalized.slice();
  TASK_REQUIRED_COLUMN_IDS.forEach((requiredColumnId) => {
    if (!knownColumnIdSet.has(requiredColumnId)) return;
    if (!withRequiredColumns.includes(requiredColumnId)) {
      withRequiredColumns.unshift(requiredColumnId);
    }
  });

  return withRequiredColumns.length ? withRequiredColumns : knownColumnIds.slice();
}
