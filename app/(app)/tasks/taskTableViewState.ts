import type { TaskSortDir, TaskSortKey } from "@/lib/taskSorting";

export const TASK_FILTER_PERSISTENCE_KEY_PREFIX = "resolvable.task-filters.v1";

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

export type PersistedTaskFilterState = {
  status: string[];
  priority: string[];
  assignee: string[];
  due: string;
  client: string[];
  project: string[];
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  view: "table" | "gantt" | "board";
};

const TASK_REQUIRED_COLUMN_IDS = new Set<TaskTableColumnId>(["task"]);

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
