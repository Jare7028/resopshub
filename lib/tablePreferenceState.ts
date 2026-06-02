export type TableVisibilityState = {
  showClientColumn: boolean;
  visibleColumnIds: string[];
};

export type TableFiltersState = {
  fullNameFilter: string;
  clientFilters: string[];
  columnTextFilters: Record<string, string>;
  columnOptionFilters: Record<string, string[]>;
};

export type TablePreferencePersistenceOptions = {
  userId?: string | null;
};

type PersistedTableVisibilityState = {
  show_client_column?: boolean;
  visible_column_ids?: string[];
  known_column_ids?: string[];
};

type PersistedTableFiltersState = {
  full_name_filter?: string;
  client_filters?: string[];
  column_text_filters?: Record<string, string>;
  column_option_filters?: Record<string, string[]>;
};

export function uniqueTablePreferenceIds(values: string[]) {
  return Array.from(new Set(values));
}

export function normalizeTablePreferenceIdList(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  return uniqueTablePreferenceIds(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function normalizeUserId(userId?: string | null) {
  const normalized = String(userId || "").trim();
  return normalized || "anonymous";
}

export function getScopedTablePreferenceStorageKey(
  baseKey: string,
  options?: TablePreferencePersistenceOptions
) {
  return `${baseKey}:${normalizeUserId(options?.userId)}`;
}

function normalizeTextFilterMap(value: unknown, knownColumnIds: Set<string>) {
  if (!value || typeof value !== "object") return {} as Record<string, string>;
  const result: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([columnId, rawValue]) => {
    if (!knownColumnIds.has(columnId)) return;
    const normalized = String(rawValue || "");
    if (!normalized.trim()) return;
    result[columnId] = normalized;
  });
  return result;
}

function normalizeOptionFilterMap(value: unknown, knownColumnIds: Set<string>) {
  if (!value || typeof value !== "object") return {} as Record<string, string[]>;
  const result: Record<string, string[]> = {};
  Object.entries(value as Record<string, unknown>).forEach(([columnId, rawValue]) => {
    if (!knownColumnIds.has(columnId)) return;
    const normalized = normalizeTablePreferenceIdList(rawValue);
    if (!normalized.length) return;
    result[columnId] = normalized;
  });
  return result;
}

export function readTableVisibilityState(args: {
  scopedRaw?: string | null;
  legacyRaw?: string | null;
  knownColumnIds: Set<string>;
  fallbackState: TableVisibilityState;
  addNewColumnsWithoutStoredKnownIds?: boolean;
}) {
  const raw = args.scopedRaw || args.legacyRaw;
  if (!raw) return args.fallbackState;

  try {
    const parsed = JSON.parse(raw) as PersistedTableVisibilityState;

    const showClientColumn =
      typeof parsed.show_client_column === "boolean"
        ? parsed.show_client_column
        : args.fallbackState.showClientColumn;
    const storedVisibleColumnIds = Array.isArray(parsed.visible_column_ids)
      ? uniqueTablePreferenceIds(
          normalizeTablePreferenceIdList(parsed.visible_column_ids).filter((value) =>
            args.knownColumnIds.has(value)
          )
        )
      : args.fallbackState.visibleColumnIds;

    const storedKnownColumnIds = Array.isArray(parsed.known_column_ids)
      ? new Set(normalizeTablePreferenceIdList(parsed.known_column_ids))
      : null;
    const newlyDiscoveredColumnIds = Array.from(args.knownColumnIds).filter((columnId) =>
      storedKnownColumnIds
        ? !storedKnownColumnIds.has(columnId)
        : args.addNewColumnsWithoutStoredKnownIds && !storedVisibleColumnIds.includes(columnId)
    );

    return {
      showClientColumn,
      visibleColumnIds: uniqueTablePreferenceIds([
        ...storedVisibleColumnIds,
        ...newlyDiscoveredColumnIds,
      ]),
    };
  } catch {
    return args.fallbackState;
  }
}

export function serializeTableVisibilityState(args: {
  state: TableVisibilityState & { knownColumnIds?: string[] };
  existingRaw?: string | null;
  preserveNewColumnsFromExistingKnownIds?: boolean;
}) {
  const visibleColumnIds = uniqueTablePreferenceIds(
    args.state.visibleColumnIds.map((value) => String(value || "").trim()).filter(Boolean)
  );
  const knownColumnIds = uniqueTablePreferenceIds(
    (args.state.knownColumnIds || []).map((value) => String(value || "").trim()).filter(Boolean)
  );
  let nextVisibleColumnIds = visibleColumnIds;

  if (args.preserveNewColumnsFromExistingKnownIds && args.existingRaw) {
    try {
      const existingParsed = JSON.parse(args.existingRaw) as PersistedTableVisibilityState;
      const existingKnownColumnIds = new Set(
        normalizeTablePreferenceIdList(existingParsed.known_column_ids)
      );
      const newlyDiscoveredColumnIds = knownColumnIds.filter(
        (columnId) => !existingKnownColumnIds.has(columnId)
      );
      nextVisibleColumnIds = uniqueTablePreferenceIds([
        ...visibleColumnIds,
        ...newlyDiscoveredColumnIds,
      ]);
    } catch {
      nextVisibleColumnIds = visibleColumnIds;
    }
  }

  return {
    visibleColumnIds: nextVisibleColumnIds,
    json: JSON.stringify({
      show_client_column: args.state.showClientColumn,
      visible_column_ids: nextVisibleColumnIds,
      known_column_ids: knownColumnIds,
    }),
  };
}

export function readTableFiltersState(args: {
  raw?: string | null;
  knownColumnIds: Set<string>;
  knownClientIds: Set<string>;
  fallbackState: TableFiltersState;
}) {
  if (!args.raw) return args.fallbackState;

  try {
    const parsed = JSON.parse(args.raw) as PersistedTableFiltersState;
    const fullNameFilter = String(parsed.full_name_filter || "");
    const clientFilters = normalizeTablePreferenceIdList(parsed.client_filters).filter((clientId) =>
      args.knownClientIds.has(clientId)
    );
    const columnTextFilters = normalizeTextFilterMap(parsed.column_text_filters, args.knownColumnIds);
    const columnOptionFilters = normalizeOptionFilterMap(
      parsed.column_option_filters,
      args.knownColumnIds
    );

    return {
      fullNameFilter,
      clientFilters,
      columnTextFilters,
      columnOptionFilters,
    };
  } catch {
    return args.fallbackState;
  }
}

export function serializeTableFiltersState(args: TableFiltersState & {
  knownColumnIds: string[];
  knownClientIds: string[];
}) {
  const knownColumnIdSet = new Set(normalizeTablePreferenceIdList(args.knownColumnIds));
  const knownClientIdSet = new Set(normalizeTablePreferenceIdList(args.knownClientIds));
  const clientFilters = normalizeTablePreferenceIdList(args.clientFilters).filter((clientId) =>
    knownClientIdSet.has(clientId)
  );
  const columnTextFilters = normalizeTextFilterMap(args.columnTextFilters, knownColumnIdSet);
  const columnOptionFilters = normalizeOptionFilterMap(args.columnOptionFilters, knownColumnIdSet);

  return JSON.stringify({
    full_name_filter: String(args.fullNameFilter || ""),
    client_filters: clientFilters,
    column_text_filters: columnTextFilters,
    column_option_filters: columnOptionFilters,
  });
}
