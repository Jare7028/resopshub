export const EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY = "employee_info_visible_fields_v1";
export const EMPLOYEE_INFO_VISIBILITY_EVENT = "employee-info-visibility-updated";

export type EmployeeInfoVisibilityState = {
  showClientColumn: boolean;
  visibleColumnIds: string[];
};

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
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

    const parsed = JSON.parse(raw) as {
      show_client_column?: boolean;
      visible_column_ids?: string[];
    };

    const showClientColumn =
      typeof parsed.show_client_column === "boolean"
        ? parsed.show_client_column
        : fallbackState.showClientColumn;
    const visibleColumnIds = Array.isArray(parsed.visible_column_ids)
      ? uniqueIds(
          parsed.visible_column_ids
            .map((value) => String(value || "").trim())
            .filter((value) => knownColumnIds.has(value))
        )
      : fallbackState.visibleColumnIds;

    return {
      showClientColumn,
      visibleColumnIds,
    };
  } catch {
    return fallbackState;
  }
}

export function persistEmployeeInfoVisibility(state: EmployeeInfoVisibilityState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY,
      JSON.stringify({
        show_client_column: state.showClientColumn,
        visible_column_ids: uniqueIds(state.visibleColumnIds),
      })
    );
  } catch {
    // Ignore localStorage write failures.
  }

  window.dispatchEvent(
    new CustomEvent<EmployeeInfoVisibilityState>(EMPLOYEE_INFO_VISIBILITY_EVENT, {
      detail: {
        showClientColumn: state.showClientColumn,
        visibleColumnIds: uniqueIds(state.visibleColumnIds),
      },
    })
  );
}
