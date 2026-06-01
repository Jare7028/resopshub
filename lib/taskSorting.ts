export type TaskSortKey =
  | "created"
  | "title"
  | "client"
  | "project"
  | "status"
  | "priority"
  | "assignees"
  | "start"
  | "due"
  | "queue";

export type TaskSortDir = "asc" | "desc";

type RelationName = { name?: string | null } | { name?: string | null }[] | null | undefined;

type SortableTaskRow = {
  id: string;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  clients?: RelationName;
  projects?: RelationName;
  assignee_user_id?: string | null;
};

type SortUser = { id: string; full_name: string | null; email: string | null };

const PRIORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function getRelationName(relation: RelationName) {
  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "";
  }
  return relation?.name ?? "";
}

function parseIsoDateToStamp(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Local noon avoids most DST edge cases for day sorting.
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  dir: TaskSortDir,
  compare: (left: T, right: T) => number
) {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls last
  if (bNull) return -1;
  const base = compare(a, b);
  return dir === "asc" ? base : -base;
}

function compareString(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function normalizeTaskSortKey(value: string | null | undefined): TaskSortKey {
  const key = (value || "").trim().toLowerCase();
  if (
    key === "created" ||
    key === "title" ||
    key === "client" ||
    key === "project" ||
    key === "status" ||
    key === "priority" ||
    key === "assignees" ||
    key === "start" ||
    key === "due" ||
    key === "queue"
  ) {
    return key;
  }
  return "created";
}

export function normalizeTaskSortDir(value: string | null | undefined): TaskSortDir {
  const dir = (value || "").trim().toLowerCase();
  return dir === "asc" || dir === "desc" ? dir : "desc";
}

export function sortTasksForDisplay<T extends SortableTaskRow>(input: {
  tasks: T[];
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  users?: SortUser[];
  assigneesByTask?: Record<string, string[]>;
  statusOrder?: readonly string[];
  today?: string | Date;
}) {
  const {
    tasks,
    sortKey,
    sortDir,
    users = [],
    assigneesByTask = {},
    statusOrder = [],
    today: todayInput,
  } = input;

  if (!tasks.length) return tasks;

  const userLabelById = new Map(
    users.map((user) => [user.id, user.full_name || user.email || "Unnamed user"])
  );
  const statusRank = new Map(statusOrder.map((status, index) => [status, index]));
  const todayDate =
    typeof todayInput === "string"
      ? new Date(`${todayInput.slice(0, 10)}T12:00:00Z`)
      : todayInput instanceof Date
        ? todayInput
        : new Date();
  const todayStamp = Date.UTC(
    todayDate.getUTCFullYear(),
    todayDate.getUTCMonth(),
    todayDate.getUTCDate(),
    12,
    0,
    0,
    0
  );

  const getPrimaryAssigneeLabel = (task: SortableTaskRow) => {
    const ids = assigneesByTask[task.id] || [];
    const first = ids[0] || task.assignee_user_id;
    if (!first) return "";
    return userLabelById.get(first) || "";
  };

  const compareRows = (a: SortableTaskRow, b: SortableTaskRow) => {
    switch (sortKey) {
      case "title":
        return compareNullable(
          (a.title || "").trim(),
          (b.title || "").trim(),
          sortDir,
          compareString
        );
      case "client":
        return compareNullable(getRelationName(a.clients), getRelationName(b.clients), sortDir, compareString);
      case "project":
        return compareNullable(getRelationName(a.projects), getRelationName(b.projects), sortDir, compareString);
      case "status": {
        const ar = statusRank.get(a.status || "") ?? Number.POSITIVE_INFINITY;
        const br = statusRank.get(b.status || "") ?? Number.POSITIVE_INFINITY;
        return compareNullable(ar, br, sortDir, (l, r) => l - r);
      }
      case "priority": {
        const ar = PRIORITY_RANK[(a.priority || "").toLowerCase()] ?? Number.POSITIVE_INFINITY;
        const br = PRIORITY_RANK[(b.priority || "").toLowerCase()] ?? Number.POSITIVE_INFINITY;
        return compareNullable(ar, br, sortDir, (l, r) => l - r);
      }
      case "assignees":
        return compareNullable(getPrimaryAssigneeLabel(a), getPrimaryAssigneeLabel(b), sortDir, compareString);
      case "start": {
        const aStamp = parseIsoDateToStamp(a.start_date);
        const bStamp = parseIsoDateToStamp(b.start_date);
        return compareNullable(aStamp, bStamp, sortDir, (l, r) => l - r);
      }
      case "due": {
        const aStamp = parseIsoDateToStamp(a.due_date);
        const bStamp = parseIsoDateToStamp(b.due_date);
        return compareNullable(aStamp, bStamp, sortDir, (l, r) => l - r);
      }
      case "queue": {
        const score = (task: SortableTaskRow) => {
          const dueStamp = parseIsoDateToStamp(task.due_date);
          const priorityRank =
            PRIORITY_RANK[(task.priority || "").toLowerCase()] ?? 0;
          const overdue = dueStamp != null && dueStamp < todayStamp ? 100000 : 0;
          const dueSoon =
            dueStamp != null &&
            dueStamp >= todayStamp &&
            dueStamp <= todayStamp + 7 * 86400000
              ? 8000
              : 0;
          return overdue + priorityRank * 10000 + dueSoon;
        };
        return compareNullable(score(a), score(b), sortDir, (l, r) => l - r);
      }
      case "created":
      default: {
        const aStamp = parseIsoDateToStamp(a.created_at);
        const bStamp = parseIsoDateToStamp(b.created_at);
        return compareNullable(aStamp, bStamp, sortDir, (l, r) => l - r);
      }
    }
  };

  // Sort copy to avoid mutating the original reference passed down to clients.
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    const primary = compareRows(a, b);
    if (primary !== 0) return primary;
    // Tiebreaker for deterministic order.
    return compareString(a.id, b.id);
  });
  return sorted;
}

