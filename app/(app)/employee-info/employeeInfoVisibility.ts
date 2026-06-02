import {
  getScopedTablePreferenceStorageKey,
  readTableFiltersState,
  readTableVisibilityState,
  serializeTableFiltersState,
  serializeTableVisibilityState,
  type TableFiltersState,
  type TablePreferencePersistenceOptions,
  type TableVisibilityState,
} from "@/lib/tablePreferenceState";

export const EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY = "employee_info_visible_fields_v1";
const EMPLOYEE_INFO_FILTERS_STORAGE_KEY = "employee_info_filters_v1";
export const EMPLOYEE_INFO_VISIBILITY_EVENT = "employee-info-visibility-updated";

export type EmployeeInfoVisibilityState = TableVisibilityState;
export type EmployeeInfoFiltersState = TableFiltersState;
type EmployeeInfoPersistenceOptions = TablePreferencePersistenceOptions;

export function readEmployeeInfoVisibility(
  knownColumnIds: Set<string>,
  fallbackState: EmployeeInfoVisibilityState,
  options?: EmployeeInfoPersistenceOptions
) {
  if (typeof window === "undefined") {
    return fallbackState;
  }

  return readTableVisibilityState({
    scopedRaw: window.localStorage.getItem(
      getScopedTablePreferenceStorageKey(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY, options)
    ),
    legacyRaw: window.localStorage.getItem(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY),
    knownColumnIds,
    fallbackState,
  });
}

export function persistEmployeeInfoVisibility(
  state: EmployeeInfoVisibilityState & { knownColumnIds?: string[] },
  options?: EmployeeInfoPersistenceOptions
) {
  if (typeof window === "undefined") return;

  const serialized = serializeTableVisibilityState({ state });

  try {
    window.localStorage.setItem(
      getScopedTablePreferenceStorageKey(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY, options),
      serialized.json
    );
  } catch {
    // Ignore localStorage write failures.
  }

  window.dispatchEvent(
    new CustomEvent<EmployeeInfoVisibilityState>(EMPLOYEE_INFO_VISIBILITY_EVENT, {
      detail: {
        showClientColumn: state.showClientColumn,
        visibleColumnIds: serialized.visibleColumnIds,
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
  if (typeof window === "undefined") {
    return args.fallbackState;
  }

  return readTableFiltersState({
    raw: window.localStorage.getItem(
      getScopedTablePreferenceStorageKey(EMPLOYEE_INFO_FILTERS_STORAGE_KEY, args.options)
    ),
    knownColumnIds: args.knownColumnIds,
    knownClientIds: args.knownClientIds,
    fallbackState: args.fallbackState,
  });
}

export function persistEmployeeInfoFilters(args: EmployeeInfoFiltersState & {
  knownColumnIds: string[];
  knownClientIds: string[];
  options?: EmployeeInfoPersistenceOptions;
}) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getScopedTablePreferenceStorageKey(EMPLOYEE_INFO_FILTERS_STORAGE_KEY, args.options),
      serializeTableFiltersState(args)
    );
  } catch {
    // Ignore localStorage write failures.
  }
}
