"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";
import FeatureSuggestionStatus from "./FeatureSuggestionStatus";

type SuggestionRow = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  type: string;
  created_at: string;
  score: number;
  userVote: number;
  commentCount: number;
};

type FilterState = {
  status: string[];
  type: string[];
  q: string;
};

type SortKey = "title" | "status" | "type" | "score" | "created_at";
type SortDir = "asc" | "desc";

type HeaderMenuKey = "title" | "status" | "type";

const formatStatusLabel = (status: string) =>
  status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatTypeLabel = (type: string) =>
  type
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const summarizeDescription = (value: string | null, maxLength = 120) => {
  if (!value) return "--";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "--";

  const punctuationIndexes = [".", "!", "?"]
    .map((char) => normalized.indexOf(char))
    .filter((index) => index >= 0);
  const firstSentenceEnd = punctuationIndexes.length
    ? Math.min(...punctuationIndexes) + 1
    : normalized.length;

  let summary = normalized.slice(0, firstSentenceEnd).trim();
  if (summary.length > maxLength) {
    summary = `${summary.slice(0, maxLength - 3).trimEnd()}...`;
  }
  return summary;
};

export default function FeatureSuggestionsTable({
  rows,
  hideCompleted,
  sortKey,
  sortDir,
  initialFilters,
  statusOptions,
  typeOptions,
  onVote,
  onUpdateStatus,
}: {
  rows: SuggestionRow[];
  hideCompleted: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  initialFilters: FilterState;
  statusOptions: readonly string[];
  typeOptions: readonly string[];
  onVote: (formData: FormData) => Promise<void>;
  onUpdateStatus: (formData: FormData) => Promise<void> | void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    if (!openMenu) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
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

  const buildQuery = (
    nextFilters: FilterState,
    nextSortKey: SortKey,
    nextSortDir: SortDir,
    nextHideCompleted: boolean
  ) => {
    const params = new URLSearchParams();
    setCsvParam(params, "status", nextFilters.status);
    setCsvParam(params, "type", nextFilters.type);
    if (nextFilters.q.trim()) {
      params.set("q", nextFilters.q.trim());
    }
    params.set("hide", nextHideCompleted ? "1" : "0");
    params.set("sort", nextSortKey);
    params.set("dir", nextSortDir);
    return params.toString();
  };

  const applyFilters = (nextFilters: FilterState) => {
    setFilters(nextFilters);
    const query = buildQuery(nextFilters, sortKey, sortDir, hideCompleted);
    startTransition(() => {
      router.replace(query ? `/feature-suggestions?${query}` : "/feature-suggestions", {
        scroll: false,
      });
    });
  };

  const toggleHideCompleted = () => {
    const query = buildQuery(filters, sortKey, sortDir, !hideCompleted);
    startTransition(() => {
      router.replace(query ? `/feature-suggestions?${query}` : "/feature-suggestions", {
        scroll: false,
      });
    });
  };

  const buildSortUrl = (key: SortKey) => {
    const nextDir: SortDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir, hideCompleted);
    return query ? `/feature-suggestions?${query}` : "/feature-suggestions";
  };

  const headerClass = (key: SortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    );
  };

  const currentQuery = buildQuery(filters, sortKey, sortDir, hideCompleted);
  const detailQuery = currentQuery ? `?return_to=${encodeURIComponent(`/feature-suggestions?${currentQuery}`)}` : "";

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Ideas</h2>
        <button
          type="button"
          onClick={toggleHideCompleted}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          {hideCompleted ? "Show completed/rejected" : "Hide completed/rejected"}
        </button>
      </div>

      <div className="overflow-x-auto">
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
                          label: formatStatusLabel(status),
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
                <div className="relative flex items-center justify-between gap-2">
                  <a href={buildSortUrl("type")} className={headerClass("type")}>
                    Type
                    {sortIndicator("type")}
                  </a>
                  <button
                    type="button"
                    aria-label="Filter type"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMenu((current) => (current === "type" ? null : "type"));
                    }}
                  >
                    <FilterIcon active={filters.type.length > 0} />
                  </button>
                  {openMenu === "type" ? (
                    <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                      <FilterMenuMulti
                        title="Type"
                        options={typeOptions.map((type) => ({
                          value: type,
                          label: formatTypeLabel(type),
                        }))}
                        selectedValues={filters.type}
                        onChange={(next) => applyFilters({ ...filters, type: next })}
                        onClear={() => applyFilters({ ...filters, type: [] })}
                      />
                    </div>
                  ) : null}
                </div>
              </th>
              <th className="px-6 py-3 text-right">
                <a href={buildSortUrl("score")} className={headerClass("score")}>
                  Score
                  {sortIndicator("score")}
                </a>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length ? (
              rows.map((suggestion) => (
                <tr key={suggestion.id}>
                  <td className="px-6 py-3 font-semibold text-slate-900">
                    <Link
                      href={`/feature-suggestions/${suggestion.id}${detailQuery}`}
                      className="hover:underline"
                    >
                      {suggestion.title}
                    </Link>
                  </td>
                  <td className="max-w-xl px-6 py-3 text-slate-600" title={suggestion.details || ""}>
                    <p className="truncate">{summarizeDescription(suggestion.details)}</p>
                  </td>
                  <td className="px-6 py-3">
                    <FeatureSuggestionStatus
                      suggestionId={suggestion.id}
                      defaultStatus={suggestion.status}
                      statusOptions={statusOptions}
                      onUpdate={onUpdateStatus}
                    />
                  </td>
                  <td className="px-6 py-3 text-slate-700">{formatTypeLabel(suggestion.type)}</td>
                  <td className="px-6 py-3">
                    <form action={onVote} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="suggestion_id" value={suggestion.id} />
                      <span className="min-w-8 text-right text-sm font-semibold text-slate-700">
                        {suggestion.score}
                      </span>
                      <button
                        type="submit"
                        name="vote"
                        value="up"
                        title="Upvote"
                        aria-label={`Upvote ${suggestion.title}`}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          suggestion.userVote === 1
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 text-slate-700 hover:border-slate-400"
                        }`}
                      >
                        {"\u{1F44D}"}
                      </button>
                      <button
                        type="submit"
                        name="vote"
                        value="down"
                        title="Downvote"
                        aria-label={`Downvote ${suggestion.title}`}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          suggestion.userVote === -1
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 text-slate-700 hover:border-slate-400"
                        }`}
                      >
                        {"\u{1F44E}"}
                      </button>
                      <span className="ml-2 text-xs text-slate-500">
                        {suggestion.commentCount} comments
                      </span>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-6 py-6 text-sm text-slate-500" colSpan={5}>
                  No suggestions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
