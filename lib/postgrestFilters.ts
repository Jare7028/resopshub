const POSTGREST_FILTER_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function normalizeFilterText(value: string) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLikePattern(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function quotePostgrestFilterValue(value: string) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildPostgrestIlikeContainsFilter(column: string, value: string) {
  if (!POSTGREST_FILTER_COLUMN_PATTERN.test(column)) {
    throw new Error(`Invalid PostgREST filter column: ${column}`);
  }

  const normalized = normalizeFilterText(value);
  if (!normalized) return null;

  return `${column}.ilike.${quotePostgrestFilterValue(`%${escapeLikePattern(normalized)}%`)}`;
}

export function buildPostgrestOrFilter(filters: Array<string | null | undefined | false>) {
  return filters.filter((filter): filter is string => Boolean(filter)).join(",");
}
