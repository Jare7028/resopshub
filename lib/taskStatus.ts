import { DEFAULT_TASK_STATUS_OPTIONS, normalizeStatusValue } from "@/lib/statusOptions";

export const TASK_STATUS_OPTIONS = DEFAULT_TASK_STATUS_OPTIONS;

export type TaskStatus = string;

const LEGACY_TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  backlog: "to_do",
};

export function normalizeTaskStatus(value: string | null | undefined): TaskStatus | null {
  if (!value) return null;
  const trimmed = normalizeStatusValue(value);
  if (!trimmed) return null;
  const legacy = LEGACY_TASK_STATUS_ALIASES[trimmed];
  if (legacy) return legacy;
  return trimmed;
}

export function normalizeTaskStatusOrDefault(
  value: string | null | undefined,
  fallback: TaskStatus = DEFAULT_TASK_STATUS_OPTIONS[0]
): TaskStatus {
  return normalizeTaskStatus(value) ?? fallback;
}

export function coerceTaskStatusList(values: string[]): TaskStatus[] {
  const seen = new Set<TaskStatus>();
  values.forEach((value) => {
    const normalized = normalizeTaskStatus(value);
    if (normalized) {
      seen.add(normalized);
    }
  });
  return Array.from(seen);
}

// While legacy rows still exist in Postgres with status = "backlog", we need
// to treat "to_do" filters as (to_do OR backlog) so old tasks still show up.
export function expandTaskStatusFilterForQuery(statuses: TaskStatus[]): string[] {
  const expanded = new Set<string>(statuses);
  if (expanded.has("to_do")) {
    expanded.add("backlog");
  }
  return Array.from(expanded);
}

export function formatTaskStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeTaskStatus(status);
  const value = normalized ?? (status || "").trim();
  if (!value) return "";
  if (value === "to_do") return "To Do";
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
