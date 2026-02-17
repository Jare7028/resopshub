export const EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY = "employee_info_visible_fields_v1";
export const EMPLOYEE_INFO_VISIBILITY_EVENT = "employee-info-visibility-updated";

export type EmployeeInfoVisibilityState = {
  showClientColumn: boolean;
  visibleColumnIds: string[];
};

type PersistedEmployeeInfoVisibilityState = {
  show_client_column?: boolean;
  visible_column_ids?: string[];
  known_column_ids?: string[];
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

export function readEmployeeInfoVisibility(
  knownColumnIds: Set<string>,
  fallbackState: EmployeeInfoVisibilityState
) {
  if (typeof window === "undefined") {
    return fallbackState;
  }

  try {
    const raw = window.localStorage.getItem(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY);
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
  state: EmployeeInfoVisibilityState & { knownColumnIds?: string[] }
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
      EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY,
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
