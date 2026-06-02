import { setCsvParam } from "@/lib/queryParams";

export const FORMS_PAGE_SIZE = 50;

export const formsSortKeys = ["title", "status", "open_submissions", "updated_at"] as const;
export const formsSortDirs = ["asc", "desc"] as const;

export type FormsSortKey = (typeof formsSortKeys)[number];
export type FormsSortDir = (typeof formsSortDirs)[number];

export function normalizeFormsSortKey(value: string | undefined): FormsSortKey {
  if (value === "title" || value === "status" || value === "open_submissions") {
    return value;
  }
  return "updated_at";
}

export function normalizeFormsSortDir(
  value: string | undefined,
  sortKey: FormsSortKey
): FormsSortDir {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return sortKey === "title" || sortKey === "status" ? "asc" : "desc";
}

export function normalizeFormsPageNumber(value: string | undefined) {
  const parsed = Number(value || "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function buildFormsListUrl({
  q,
  statuses,
  sortKey,
  sortDir,
  page,
}: {
  q: string;
  statuses: string[];
  sortKey: FormsSortKey;
  sortDir: FormsSortDir;
  page?: number;
}) {
  const params = new URLSearchParams();
  const query = q.trim();
  if (query) params.set("q", query);
  setCsvParam(params, "status", statuses);
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  if (page && page > 1) {
    params.set("page", String(Math.floor(page)));
  }
  const qs = params.toString();
  return qs ? `/forms?${qs}` : "/forms";
}
