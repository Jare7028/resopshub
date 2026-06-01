import { parseCsvParam } from "@/lib/queryParams";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  type TaskSortDir,
  type TaskSortKey,
} from "@/lib/taskSorting";

export type TaskViewMode = "table" | "gantt" | "board";

export type TaskTablePreferenceRow = {
  status: string[] | null;
  priority: string[] | null;
  assignee: string[] | null;
  due: string | null;
  client: string[] | null;
  project: string[] | null;
  hide_completed: boolean | null;
  include_watching: boolean | null;
  sort_key: string | null;
  sort_dir: string | null;
  view_mode: string | null;
};

export type TaskTableSearchParams = {
  view?: string;
  status?: string | string[];
  priority?: string | string[];
  assignee?: string | string[];
  due?: string;
  client?: string | string[];
  project?: string | string[];
  hide?: string;
  watch?: string;
  sort?: string;
  dir?: string;
  q?: string;
  page?: string;
};

export type ResolvedTaskTableState = {
  selectedStatusesRaw: string[];
  selectedPrioritiesRaw: string[];
  selectedAssigneesRaw: string[];
  selectedClientIdsRaw: string[];
  selectedProjectIdsRaw: string[];
  selectedDue: string;
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
  selectedView: TaskViewMode;
  hasExplicitView: boolean;
  hasExplicitPreferenceParams: boolean;
  shouldUseSavedPreferences: boolean;
  searchQuery: string;
  currentPage: number;
};

function normalizePreferenceValues(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function isTaskViewMode(value: string): value is TaskViewMode {
  return value === "table" || value === "gantt" || value === "board";
}

export function hasExplicitTaskTablePreferenceParams(
  searchParams: TaskTableSearchParams | undefined
) {
  return (
    typeof searchParams?.status !== "undefined" ||
    typeof searchParams?.priority !== "undefined" ||
    typeof searchParams?.assignee !== "undefined" ||
    typeof searchParams?.due !== "undefined" ||
    typeof searchParams?.client !== "undefined" ||
    typeof searchParams?.project !== "undefined" ||
    typeof searchParams?.hide !== "undefined" ||
    typeof searchParams?.watch !== "undefined" ||
    typeof searchParams?.sort !== "undefined" ||
    typeof searchParams?.dir !== "undefined" ||
    typeof searchParams?.view !== "undefined"
  );
}

export function resolveTaskTableState({
  searchParams,
  preferences,
}: {
  searchParams?: TaskTableSearchParams;
  preferences?: TaskTablePreferenceRow | null;
}): ResolvedTaskTableState {
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const hasExplicitPreferenceParams = hasExplicitTaskTablePreferenceParams(searchParams);
  const shouldUseSavedPreferences = Boolean(preferences) && !hasExplicitPreferenceParams;

  const viewRaw = String(
    hasExplicitView
      ? searchParams?.view || ""
      : shouldUseSavedPreferences
        ? preferences?.view_mode || ""
        : ""
  )
    .trim()
    .toLowerCase();
  const selectedView = isTaskViewMode(viewRaw) ? viewRaw : "table";

  const sortKey = normalizeTaskSortKey(
    typeof searchParams?.sort !== "undefined"
      ? searchParams.sort
      : shouldUseSavedPreferences
        ? preferences?.sort_key
        : undefined
  );
  const sortDir = normalizeTaskSortDir(
    typeof searchParams?.dir !== "undefined"
      ? searchParams.dir
      : shouldUseSavedPreferences
        ? preferences?.sort_dir
        : undefined
  );

  const selectedStatusesRaw =
    typeof searchParams?.status !== "undefined"
      ? parseCsvParam(searchParams.status)
      : shouldUseSavedPreferences
        ? normalizePreferenceValues(preferences?.status)
        : [];
  const selectedPrioritiesRaw =
    typeof searchParams?.priority !== "undefined"
      ? parseCsvParam(searchParams.priority)
      : shouldUseSavedPreferences
        ? normalizePreferenceValues(preferences?.priority)
        : [];
  const selectedAssigneesRaw =
    typeof searchParams?.assignee !== "undefined"
      ? parseCsvParam(searchParams.assignee)
      : shouldUseSavedPreferences
        ? normalizePreferenceValues(preferences?.assignee)
        : [];
  const selectedClientIdsRaw =
    typeof searchParams?.client !== "undefined"
      ? parseCsvParam(searchParams.client)
      : shouldUseSavedPreferences
        ? normalizePreferenceValues(preferences?.client)
        : [];
  const selectedProjectIdsRaw =
    typeof searchParams?.project !== "undefined"
      ? parseCsvParam(searchParams.project)
      : shouldUseSavedPreferences
        ? normalizePreferenceValues(preferences?.project)
        : [];

  const selectedDue = String(
    typeof searchParams?.due !== "undefined"
      ? searchParams.due || "all"
      : shouldUseSavedPreferences
        ? preferences?.due || "all"
        : "all"
  ).trim();
  const hideCompleted =
    typeof searchParams?.hide !== "undefined"
      ? String(searchParams.hide || "1").trim() !== "0"
      : shouldUseSavedPreferences
        ? Boolean(preferences?.hide_completed ?? true)
        : true;
  const includeWatching =
    typeof searchParams?.watch !== "undefined"
      ? String(searchParams.watch || "0").trim() === "1"
      : shouldUseSavedPreferences
        ? Boolean(preferences?.include_watching ?? false)
        : false;
  const currentPageRaw = Number.parseInt(String(searchParams?.page || "1"), 10);
  const currentPage =
    Number.isFinite(currentPageRaw) && currentPageRaw > 0 ? currentPageRaw : 1;

  return {
    selectedStatusesRaw,
    selectedPrioritiesRaw,
    selectedAssigneesRaw,
    selectedClientIdsRaw,
    selectedProjectIdsRaw,
    selectedDue,
    hideCompleted,
    includeWatching,
    sortKey,
    sortDir,
    selectedView,
    hasExplicitView,
    hasExplicitPreferenceParams,
    shouldUseSavedPreferences,
    searchQuery: String(searchParams?.q || "").trim(),
    currentPage,
  };
}
