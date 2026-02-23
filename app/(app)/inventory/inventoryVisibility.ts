export const EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY = "inventory_visible_fields_v1";
const EMPLOYEE_INFO_FILTERS_STORAGE_KEY = "inventory_filters_v1";
export const EMPLOYEE_INFO_VISIBILITY_EVENT = "inventory-visibility-updated";

export type EmployeeInfoVisibilityState = {
  showClientColumn: boolean;
  visibleColumnIds: string[];
};

export type EmployeeInfoFiltersState = {
  fullNameFilter: string;
  clientFilters: string[];
  columnTextFilters: Record<string, string>;
  columnOptionFilters: Record<string, string[]>;
};

type PersistedEmployeeInfoVisibilityState = {
  show_client_column?: boolean;
  visible_column_ids?: string[];
  known_column_ids?: string[];
};

type PersistedEmployeeInfoFiltersState = {
  full_name_filter?: string;
  client_filters?: string[];
  column_text_filters?: Record<string, string>;
  column_option_filters?: Record<string, string[]>;
};

type EmployeeInfoPersistenceOptions = {
  userId?: string | null;
};

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

function normalizeUserId(userId?: string | null) {
  const normalized = String(userId || "").trim();
  return normalized || "anonymous";
}

function getScopedStorageKey(baseKey: string, options?: EmployeeInfoPersistenceOptions) {
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
    const normalized = normalizeIdList(rawValue);
    if (!normalized.length) return;
    result[columnId] = normalized;
  });
  return result;
}

export function readEmployeeInfoVisibility(
  knownColumnIds: Set<string>,
  fallbackState: EmployeeInfoVisibilityState,
  options?: EmployeeInfoPersistenceOptions
) {
  if (typeof window === "undefined") {
    return fallbackState;
  }

  try {
    const scopedKey = getScopedStorageKey(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY, options);
    const scopedRaw = window.localStorage.getItem(scopedKey);
    const legacyRaw = window.localStorage.getItem(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY);
    const raw = scopedRaw || legacyRaw;
    if (!raw) return fallbackState;

    const parsed = JSON.parse(raw) as PersistedEmployeeInfoVisibilityState;

    const showClientColumn =
      typeof parsed.show_client_column === "boolean"
        ? parsed.show_client_column
        : fallbackState.showClientColumn;
    const storedVisibleColumnIds = Array.isArray(parsed.visible_column_ids)
      ? uniqueIds(normalizeIdList(parsed.visible_column_ids).filter((value) => knownColumnIds.has(value)))
      : fallbackState.visibleColumnIds;

    const storedKnownColumnIds = Array.isArray(parsed.known_column_ids)
      ? new Set(normalizeIdList(parsed.known_column_ids))
      : null;
    const newlyDiscoveredColumnIds = storedKnownColumnIds
      ? Array.from(knownColumnIds).filter((columnId) => !storedKnownColumnIds.has(columnId))
      : [];
    const visibleColumnIds = uniqueIds([...storedVisibleColumnIds, ...newlyDiscoveredColumnIds]);

    return {
      showClientColumn,
      visibleColumnIds,
    };
  } catch {
    return fallbackState;
  }
}

export function persistEmployeeInfoVisibility(
  state: EmployeeInfoVisibilityState & { knownColumnIds?: string[] },
  options?: EmployeeInfoPersistenceOptions
) {
  if (typeof window === "undefined") return;

  const visibleColumnIds = uniqueIds(
    state.visibleColumnIds.map((value) => String(value || "").trim()).filter(Boolean)
  );
  const knownColumnIds = uniqueIds(
    (state.knownColumnIds || []).map((value) => String(value || "").trim()).filter(Boolean)
  );

  try {
    window.localStorage.setItem(
      getScopedStorageKey(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY, options),
      JSON.stringify({
        show_client_column: state.showClientColumn,
        visible_column_ids: visibleColumnIds,
        known_column_ids: knownColumnIds,
      })
    );
  } catch {
    // Ignore localStorage write failures.
  }

  window.dispatchEvent(
    new CustomEvent<EmployeeInfoVisibilityState>(EMPLOYEE_INFO_VISIBILITY_EVENT, {
      detail: {
        showClientColumn: state.showClientColumn,
        visibleColumnIds,
      },
    })
  );
}

export function readEmployeeInfoFilters(args: {
  knownColumnIds: Set<string>;
  knownClientIds: Set<string>;
  fallbackState: EmployeeInfoFiltersState;
  options?: EmployeeInfoPersistenceOptions;
}) {
  const { knownColumnIds, knownClientIds, fallbackState, options } = args;
  if (typeof window === "undefined") {
    return fallbackState;
  }

  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(EMPLOYEE_INFO_FILTERS_STORAGE_KEY, options));
    if (!raw) return fallbackState;

    const parsed = JSON.parse(raw) as PersistedEmployeeInfoFiltersState;
    const fullNameFilter = String(parsed.full_name_filter || "");
    const clientFilters = normalizeIdList(parsed.client_filters).filter((clientId) =>
      knownClientIds.has(clientId)
    );
    const columnTextFilters = normalizeTextFilterMap(parsed.column_text_filters, knownColumnIds);
    const columnOptionFilters = normalizeOptionFilterMap(parsed.column_option_filters, knownColumnIds);

    return {
      fullNameFilter,
      clientFilters,
      columnTextFilters,
      columnOptionFilters,
    };
  } catch {
    return fallbackState;
  }
}

export function persistEmployeeInfoFilters(args: {
  fullNameFilter: string;
  clientFilters: string[];
  columnTextFilters: Record<string, string>;
  columnOptionFilters: Record<string, string[]>;
  knownColumnIds: string[];
  knownClientIds: string[];
  options?: EmployeeInfoPersistenceOptions;
}) {
  if (typeof window === "undefined") return;

  const knownColumnIdSet = new Set(normalizeIdList(args.knownColumnIds));
  const knownClientIdSet = new Set(normalizeIdList(args.knownClientIds));
  const clientFilters = normalizeIdList(args.clientFilters).filter((clientId) =>
    knownClientIdSet.has(clientId)
  );
  const columnTextFilters = normalizeTextFilterMap(args.columnTextFilters, knownColumnIdSet);
  const columnOptionFilters = normalizeOptionFilterMap(args.columnOptionFilters, knownColumnIdSet);

  try {
    window.localStorage.setItem(
      getScopedStorageKey(EMPLOYEE_INFO_FILTERS_STORAGE_KEY, args.options),
      JSON.stringify({
        full_name_filter: String(args.fullNameFilter || ""),
        client_filters: clientFilters,
        column_text_filters: columnTextFilters,
        column_option_filters: columnOptionFilters,
      })
    );
  } catch {
    // Ignore localStorage write failures.
  }
}

