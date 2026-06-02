import { setCsvParam } from "@/lib/queryParams";

export const PROJECT_FILTER_PERSISTENCE_KEY_PREFIX = "resolvable.project-filters.v1";

export type ProjectSortKey =
  | "name"
  | "client"
  | "status"
  | "assignees"
  | "start"
  | "end"
  | "open_tasks"
  | "created";

export type ProjectSortDir = "asc" | "desc";

export type ProjectViewMode = "table" | "gantt" | "board";

export type ProjectFilterState = {
  client: string[];
  status: string[];
  assignee: string[];
};

export type ProjectTableColumnId =
  | "project"
  | "open_tasks"
  | "client"
  | "status"
  | "assignees"
  | "start"
  | "end";

export type PersistedProjectFilterState = ProjectFilterState & {
  hideCompleted: boolean;
  includeWatching: boolean;
  sortKey: ProjectSortKey;
  sortDir: ProjectSortDir;
  view: ProjectViewMode;
};

type BuildProjectListQueryInput = {
  filters: ProjectFilterState;
  sortKey: ProjectSortKey;
  sortDir: ProjectSortDir;
  view: ProjectViewMode;
  hideCompleted: boolean;
  includeWatching: boolean;
};

const PROJECT_REQUIRED_COLUMN_IDS = new Set<ProjectTableColumnId>(["project"]);

export function normalizeVisibleProjectColumns(
  values: string[],
  knownColumnIds: ProjectTableColumnId[]
) {
  const knownColumnIdSet = new Set<ProjectTableColumnId>(knownColumnIds);
  const normalized = Array.from(
    new Set(
      values.filter((value): value is ProjectTableColumnId =>
        knownColumnIdSet.has(value as ProjectTableColumnId)
      )
    )
  );
  const withRequiredColumns = normalized.slice();
  PROJECT_REQUIRED_COLUMN_IDS.forEach((requiredColumnId) => {
    if (!knownColumnIdSet.has(requiredColumnId)) return;
    if (!withRequiredColumns.includes(requiredColumnId)) {
      withRequiredColumns.unshift(requiredColumnId);
    }
  });
  return withRequiredColumns.length ? withRequiredColumns : knownColumnIds.slice();
}

export function normalizeStorageList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

export function filterAllowedValues(values: string[], allowedValues: Set<string>) {
  return values.filter((value) => allowedValues.has(value));
}

export function normalizeProjectSortKey(
  value: string | null | undefined,
  fallback: ProjectSortKey
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "name" ||
    normalized === "client" ||
    normalized === "status" ||
    normalized === "assignees" ||
    normalized === "start" ||
    normalized === "end" ||
    normalized === "open_tasks" ||
    normalized === "created"
  ) {
    return normalized as ProjectSortKey;
  }
  return fallback;
}

export function normalizeProjectSortDir(
  value: string | null | undefined,
  fallback: ProjectSortDir
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return fallback;
}

export function buildProjectFilterPersistenceKey({
  userId,
  scope,
}: {
  userId: string | null | undefined;
  scope: string | null | undefined;
}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;

  const rawScope = String(scope || "/projects")
    .trim()
    .toLowerCase();
  const normalizedScope = rawScope || "/projects";
  return `${PROJECT_FILTER_PERSISTENCE_KEY_PREFIX}:${normalizedUserId}:${normalizedScope}`;
}

export function buildProjectListQuery({
  filters,
  sortKey,
  sortDir,
  view,
  hideCompleted,
  includeWatching,
}: BuildProjectListQueryInput) {
  const params = new URLSearchParams();
  setCsvParam(params, "client", filters.client);
  setCsvParam(params, "status", filters.status);
  setCsvParam(params, "assignee", filters.assignee);
  params.set("hide", hideCompleted ? "1" : "0");
  if (includeWatching) params.set("watch", "1");
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  if (view !== "table") params.set("view", view);
  return params.toString();
}

export function buildProjectListUrl(basePath: string, input: BuildProjectListQueryInput) {
  const query = buildProjectListQuery(input);
  return query ? `${basePath}?${query}` : basePath;
}
