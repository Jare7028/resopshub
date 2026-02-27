"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import MultiSelect from "../_components/MultiSelect";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";
import { formatFormLabel, type FormStatus } from "./types";

type FormRow = {
  id: string;
  title: string;
  description: string | null;
  status: FormStatus;
  created_at: string;
  updated_at: string;
  openSubmissions: number;
};

type FilterState = {
  q: string;
  status: string[];
};

type SortKey = "title" | "status" | "open_submissions" | "updated_at";
type SortDir = "asc" | "desc";
type HeaderMenuKey = "title" | "status";

function summarizeDescription(value: string | null, maxLength = 120) {
  if (!value) return "--";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "--";
  const firstStop = [".", "!", "?"]
    .map((char) => normalized.indexOf(char))
    .filter((index) => index >= 0);
  const sentenceEnd = firstStop.length ? Math.min(...firstStop) + 1 : normalized.length;
  const summary = normalized.slice(0, sentenceEnd).trim();
  if (summary.length <= maxLength) return summary;
  return `${summary.slice(0, maxLength - 3).trimEnd()}...`;
}

export default function FormsTable({
  rows,
  sortKey,
  sortDir,
  initialFilters,
  statusOptions,
  fixedParams = {},
}: {
  rows: FormRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  initialFilters: FilterState;
  statusOptions: readonly FormStatus[];
  fixedParams?: Record<string, string | null | undefined>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [mobileSearchInput, setMobileSearchInput] = useState(initialFilters.q);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef(filters);
  const searchDebounceTimerRef = useRef<number | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
    setMobileSearchInput(initialFilters.q);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    return () => {
      if (searchDebounceTimerRef.current) {
        window.clearTimeout(searchDebounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMenu]);

  const buildQuery = (nextFilters: FilterState, nextSortKey: SortKey, nextSortDir: SortDir) => {
    const params = new URLSearchParams();
    Object.entries(fixedParams).forEach(([key, value]) => {
      const normalized = String(value || "").trim();
      if (normalized) {
        params.set(key, normalized);
      }
    });
    if (nextFilters.q.trim()) {
      params.set("q", nextFilters.q.trim());
    }
    setCsvParam(params, "status", nextFilters.status);
    params.set("sort", nextSortKey);
    params.set("dir", nextSortDir);
    return params.toString();
  };

  const applyFilters = (nextFilters: FilterState) => {
    setFilters(nextFilters);
    setMobileSearchInput(nextFilters.q);
    const query = buildQuery(nextFilters, sortKey, sortDir);
    startTransition(() => {
      router.replace(query ? `/forms?${query}` : "/forms", { scroll: false });
    });
  };

  const applyMobileSearch = (nextQueryValue: string) => {
    setMobileSearchInput(nextQueryValue);
    if (searchDebounceTimerRef.current) {
      window.clearTimeout(searchDebounceTimerRef.current);
    }
    searchDebounceTimerRef.current = window.setTimeout(() => {
      applyFilters({ ...filtersRef.current, q: nextQueryValue });
    }, 250);
  };

  const buildSortUrl = (key: SortKey) => {
    const nextDir: SortDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir);
    return query ? `/forms?${query}` : "/forms";
  };

  const headerClass = (key: SortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;
  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    ) : null;

  const currentQuery = buildQuery(filters, sortKey, sortDir);
  const detailQuery = currentQuery
    ? `?return_to=${encodeURIComponent(`/forms?${currentQuery}`)}`
    : "";
  const openRow = (rowId: string) => {
    router.push(
      `/forms/${rowId}?tab=submissions&scope=all${detailQuery ? `&${detailQuery.replace(/^\?/, "")}` : ""}`
    );
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement | HTMLDivElement>, rowId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRow(rowId);
  };
  const handleRowKeyDownDiv = (event: KeyboardEvent<HTMLDivElement>, rowId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRow(rowId);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Forms</h2>
      </div>
      <div className="mobile-filter-panel md:hidden">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="block">Search</span>
            <input
              type="search"
              value={mobileSearchInput}
              onChange={(event) => applyMobileSearch(event.target.value)}
              placeholder="Search title or description"
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-700"
            />
          </label>
          <MultiSelect
            options={statusOptions.map((status) => ({
              value: status,
              label: formatFormLabel(status),
            }))}
            selectedValues={filters.status}
            placeholder="All statuses"
            onChange={(next) => applyFilters({ ...filters, status: next })}
          />
        </div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3">
                <div className="relative flex items-center justify-between gap-2">
                  <a href={buildSortUrl("title")} className={headerClass("title")}>
                    Title
                    {sortIndicator("title")}
                  </a>
                  <button
                    type="button"
                    aria-label="Filter title"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMenu((current) => (current === "title" ? null : "title"));
                    }}
                  >
                    <FilterIcon active={Boolean(filters.q.trim())} />
                  </button>
                  {openMenu === "title" ? (
                    <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                      <FilterMenuText
                        title="Title"
                        value={filters.q}
                        placeholder="Search title or description"
                        onApply={(next) => applyFilters({ ...filters, q: next })}
                        onClear={() => applyFilters({ ...filters, q: "" })}
                      />
                    </div>
                  ) : null}
                </div>
              </th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3 text-right">
                <a href={buildSortUrl("open_submissions")} className={headerClass("open_submissions")}>
                  Open submissions
                  {sortIndicator("open_submissions")}
                </a>
              </th>
              <th className="px-6 py-3">
                <div className="relative flex items-center justify-between gap-2">
                  <a href={buildSortUrl("status")} className={headerClass("status")}>
                    Status
                    {sortIndicator("status")}
                  </a>
                  <button
                    type="button"
                    aria-label="Filter status"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMenu((current) => (current === "status" ? null : "status"));
                    }}
                  >
                    <FilterIcon active={filters.status.length > 0} />
                  </button>
                  {openMenu === "status" ? (
                    <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                      <FilterMenuMulti
                        title="Status"
                        options={statusOptions.map((status) => ({
                          value: status,
                          label: formatFormLabel(status),
                        }))}
                        selectedValues={filters.status}
                        onChange={(next) => applyFilters({ ...filters, status: next })}
                        onClear={() => applyFilters({ ...filters, status: [] })}
                      />
                    </div>
                  ) : null}
                </div>
              </th>
              <th className="px-6 py-3">
                <a href={buildSortUrl("updated_at")} className={headerClass("updated_at")}>
                  Last updated
                  {sortIndicator("updated_at")}
                </a>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                  onClick={() => openRow(row.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, row.id)}
                >
                  <td className="px-6 py-3 font-semibold text-slate-900">
                    {row.title}
                  </td>
                  <td className="max-w-xl px-6 py-3 text-slate-600" title={row.description || ""}>
                    <p className="truncate">{summarizeDescription(row.description)}</p>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="inline-flex min-w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                      {row.openSubmissions}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-slate-700">{formatFormLabel(row.status)}</td>
                  <td className="px-6 py-3 text-slate-600">
                    {new Date(row.updated_at || row.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-6 py-6 text-sm text-slate-500" colSpan={5}>
                  No forms found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mobile-list-stack md:hidden">
        {rows.length ? (
            rows.map((row) => (
            <article
              key={`mobile-${row.id}`}
              role="button"
              tabIndex={0}
              className="mobile-list-card space-y-3 cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-900/20"
              onClick={() => openRow(row.id)}
              onKeyDown={(event) => handleRowKeyDownDiv(event, row.id)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900">{row.title}</h3>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  {formatFormLabel(row.status)}
                </span>
              </div>
              <p className="text-sm text-slate-700">{summarizeDescription(row.description)}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold">
                  {row.openSubmissions} open submissions
                </span>
                <span>Updated {new Date(row.updated_at || row.created_at).toLocaleDateString()}</span>
              </div>
            </article>
          ))
        ) : (
          <p className="mobile-empty-state">
            No forms found.
          </p>
        )}
      </div>
    </section>
  );
}
