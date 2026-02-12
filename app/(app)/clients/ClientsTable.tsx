"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDelete from "../_components/ConfirmDelete";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";

type ClientRow = {
  id: string;
  name: string;
  status: string | null;
  industry: string | null;
  account_owner: string | null;
  start_date: string | null;
  end_date: string | null;
};

type HeaderMenuKey = "name" | "status" | "industry";
type ClientSortKey = "name" | "status" | "industry" | "start";
type ClientSortDir = "asc" | "desc";

function toDate(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
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

export default function ClientsTable({
  clients,
  statusOptions,
  initialFilters,
  sortKey,
  sortDir,
  initialView = "table",
  onDelete,
}: {
  clients: ClientRow[];
  statusOptions: readonly string[];
  initialFilters: { q: string; status: string[]; industry: string[] };
  sortKey: ClientSortKey;
  sortDir: ClientSortDir;
  initialView?: "table" | "board" | "gantt";
  onDelete: (formData: FormData) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useState<"table" | "board" | "gantt">(initialView);
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

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

  const industryOptions = useMemo(() => {
    const values = new Set<string>();
    clients.forEach((client) => {
      if (client.industry) values.add(client.industry);
    });
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [clients]);

  const buildQuery = (next: typeof filters) => {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    setCsvParam(params, "status", next.status);
    setCsvParam(params, "industry", next.industry);
    params.set("sort", sortKey);
    params.set("dir", sortDir);
    if (view !== "table") params.set("view", view);
    return params.toString();
  };

  const buildSortUrl = (nextSortKey: ClientSortKey) => {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    setCsvParam(params, "status", filters.status);
    setCsvParam(params, "industry", filters.industry);
    params.set("sort", nextSortKey);
    params.set("dir", sortKey === nextSortKey && sortDir === "asc" ? "desc" : "asc");
    if (view !== "table") params.set("view", view);
    const query = params.toString();
    return query ? `/clients?${query}` : "/clients";
  };

  const headerClass = (key: ClientSortKey) =>
    `font-semibold hover:text-slate-900 ${sortKey === key ? "text-slate-900" : "text-slate-500"}`;

  const sortIndicator = (key: ClientSortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-[10px]">{sortDir === "asc" ? "^" : "v"}</span>;
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next);
    startTransition(() => {
      router.replace(query ? `/clients?${query}` : "/clients", { scroll: false });
    });
  };

  const applyView = (nextView: typeof view) => {
    setView(nextView);
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    setCsvParam(params, "status", filters.status);
    setCsvParam(params, "industry", filters.industry);
    params.set("sort", sortKey);
    params.set("dir", sortDir);
    if (nextView !== "table") params.set("view", nextView);
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `/clients?${query}` : "/clients", { scroll: false });
    });
  };

  const statusColors: Record<string, string> = {
    prospect: "bg-indigo-500",
    active: "bg-green-500",
    on_hold: "bg-yellow-500",
    offboarded: "bg-slate-500",
  };

  const boardByStatus = useMemo(() => {
    const buckets = new Map<string, ClientRow[]>();
    statusOptions.forEach((status) => buckets.set(status, []));
    clients.forEach((client) => {
      const status = client.status || "prospect";
      const bucketKey = buckets.has(status) ? status : statusOptions[0];
      if (!bucketKey) return;
      buckets.get(bucketKey)?.push(client);
    });
    return buckets;
  }, [clients, statusOptions]);

  const ganttData = useMemo(() => {
    const today = new Date();
    const normalized = clients
      .map((client) => {
        const start = toDate(client.start_date);
        if (!start) return null;
        const end = toDate(client.end_date) ?? today;
        return {
          ...client,
          start,
          end: end < start ? start : end,
        };
      })
      .filter((client): client is ClientRow & { start: Date; end: Date } => Boolean(client));

    if (!normalized.length) {
      return { clients: [], rangeStart: today, rangeEnd: today, rangeDays: 1 };
    }

    const rangeStart = normalized.reduce((min, client) =>
      client.start < min ? client.start : min
    , normalized[0].start);
    const rangeEnd = normalized.reduce((max, client) =>
      client.end > max ? client.end : max
    , normalized[0].end);
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
    return { clients: normalized, rangeStart, rangeEnd, rangeDays };
  }, [clients]);

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

  const todayMarker = useMemo(() => {
    const todayOffset = diffDays(ganttData.rangeStart, new Date());
    if (todayOffset < 0 || todayOffset > ganttData.rangeDays - 1) return null;
    return { leftPercent: (todayOffset / ganttData.rangeDays) * 100 };
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  return (
    <div>
      <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-6 py-4 text-sm">
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
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <a href={buildSortUrl("name")} className={headerClass("name")}>
                  Client {sortIndicator("name")}
                </a>
                <button
                  type="button"
                  aria-label="Filter client name"
                  onClick={() =>
                    setOpenMenu((current) => (current === "name" ? null : "name"))
                  }
                >
                  <FilterIcon active={Boolean(filters.q.trim())} />
                </button>
                {openMenu === "name" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuText
                      title="Client"
                      value={filters.q}
                      placeholder="Search by name..."
                      onApply={(next) => {
                        applyFilters({ ...filters, q: next });
                        setOpenMenu(null);
                      }}
                      onClear={() => {
                        applyFilters({ ...filters, q: "" });
                        setOpenMenu(null);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <a href={buildSortUrl("status")} className={headerClass("status")}>
                  Status {sortIndicator("status")}
                </a>
                <button
                  type="button"
                  aria-label="Filter status"
                  onClick={() =>
                    setOpenMenu((current) => (current === "status" ? null : "status"))
                  }
                >
                  <FilterIcon active={filters.status.length > 0} />
                </button>
                {openMenu === "status" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Status"
                      options={statusOptions.map((status) => ({
                        value: status,
                        label: status.replaceAll("_", " "),
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
                <a href={buildSortUrl("industry")} className={headerClass("industry")}>
                  Industry {sortIndicator("industry")}
                </a>
                <button
                  type="button"
                  aria-label="Filter industry"
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === "industry" ? null : "industry"
                    )
                  }
                >
                  <FilterIcon active={filters.industry.length > 0} />
                </button>
                {openMenu === "industry" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Industry"
                      options={industryOptions}
                      selectedValues={filters.industry}
                      onChange={(next) => applyFilters({ ...filters, industry: next })}
                      onClear={() => applyFilters({ ...filters, industry: [] })}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <span className="text-slate-700">Account owner</span>
            </th>
            <th className="px-6 py-3">
              <a href={buildSortUrl("start")} className={headerClass("start")}>
                Start date {sortIndicator("start")}
              </a>
            </th>
            <th className="px-6 py-3 text-slate-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.length ? (
            clients.map((client) => (
              <tr key={client.id} className="border-t border-slate-200">
                <td className="px-6 py-3 font-medium text-slate-900">
                  <Link href={`/clients/${client.id}`} className="hover:underline">
                    {client.name}
                  </Link>
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {client.status?.replaceAll("_", " ") || "-"}
                </td>
                <td className="px-6 py-3 text-slate-600">{client.industry || "-"}</td>
                <td className="px-6 py-3 text-slate-600">
                  {client.account_owner || "-"}
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {client.start_date
                    ? new Date(client.start_date).toLocaleDateString("en-US")
                    : "-"}
                </td>
                <td className="px-6 py-3">
                  <form action={onDelete}>
                    <input type="hidden" name="client_id" value={client.id} />
                    <ConfirmDelete name={client.name} itemType="Client" />
                  </form>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={6}>
                No clients found.
              </td>
            </tr>
          )}
        </tbody>
          </table>
        </div>
      ) : view === "board" ? (
        <div className="overflow-x-auto px-6 py-6">
          <div className="flex min-w-max gap-4">
            {statusOptions.map((status) => {
              const columnClients = boardByStatus.get(status) || [];
              const color = statusColors[status] || "bg-slate-400";
              return (
                <div
                  key={status}
                  className="w-72 rounded-xl border border-slate-200 bg-slate-50/60"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {columnClients.length}
                    </span>
                  </div>
                  <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
                    {columnClients.length ? (
                      columnClients.map((client) => (
                        <div
                          key={client.id}
                          className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                        >
                          <Link
                            href={`/clients/${client.id}`}
                            className="block text-sm font-semibold text-slate-900 hover:underline"
                          >
                            {client.name}
                          </Link>
                          <p className="mt-1 text-xs text-slate-500">
                            {client.industry || "No industry"}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
                              {client.account_owner || "No owner"}
                            </span>
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
                              {client.start_date
                                ? `Start ${new Date(client.start_date).toLocaleDateString("en-US")}`
                                : "No start date"}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="px-1 py-4 text-sm text-slate-500">No clients.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {ganttData.clients.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 240 }}>
              <div className="grid grid-cols-[240px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  Client
                </div>
                <div className="relative px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  <div className="absolute inset-y-0 left-6 right-6 flex items-end">
                    {todayMarker ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 border-l border-dashed opacity-60"
                        style={{
                          left: `${todayMarker.leftPercent}%`,
                          borderColor: "#6954e2",
                        }}
                      />
                    ) : null}
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

              {ganttData.clients.map((client) => {
                const startOffset = diffDays(ganttData.rangeStart, client.start);
                const duration = Math.max(1, diffDays(client.start, client.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = statusColors[client.status || ""] || "bg-slate-400";
                return (
                  <div
                    key={client.id}
                    className="grid grid-cols-[240px_1fr] border-b border-slate-100"
                  >
                    <div className="px-6 py-3 text-sm text-slate-900">
                      <Link href={`/clients/${client.id}`} className="hover:underline">
                        {client.name}
                      </Link>
                    </div>
                    <div className="relative px-6 py-3">
                      <div className="absolute inset-y-0 left-6 right-6">
                        {todayMarker ? (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 border-l border-dashed opacity-60"
                            style={{
                              left: `${todayMarker.leftPercent}%`,
                              borderColor: "#6954e2",
                            }}
                          />
                        ) : null}
                        <Link
                          href={`/clients/${client.id}`}
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${barColor}`}
                          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                          aria-label={`Open ${client.name}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">
              No clients with a start date found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
