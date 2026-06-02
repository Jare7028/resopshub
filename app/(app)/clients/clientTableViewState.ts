import { setCsvParam } from "@/lib/queryParams";

export const CLIENT_FILTER_PERSISTENCE_KEY_PREFIX = "resolvable.client-filters.v1";

export type ClientSortKey = "name" | "status" | "industry" | "start";
export type ClientSortDir = "asc" | "desc";
export type ClientViewMode = "table" | "gantt" | "board";

export type ClientFilterState = {
  q: string;
  status: string[];
  industry: string[];
};

export type ClientTableColumnId =
  | "name"
  | "active_employees"
  | "status"
  | "industry"
  | "account_owner"
  | "start"
  | "delete";

export type PersistedClientFilterState = ClientFilterState & {
  sortKey: ClientSortKey;
  sortDir: ClientSortDir;
  view: ClientViewMode;
};

type BuildClientListQueryInput = {
  filters: ClientFilterState;
  sortKey: ClientSortKey;
  sortDir: ClientSortDir;
  view: ClientViewMode;
};

const CLIENT_REQUIRED_COLUMN_IDS = new Set<ClientTableColumnId>(["name"]);

export function normalizeVisibleClientColumns(
  values: string[],
  knownColumnIds: ClientTableColumnId[]
) {
  const knownColumnIdSet = new Set<ClientTableColumnId>(knownColumnIds);
  const normalized = Array.from(
    new Set(
      values.filter((value): value is ClientTableColumnId =>
        knownColumnIdSet.has(value as ClientTableColumnId)
      )
    )
  );
  const withRequiredColumns = normalized.slice();
  CLIENT_REQUIRED_COLUMN_IDS.forEach((requiredColumnId) => {
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

export function normalizeClientSortKey(
  value: string | null | undefined,
  fallback: ClientSortKey
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "name" ||
    normalized === "status" ||
    normalized === "industry" ||
    normalized === "start"
  ) {
    return normalized;
  }
  return fallback;
}

export function normalizeClientSortDir(
  value: string | null | undefined,
  fallback: ClientSortDir
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return fallback;
}

export function buildClientFilterPersistenceKey({
  userId,
  scope,
}: {
  userId: string | null | undefined;
  scope: string | null | undefined;
}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;

  const rawScope = String(scope || "/clients")
    .trim()
    .toLowerCase();
  const normalizedScope = rawScope || "/clients";
  return `${CLIENT_FILTER_PERSISTENCE_KEY_PREFIX}:${normalizedUserId}:${normalizedScope}`;
}

export function buildClientListQuery({
  filters,
  sortKey,
  sortDir,
  view,
}: BuildClientListQueryInput) {
  const params = new URLSearchParams();
  const searchQuery = filters.q.trim();
  if (searchQuery) params.set("q", searchQuery);
  setCsvParam(params, "status", filters.status);
  setCsvParam(params, "industry", filters.industry);
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  if (view !== "table") params.set("view", view);
  return params.toString();
}

export function buildClientListUrl(basePath: string, input: BuildClientListQueryInput) {
  const query = buildClientListQuery(input);
  return query ? `${basePath}?${query}` : basePath;
}
