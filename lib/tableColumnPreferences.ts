export type TableColumnPreferenceScope = "tasks" | "projects" | "clients";

type TableColumnPreferenceOptions = {
  userId?: string | null;
};

type PersistedTableColumnPreferenceState = {
  visible_column_ids?: string[];
  known_column_ids?: string[];
};

const TABLE_COLUMN_PREFERENCE_STORAGE_KEY = "resolvable.table-columns.v1";

function normalizeUserId(userId?: string | null) {
  const normalized = String(userId || "").trim();
  return normalized || "anonymous";
}

function getScopedStorageKey(
  scope: TableColumnPreferenceScope,
  options?: TableColumnPreferenceOptions
) {
  return `${TABLE_COLUMN_PREFERENCE_STORAGE_KEY}:${scope}:${normalizeUserId(options?.userId)}`;
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeIdList(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  return uniqueIds(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

export function readTableColumnVisibility(args: {
  scope: TableColumnPreferenceScope;
  knownColumnIds: ReadonlySet<string>;
  fallbackVisibleColumnIds: string[];
  options?: TableColumnPreferenceOptions;
}) {
  const { scope, knownColumnIds, fallbackVisibleColumnIds, options } = args;
  if (typeof window === "undefined") {
    return fallbackVisibleColumnIds;
  }

  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(scope, options));
    if (!raw) return fallbackVisibleColumnIds;

    const parsed = JSON.parse(raw) as PersistedTableColumnPreferenceState;
    const visibleColumnIds = normalizeIdList(parsed.visible_column_ids).filter((columnId) =>
      knownColumnIds.has(columnId)
    );
    const knownColumnIdsFromStorage = new Set(normalizeIdList(parsed.known_column_ids));
    const newlyDiscoveredColumnIds = knownColumnIdsFromStorage.size
      ? Array.from(knownColumnIds).filter((columnId) => !knownColumnIdsFromStorage.has(columnId))
      : [];
    const mergedVisibleColumnIds = uniqueIds([...visibleColumnIds, ...newlyDiscoveredColumnIds]);
    return mergedVisibleColumnIds.length ? mergedVisibleColumnIds : fallbackVisibleColumnIds;
  } catch {
    return fallbackVisibleColumnIds;
  }
}

export function persistTableColumnVisibility(args: {
  scope: TableColumnPreferenceScope;
  visibleColumnIds: string[];
  knownColumnIds: string[];
  options?: TableColumnPreferenceOptions;
}) {
  const { scope, visibleColumnIds, knownColumnIds, options } = args;
  if (typeof window === "undefined") return;

  const knownColumnIdSet = new Set(normalizeIdList(knownColumnIds));
  const normalizedVisibleColumnIds = uniqueIds(normalizeIdList(visibleColumnIds)).filter(
    (columnId) => knownColumnIdSet.has(columnId)
  );
  const normalizedKnownColumnIds = uniqueIds(normalizeIdList(knownColumnIds));

  try {
    window.localStorage.setItem(
      getScopedStorageKey(scope, options),
      JSON.stringify({
        visible_column_ids: normalizedVisibleColumnIds,
        known_column_ids: normalizedKnownColumnIds,
      })
    );
  } catch {
    // Ignore localStorage write failures.
  }
}
