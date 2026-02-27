export type StatusEntityType = "task" | "project" | "feature_suggestion";

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

export const DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS = [
  { value: "idea", is_visible: true, counts_as_completed: false },
  { value: "needs_checking", is_visible: true, counts_as_completed: false },
  { value: "planned", is_visible: true, counts_as_completed: false },
  { value: "completed", is_visible: true, counts_as_completed: true },
  { value: "rejected", is_visible: false, counts_as_completed: true },
] as const;

type StatusOptionSeed = {
  value: string;
  is_visible: boolean;
  counts_as_completed: boolean;
};

const DEFAULT_STATUS_DEFINITIONS_BY_ENTITY: Record<StatusEntityType, StatusOptionSeed[]> = {
  task: DEFAULT_TASK_STATUS_OPTIONS.map((status) => ({
    value: status,
    is_visible: true,
    counts_as_completed: false,
  })),
  project: DEFAULT_PROJECT_STATUS_OPTIONS.map((status) => ({
    value: status,
    is_visible: true,
    counts_as_completed: false,
  })),
  feature_suggestion: Array.from(DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS),
};

export type StatusOptionRow = {
  entity_type: StatusEntityType;
  value: string;
  position: number;
  is_visible?: boolean | null;
  counts_as_completed?: boolean | null;
};

export type StatusOptionMetadata = {
  value: string;
  position: number;
  isVisible: boolean;
  countsAsCompleted: boolean;
};

function getDefaultsForEntity(entityType: StatusEntityType): readonly StatusOptionSeed[] {
  return DEFAULT_STATUS_DEFINITIONS_BY_ENTITY[entityType] || [];
}

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
  return buildStatusOptionsWithMetadata(
    entityType,
    rows,
    defaults.map((status) => ({
      value: status,
      is_visible: true,
      counts_as_completed: false,
    }))
  ).map((row) => row.value);
}

export function buildStatusOptionsWithMetadata(
  entityType: StatusEntityType,
  rows: StatusOptionRow[] | null | undefined,
  defaults: readonly StatusOptionSeed[]
): StatusOptionMetadata[] {
  const merged = new Map<string, StatusOptionMetadata>();

  const normalizedDefaults = getDefaultsForEntity(entityType);
  const defaultSeedItems = defaults.length ? defaults : normalizedDefaults;

  defaultSeedItems.forEach((item, index) => {
    const normalized = normalizeStatusValue(item.value);
    if (!normalized) return;
    merged.set(normalized, {
      value: normalized,
      position: index + 1,
      isVisible: Boolean(item.is_visible),
      countsAsCompleted: Boolean(item.counts_as_completed),
    });
  });

  const filteredRows = (rows || []).filter((row) => row.entity_type === entityType);
  filteredRows.forEach((row, index) => {
    const normalized = normalizeStatusValue(row.value);
    if (!normalized) return;
    const position = Number(row.position);
    const current = merged.get(normalized);
    const fallbackPosition = current?.position ?? index + 1;
    merged.set(normalized, {
      value: normalized,
      position: Number.isFinite(position) && position > 0 ? position : fallbackPosition,
      isVisible: row.is_visible == null ? current?.isVisible ?? true : row.is_visible,
      countsAsCompleted:
        row.counts_as_completed == null
          ? current?.countsAsCompleted ?? false
          : row.counts_as_completed,
    });
  });

  return Array.from(merged.values()).sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.value.localeCompare(b.value);
  });
}

export function isCoreStatus(entityType: StatusEntityType, value: string): boolean {
  const normalized = normalizeStatusValue(value);
  if (!normalized) return false;
  const source = getDefaultsForEntity(entityType).map((status) =>
    normalizeStatusValue(status.value)
  );
  return source.includes(normalized);
}
