import {
  DEFAULT_TASK_STATUS_OPTIONS,
  normalizeStatusValue,
  type StatusOptionMetadata,
} from "@/lib/statusOptions";

export const TASK_STATUS_OPTIONS = DEFAULT_TASK_STATUS_OPTIONS;

export const SUPPORTED_TASK_STATUS_VALUES = [
  "to_do",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "template",
] as const;

export type TaskStatus = (typeof SUPPORTED_TASK_STATUS_VALUES)[number];

const SUPPORTED_TASK_STATUS_SET = new Set<string>(SUPPORTED_TASK_STATUS_VALUES);

const LEGACY_TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  backlog: "to_do",
};

function isSupportedTaskStatusValue(value: string): value is TaskStatus {
  return SUPPORTED_TASK_STATUS_SET.has(value);
}

export function normalizeTaskStatus(value: string | null | undefined): TaskStatus | null {
  if (!value) return null;
  const trimmed = normalizeStatusValue(value);
  if (!trimmed) return null;
  const legacy = LEGACY_TASK_STATUS_ALIASES[trimmed];
  const normalized = legacy || trimmed;
  if (!isSupportedTaskStatusValue(normalized)) return null;
  return normalized;
}

export function normalizeTaskStatusOrDefault(
  value: string | null | undefined,
  fallback: TaskStatus = "to_do"
): TaskStatus {
  const normalizedFallback = normalizeTaskStatus(fallback);
  return normalizeTaskStatus(value) ?? normalizedFallback ?? "to_do";
}

export function isSupportedTaskStatus(value: string | null | undefined): boolean {
  return normalizeTaskStatus(value) !== null;
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

export function filterTaskStatusOptionsWithMetadata(
  statusOptions: readonly StatusOptionMetadata[]
): StatusOptionMetadata[] {
  return statusOptions.filter((status) => isSupportedTaskStatus(status.value));
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
