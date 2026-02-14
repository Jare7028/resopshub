export type ViewMode = "table" | "gantt" | "board";

export type ViewPreferenceScope =
  | "tasks"
  | "projects"
  | "clients"
  | "feature-suggestions";

const VIEW_PREFERENCE_PREFIX = "resolvable.default-view.";

export function isViewMode(value: string | null | undefined): value is ViewMode {
  return value === "table" || value === "gantt" || value === "board";
}

function getStorageKey(scope: ViewPreferenceScope) {
  return `${VIEW_PREFERENCE_PREFIX}${scope}`;
}

export function readDefaultViewMode(scope: ViewPreferenceScope): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(getStorageKey(scope));
    return isViewMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeDefaultViewMode(scope: ViewPreferenceScope, view: ViewMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getStorageKey(scope), view);
  } catch {
    // ignore storage failures (private mode, disabled storage, etc.)
  }
}
