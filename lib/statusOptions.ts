export type StatusEntityType = "task" | "project" | "feature_suggestion";

type StatusOptionSeed = {
  value: string;
  is_visible: boolean;
  counts_as_completed: boolean;
  color_hex?: string | null;
};

const DEFAULT_TASK_STATUS_DEFINITIONS: readonly StatusOptionSeed[] = [
  { value: "to_do", is_visible: true, counts_as_completed: false, color_hex: "#64748b" },
  { value: "in_progress", is_visible: true, counts_as_completed: false, color_hex: "#3b82f6" },
  { value: "blocked", is_visible: true, counts_as_completed: false, color_hex: "#f59e0b" },
  { value: "completed", is_visible: false, counts_as_completed: true, color_hex: "#10b981" },
  { value: "cancelled", is_visible: false, counts_as_completed: true, color_hex: "#f43f5e" },
];

const DEFAULT_PROJECT_STATUS_DEFINITIONS: readonly StatusOptionSeed[] = [
  { value: "planned", is_visible: true, counts_as_completed: false, color_hex: "#64748b" },
  { value: "active", is_visible: true, counts_as_completed: false, color_hex: "#3b82f6" },
  { value: "on_hold", is_visible: true, counts_as_completed: false, color_hex: "#f59e0b" },
  { value: "completed", is_visible: false, counts_as_completed: true, color_hex: "#10b981" },
  { value: "cancelled", is_visible: false, counts_as_completed: true, color_hex: "#f43f5e" },
];

export const DEFAULT_TASK_STATUS_OPTIONS = DEFAULT_TASK_STATUS_DEFINITIONS.map(
  (status) => status.value
);

export const DEFAULT_PROJECT_STATUS_OPTIONS = DEFAULT_PROJECT_STATUS_DEFINITIONS.map(
  (status) => status.value
);

export const DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS = [
  { value: "idea", is_visible: true, counts_as_completed: false, color_hex: "#64748b" },
  { value: "needs_checking", is_visible: true, counts_as_completed: false, color_hex: "#f59e0b" },
  { value: "planned", is_visible: true, counts_as_completed: false, color_hex: "#3b82f6" },
  { value: "completed", is_visible: false, counts_as_completed: true, color_hex: "#10b981" },
  { value: "rejected", is_visible: false, counts_as_completed: true, color_hex: "#f43f5e" },
] as const;

const DEFAULT_STATUS_DEFINITIONS_BY_ENTITY: Record<StatusEntityType, StatusOptionSeed[]> = {
  task: Array.from(DEFAULT_TASK_STATUS_DEFINITIONS),
  project: Array.from(DEFAULT_PROJECT_STATUS_DEFINITIONS),
  feature_suggestion: Array.from(DEFAULT_FEATURE_SUGGESTION_STATUS_OPTIONS),
};

const LEGACY_COMPLETED_STATUS_BY_ENTITY: Record<StatusEntityType, readonly string[]> = {
  task: ["completed", "cancelled"],
  project: ["completed", "cancelled"],
  feature_suggestion: ["completed", "rejected"],
};

export type StatusOptionRow = {
  entity_type: StatusEntityType;
  value: string;
  position: number;
  is_visible?: boolean | null;
  counts_as_completed?: boolean | null;
  color_hex?: string | null;
};

export type StatusOptionMetadata = {
  value: string;
  position: number;
  isVisible: boolean;
  countsAsCompleted: boolean;
  colorHex: string | null;
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

const FALLBACK_STATUS_COLOR_HEX = "#64748b";

export function normalizeStatusColorHex(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  const withoutHash = trimmed.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(withoutHash)) {
    const expanded = withoutHash
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(withoutHash)) {
    return `#${withoutHash.toLowerCase()}`;
  }

  return null;
}

export function defaultStatusColorHex(entityType: StatusEntityType, value: string): string {
  const normalized = normalizeStatusValue(value);
  if (!normalized) return FALLBACK_STATUS_COLOR_HEX;
  const seeded = getDefaultsForEntity(entityType).find(
    (status) => normalizeStatusValue(status.value) === normalized
  );
  return normalizeStatusColorHex(seeded?.color_hex) || FALLBACK_STATUS_COLOR_HEX;
}

export function buildStatusOptions(
  entityType: StatusEntityType,
  rows: StatusOptionRow[] | null | undefined,
  defaults: string[]
): string[] {
  const seededDefaults = new Map(
    getDefaultsForEntity(entityType).map((seed) => [normalizeStatusValue(seed.value), seed])
  );
  return buildStatusOptionsWithMetadata(
    entityType,
    rows,
    defaults.map((status) => {
      const normalized = normalizeStatusValue(status);
      const seeded = normalized ? seededDefaults.get(normalized) : null;
      return {
        value: status,
        is_visible: seeded?.is_visible ?? true,
        counts_as_completed: seeded?.counts_as_completed ?? false,
        color_hex: seeded?.color_hex || defaultStatusColorHex(entityType, status),
      };
    })
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
      colorHex: normalizeStatusColorHex(item.color_hex) || defaultStatusColorHex(entityType, normalized),
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
      colorHex:
        normalizeStatusColorHex(row.color_hex) ||
        current?.colorHex ||
        defaultStatusColorHex(entityType, normalized),
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

export function buildCompletedStatusValues(
  entityType: StatusEntityType,
  statusOptions: readonly StatusOptionMetadata[]
): string[] {
  const explicit = statusOptions
    .filter((status) => status.countsAsCompleted)
    .map((status) => status.value);
  if (explicit.length) {
    return explicit;
  }

  const fallbackSet = new Set(
    (LEGACY_COMPLETED_STATUS_BY_ENTITY[entityType] || []).map((status) =>
      normalizeStatusValue(status)
    )
  );
  if (!fallbackSet.size) {
    return [];
  }
  return statusOptions
    .map((status) => status.value)
    .filter((status) => fallbackSet.has(normalizeStatusValue(status)));
}

export function buildHiddenStatusValues(
  entityType: StatusEntityType,
  statusOptions: readonly StatusOptionMetadata[]
): string[] {
  const hiddenSet = new Set(buildCompletedStatusValues(entityType, statusOptions));
  statusOptions.forEach((status) => {
    if (!status.isVisible) {
      hiddenSet.add(status.value);
    }
  });
  return statusOptions
    .map((status) => status.value)
    .filter((status) => hiddenSet.has(status));
}

export function buildStatusColorMap(
  entityType: StatusEntityType,
  statusOptions: readonly StatusOptionMetadata[]
): Record<string, string> {
  return statusOptions.reduce<Record<string, string>>((acc, status) => {
    acc[status.value] =
      normalizeStatusColorHex(status.colorHex) || defaultStatusColorHex(entityType, status.value);
    return acc;
  }, {});
}
