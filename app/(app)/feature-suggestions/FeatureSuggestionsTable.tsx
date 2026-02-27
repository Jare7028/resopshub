"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCsvParam } from "@/lib/queryParams";
import {
  readDefaultViewMode,
  writeDefaultViewMode,
  type ViewPreferenceScope,
} from "@/lib/viewPreferences";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";
import FeatureSuggestionStatus from "./FeatureSuggestionStatus";
import FeatureSuggestionType from "./FeatureSuggestionType";
import {
  statusBarStyle,
  statusDotStyle,
} from "@/lib/statusColorStyles";

type SuggestionRow = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  type: string;
  created_at: string;
  closed_at: string | null;
  score: number;
  userVote: number;
  commentCount: number;
};

type FilterState = {
  status: string[];
  type: string[];
  q: string;
};

type FeatureSuggestionStatusOption = {
  value: string;
  position: number;
  isVisible: boolean;
  countsAsCompleted: boolean;
};

type SortKey = "title" | "status" | "type" | "score" | "created_at";
type SortDir = "asc" | "desc";

type HeaderMenuKey = "title" | "status" | "type";
const FILTER_NAV_DEBOUNCE_MS = 300;

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

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayStamp(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(start: Date, end: Date) {
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((toDayStamp(end) - toDayStamp(start)) / dayMs);
}

function formatTick(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateLabel(value: string | null | undefined) {
  const date = toDate(value);
  if (!date) return "--";
  return date.toLocaleDateString("en-US");
}

function VoteControls({
  suggestion,
  onVote,
  canEdit,
}: {
  suggestion: SuggestionRow;
  onVote: (formData: FormData) => Promise<void>;
  canEdit: boolean;
}) {
  return (
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
        disabled={!canEdit}
        className={`rounded-md px-2 py-1 text-xs font-semibold ${
          suggestion.userVote === 1
            ? "bg-slate-900 text-white"
            : "border border-slate-300 text-slate-700 hover:border-slate-400"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M8.3 3.3c.5-1.2 2.2-.8 2.2.5v2.8h4.2c1.1 0 1.9 1 1.7 2l-1.1 6.5a2 2 0 0 1-2 1.7H8a2 2 0 0 1-2-2V9.5l2.3-6.2ZM3.5 9.5a1 1 0 0 1 1-1H5v8H4.5a1 1 0 0 1-1-1v-6Z" />
        </svg>
      </button>
      <button
        type="submit"
        name="vote"
        value="down"
        title="Downvote"
        aria-label={`Downvote ${suggestion.title}`}
        disabled={!canEdit}
        className={`rounded-md px-2 py-1 text-xs font-semibold ${
          suggestion.userVote === -1
            ? "bg-slate-900 text-white"
            : "border border-slate-300 text-slate-700 hover:border-slate-400"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M11.7 16.7c-.5 1.2-2.2.8-2.2-.5v-2.8H5.3c-1.1 0-1.9-1-1.7-2l1.1-6.5a2 2 0 0 1 2-1.7H12a2 2 0 0 1 2 2v5.3l-2.3 6.2ZM16.5 10.5a1 1 0 0 1-1 1H15v-8h.5a1 1 0 0 1 1 1v6Z" />
        </svg>
      </button>
      <span className="ml-2 text-xs text-slate-500">{suggestion.commentCount} comments</span>
    </form>
  );
}

export default function FeatureSuggestionsTable({
  rows,
  hideCompleted,
  sortKey,
  sortDir,
  initialView = "table",
  initialFilters,
  statusOptions,
  statusColorMap = {},
  typeOptions,
  onVote,
  onUpdateStatus,
  onUpdateType,
  hasExplicitView = false,
  viewPreferenceScope = "feature-suggestions",
  canEdit = true,
}: {
  rows: SuggestionRow[];
  hideCompleted: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  initialView?: "table" | "gantt" | "board";
  initialFilters: FilterState;
  statusOptions: readonly FeatureSuggestionStatusOption[];
  statusColorMap?: Record<string, string>;
  typeOptions: readonly string[];
  onVote: (formData: FormData) => Promise<void>;
  onUpdateStatus: (formData: FormData) => Promise<void> | void;
  onUpdateType: (formData: FormData) => Promise<void> | void;
  hasExplicitView?: boolean;
  viewPreferenceScope?: ViewPreferenceScope;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [view, setView] = useState<"table" | "gantt" | "board">(initialView);
  const [defaultView, setDefaultView] = useState<"table" | "gantt" | "board" | null>(null);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pendingFilterNavTimerRef = useRef<number | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    return () => {
      if (pendingFilterNavTimerRef.current) {
        window.clearTimeout(pendingFilterNavTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

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
    nextView: "table" | "gantt" | "board",
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
    if (nextView !== "table") {
      params.set("view", nextView);
    }
    return params.toString();
  };

  const cancelPendingFilterNavigation = () => {
    if (!pendingFilterNavTimerRef.current) return;
    window.clearTimeout(pendingFilterNavTimerRef.current);
    pendingFilterNavTimerRef.current = null;
  };

  const navigateWithQuery = (query: string) => {
    startTransition(() => {
      router.replace(query ? `/feature-suggestions?${query}` : "/feature-suggestions", {
        scroll: false,
      });
    });
  };

  const applyFilters = (nextFilters: FilterState, options?: { immediate?: boolean }) => {
    const immediate = options?.immediate ?? false;
    setFilters(nextFilters);
    const query = buildQuery(nextFilters, sortKey, sortDir, view, hideCompleted);
    cancelPendingFilterNavigation();
    if (immediate) {
      navigateWithQuery(query);
      return;
    }
    pendingFilterNavTimerRef.current = window.setTimeout(() => {
      pendingFilterNavTimerRef.current = null;
      navigateWithQuery(query);
    }, FILTER_NAV_DEBOUNCE_MS);
  };

  const applyView = (nextView: "table" | "gantt" | "board") => {
    setView(nextView);
    cancelPendingFilterNavigation();
    const query = buildQuery(filters, sortKey, sortDir, nextView, hideCompleted);
    navigateWithQuery(query);
  };

  useEffect(() => {
    setDefaultView(readDefaultViewMode(viewPreferenceScope));
  }, [viewPreferenceScope]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (hasExplicitView) return;
    const savedDefaultView = readDefaultViewMode(viewPreferenceScope);
    if (savedDefaultView && savedDefaultView !== initialView) {
      applyView(savedDefaultView);
    }
  }, [hasExplicitView, initialView, viewPreferenceScope]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveDefaultView = () => {
    writeDefaultViewMode(viewPreferenceScope, view);
    setDefaultView(view);
  };

  const toggleHideCompleted = () => {
    cancelPendingFilterNavigation();
    const query = buildQuery(filters, sortKey, sortDir, view, !hideCompleted);
    navigateWithQuery(query);
  };

  const buildSortUrl = (key: SortKey) => {
    const nextDir: SortDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir, view, hideCompleted);
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

  const currentQuery = buildQuery(filters, sortKey, sortDir, view, hideCompleted);
  const detailQuery = currentQuery
    ? `?return_to=${encodeURIComponent(`/feature-suggestions?${currentQuery}`)}`
    : "";
  const getStatusColor = (status: string | null | undefined) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "#64748b";
    return statusColorMap[normalized] || statusColorMap[String(status || "")] || "#64748b";
  };

  const ganttData = useMemo(() => {
    const now = new Date();
    const normalized = rows.map((suggestion) => {
      const start = toDate(suggestion.created_at) ?? now;
      const closed = toDate(suggestion.closed_at);
      const end = closed && closed > start ? closed : now > start ? now : start;
      return { ...suggestion, start, end };
    });

    if (!normalized.length) {
      return {
        suggestions: [] as Array<SuggestionRow & { start: Date; end: Date }>,
        rangeStart: now,
        rangeEnd: now,
        rangeDays: 1,
      };
    }

    const rangeStart = normalized.reduce(
      (min, suggestion) => (suggestion.start < min ? suggestion.start : min),
      normalized[0].start
    );
    const rangeEnd = normalized.reduce(
      (max, suggestion) => (suggestion.end > max ? suggestion.end : max),
      normalized[0].end
    );
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
    return { suggestions: normalized, rangeStart, rangeEnd, rangeDays };
  }, [rows]);

  const timelineWidth = useMemo(() => {
    const dayWidth = 18;
    return Math.max(560, ganttData.rangeDays * dayWidth);
  }, [ganttData.rangeDays]);

  const timelineTicks = useMemo(() => {
    const ticks = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const offset = Math.round((ganttData.rangeDays - 1) * (i / steps));
      const tickDate = new Date(ganttData.rangeStart);
      tickDate.setDate(tickDate.getDate() + offset);
      ticks.push({ label: formatTick(tickDate), left: (i / steps) * 100 });
    }
    return ticks;
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const visibleStatusOptions = useMemo(
    () => statusOptions.filter((status) => status.isVisible),
    [statusOptions]
  );
  const statusOptionsForBoard = hideCompleted
    ? visibleStatusOptions.length
      ? visibleStatusOptions
      : statusOptions
    : statusOptions;
  const statusForFilters = statusOptionsForBoard;

  const boardSuggestionsByStatus = useMemo(() => {
    const buckets = new Map<string, SuggestionRow[]>();
    statusOptionsForBoard.forEach((status) => buckets.set(status.value, []));
    rows.forEach((suggestion) => {
      const bucketKey = buckets.has(suggestion.status)
        ? suggestion.status
        : statusOptionsForBoard[0]?.value || suggestion.status;
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.push(suggestion);
      }
    });
    return buckets;
  }, [rows, statusOptionsForBoard]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Ideas</h2>
          <button
            type="button"
            onClick={toggleHideCompleted}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted ? "Show closed" : "Hide closed"}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => applyView("table")}
            className={`rounded-md px-3 py-1.5 font-semibold ${
              view === "table"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => applyView("gantt")}
            className={`rounded-md px-3 py-1.5 font-semibold ${
              view === "gantt"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Gantt
          </button>
          <button
            type="button"
            onClick={() => applyView("board")}
            className={`rounded-md px-3 py-1.5 font-semibold ${
              view === "board"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Board
          </button>
          <button
            type="button"
            onClick={saveDefaultView}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              defaultView === view
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
            }`}
          >
            {defaultView === view ? "Default view" : "Set as default"}
          </button>
        </div>
      </div>

      {view === "table" ? (
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
                          options={statusForFilters.map((status) => ({
                            value: status.value,
                            label: formatStatusLabel(status.value),
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
                                statusColorMap={statusColorMap}
                                onUpdate={onUpdateStatus}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="px-6 py-3">
                              <FeatureSuggestionType
                                suggestionId={suggestion.id}
                                defaultType={suggestion.type}
                                typeOptions={typeOptions}
                                onUpdate={onUpdateType}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="px-6 py-3">
                              <VoteControls suggestion={suggestion} onVote={onVote} canEdit={canEdit} />
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
      ) : view === "gantt" ? (
        <div className="overflow-x-auto">
          {rows.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 320 }}>
              <div className="grid grid-cols-[320px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">Suggestion</div>
                <div className="relative px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  <div className="absolute inset-y-0 left-6 right-6 flex items-end">
                    {timelineTicks.map((tick) => (
                      <span
                        key={tick.label}
                        className="absolute bottom-0 -translate-x-1/2 text-[11px] text-slate-500"
                        style={{ left: `${tick.left}%` }}
                      >
                        {tick.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {ganttData.suggestions.map((suggestion) => {
                const startOffset = diffDays(ganttData.rangeStart, suggestion.start);
                const duration = Math.max(1, diffDays(suggestion.start, suggestion.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = getStatusColor(suggestion.status);
                return (
                  <div key={suggestion.id} className="grid grid-cols-[320px_1fr] border-b border-slate-100">
                    <div className="space-y-1 px-6 py-3 text-sm text-slate-900">
                      <Link
                        href={`/feature-suggestions/${suggestion.id}${detailQuery}`}
                        className="font-semibold hover:underline"
                      >
                        {suggestion.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        Opened {formatDateLabel(suggestion.created_at)}
                        {suggestion.closed_at ? ` - Closed ${formatDateLabel(suggestion.closed_at)}` : ""}
                      </p>
                    </div>
                    <div className="relative px-6 py-3">
                      <div className="relative h-8 rounded-md bg-slate-100">
                        <div
                          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${Math.max(widthPercent, 1)}%`,
                            ...statusBarStyle(barColor),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-6 py-6 text-sm text-slate-500">No suggestions found.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto p-4">
          {rows.length ? (
            <div className="flex min-w-max gap-4">
              {statusOptionsForBoard.map((status) => {
                const bucket = boardSuggestionsByStatus.get(status.value) || [];
                return (
                  <div key={status.value} className="w-[320px] rounded-lg border border-slate-200 bg-slate-50">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={statusDotStyle(getStatusColor(status.value))}
                        />
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {formatStatusLabel(status.value)}
                        </p>
                      </div>
                      <p className="text-sm text-slate-500">{bucket.length} items</p>
                    </div>
                    <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
                      {bucket.length ? (
                        bucket.map((suggestion) => (
                          <div key={suggestion.id} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                            <div>
                              <Link
                                href={`/feature-suggestions/${suggestion.id}${detailQuery}`}
                                className="text-sm font-semibold text-slate-900 hover:underline"
                              >
                                {suggestion.title}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">
                                {summarizeDescription(suggestion.details, 100)}
                              </p>
                            </div>
                            <div className="grid gap-2">
                              <FeatureSuggestionStatus
                                suggestionId={suggestion.id}
                                defaultStatus={suggestion.status}
                                statusOptions={statusOptions}
                                statusColorMap={statusColorMap}
                                onUpdate={onUpdateStatus}
                                disabled={!canEdit}
                              />
                              <FeatureSuggestionType
                                suggestionId={suggestion.id}
                                defaultType={suggestion.type}
                                typeOptions={typeOptions}
                                onUpdate={onUpdateType}
                                disabled={!canEdit}
                              />
                            </div>
                            <VoteControls suggestion={suggestion} onVote={onVote} canEdit={canEdit} />
                          </div>
                        ))
                      ) : (
                        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-500">
                          No suggestions
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-2 py-2 text-sm text-slate-500">No suggestions found.</p>
          )}
        </div>
      )}
    </section>
  );
}
