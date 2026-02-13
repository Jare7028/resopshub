export type StatusEntityType = "task" | "project";

export const DEFAULT_TASK_STATUS_OPTIONS = [
  "to_do",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
];

export const DEFAULT_PROJECT_STATUS_OPTIONS = [
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
];

export type StatusOptionRow = {
  entity_type: StatusEntityType;
  value: string;
  position: number;
};

export function normalizeStatusValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function buildStatusOptions(
  entityType: StatusEntityType,
  rows: StatusOptionRow[] | null | undefined,
  defaults: string[]
): string[] {
  const values = new Set(defaults.map((value) => normalizeStatusValue(value)).filter(Boolean));
  (rows || [])
    .filter((row) => row.entity_type === entityType)
    .forEach((row) => {
      const normalized = normalizeStatusValue(row.value);
      if (normalized) values.add(normalized);
    });
  return Array.from(values);
}

export function isCoreStatus(entityType: StatusEntityType, value: string): boolean {
  const normalized = normalizeStatusValue(value);
  if (!normalized) return false;
  const source =
    entityType === "task" ? DEFAULT_TASK_STATUS_OPTIONS : DEFAULT_PROJECT_STATUS_OPTIONS;
  return source.includes(normalized);
}
