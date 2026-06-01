import { normalizeStatusValue } from "./statusOptions";
import { toLocalDueDateTime } from "./taskIndicators";

export type LoginQuickReadTaskRow = {
  id: string;
  title: string | null;
  status: string | null;
  due_date: string | null;
  due_time: string | null;
};

export type LoginQuickReadTaskItem = {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: string;
  url: string;
  _sort: number;
};

const QUICK_READ_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatLocalDateForTaskQuery(date: Date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-");
}

export function getLoginQuickReadTaskDueDateCutoff(now: Date = new Date()) {
  return formatLocalDateForTaskQuery(new Date(now.getTime() + QUICK_READ_LOOKAHEAD_MS));
}

export function summarizeLoginQuickReadTasks(args: {
  taskRows: LoginQuickReadTaskRow[];
  hiddenTaskStatusSet: ReadonlySet<string>;
  now?: Date;
}) {
  const now = args.now || new Date();
  const cutoff = new Date(now.getTime() + QUICK_READ_LOOKAHEAD_MS);
  const overdueItems: LoginQuickReadTaskItem[] = [];
  const dueSoonItems: LoginQuickReadTaskItem[] = [];

  for (const task of args.taskRows) {
    const statusKey = normalizeStatusValue(String(task.status || ""));
    if (statusKey && args.hiddenTaskStatusSet.has(statusKey)) {
      continue;
    }

    const dueAt = toLocalDueDateTime(task.due_date, task.due_time);
    if (!dueAt) continue;

    const dueMs = dueAt.getTime();
    const entry = {
      id: task.id,
      title: String(task.title || "Untitled task").trim() || "Untitled task",
      dueDate: task.due_date,
      dueTime: task.due_time,
      dueAt: dueAt.toISOString(),
      url: `/tasks/${encodeURIComponent(task.id)}`,
      _sort: dueMs,
    };

    if (dueMs < now.getTime()) {
      overdueItems.push(entry);
    } else if (dueMs <= cutoff.getTime()) {
      dueSoonItems.push(entry);
    }
  }

  overdueItems.sort((left, right) => left._sort - right._sort);
  dueSoonItems.sort((left, right) => left._sort - right._sort);

  return { overdueItems, dueSoonItems };
}
