"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TaskInlineRow from "./TaskInlineRow";
import type { TaskSortDir, TaskSortKey } from "@/lib/taskSorting";
import { setCsvParam } from "@/lib/queryParams";
import { formatTaskStatusLabel } from "@/lib/taskStatus";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ClientOption = {
  id: string;
  name: string;
};

type ProjectOption = {
  id: string;
  name: string;
  client_id: string | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  created_at: string | null;
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type TasksViewProps = {
  tasks: TaskRow[];
  users: UserOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  assigneesByTask: Record<string, string[]>;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  dueOptions: readonly { value: string; label: string }[];
  initialFilters: {
    status: string[];
    priority: string[];
    assignee: string[];
    due: string;
    client: string[];
    project: string[];
  };
  onUpdate: (formData: FormData) => void;
  hideCompleted: boolean;
  toggleUrl: string;
  sortKey: TaskSortKey;
  sortDir: TaskSortDir;
};

const statusColors: Record<string, string> = {
  to_do: "bg-slate-400",
  backlog: "bg-slate-400",
  in_progress: "bg-blue-500",
  blocked: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-rose-400",
};

type HeaderMenuKey = "client" | "project" | "status" | "priority" | "assignees" | "due";

function FilterIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] leading-none ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
      }`}
      title={active ? "Filter applied" : "Filter"}
    >
      v
    </span>
  );
}

type FilterOption = { value: string; label: string };

function FilterMenuMulti({
  title,
  options,
  selectedValues,
  onChange,
  onClear,
}: {
  title: string;
  options: readonly FilterOption[];
  selectedValues: readonly string[];
  onChange: (next: string[]) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  };

  const selectAll = () => {
    onChange(options.map((o) => o.value));
  };

  return (
    <div className="w-72 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={selectAll}
          >
            All
          </button>
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="border-b border-slate-100 px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search..."
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
        />
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {filteredOptions.length ? (
          filteredOptions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={selectedSet.has(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span className="leading-5">{option.label}</span>
            </label>
          ))
        ) : (
          <p className="px-2 py-2 text-sm text-slate-500">No matches</p>
        )}
      </div>
    </div>
  );
}

function FilterMenuSingle({
  title,
  options,
  value,
  onChange,
  onClear,
}: {
  title: string;
  options: readonly FilterOption[];
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="w-64 rounded-md border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="p-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={`filter-${title}`}
              className="mt-1 h-4 w-4 border-slate-300"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="leading-5">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

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

export default function TasksView({
  tasks,
  users,
  clients,
  projects,
  assigneesByTask,
  statusOptions,
  priorityOptions,
  dueOptions,
  initialFilters,
  onUpdate,
  hideCompleted,
  toggleUrl,
  sortKey,
  sortDir,
}: TasksViewProps) {
  const [view, setView] = useState<"table" | "gantt">("table");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  const buildQuery = (next: typeof filters, nextSortKey: TaskSortKey, nextSortDir: TaskSortDir) => {
    const params = new URLSearchParams();
    setCsvParam(params, "status", next.status);
    setCsvParam(params, "priority", next.priority);
    setCsvParam(params, "assignee", next.assignee);
    setCsvParam(params, "client", next.client);
    setCsvParam(params, "project", next.project);
    if (next.due && next.due !== "all") params.set("due", next.due);
    params.set("hide", hideCompleted ? "1" : "0");
    params.set("sort", nextSortKey);
    params.set("dir", nextSortDir);
    return params.toString();
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next, sortKey, sortDir);
    startTransition(() => {
      router.replace(query ? `/tasks?${query}` : "/tasks", { scroll: false });
    });
  };

  const buildSortUrl = (key: TaskSortKey) => {
    const nextDir: TaskSortDir =
      sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir);
    return query ? `/tasks?${query}` : "/tasks";
  };

  const headerClass = (key: TaskSortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;

  const sortIndicator = (key: TaskSortKey) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    );
  };

  const ganttData = useMemo(() => {
    const normalized = tasks.map((task) => {
      const startDate =
        toDate(task.start_date) ??
        toDate(task.created_at) ??
        toDate(task.due_date) ??
        new Date();
      const dueDate = toDate(task.due_date) ?? startDate;
      const start = startDate;
      const end = dueDate < start ? start : dueDate;
      return { ...task, start, end };
    });

    if (!normalized.length) {
      const today = new Date();
      return {
        tasks: [],
        rangeStart: today,
        rangeEnd: today,
        rangeDays: 1,
      };
    }

    const rangeStart = normalized.reduce((min, task) =>
      task.start < min ? task.start : min
    , normalized[0].start);
    const rangeEnd = normalized.reduce((max, task) =>
      task.end > max ? task.end : max
    , normalized[0].end);
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);

    return { tasks: normalized, rangeStart, rangeEnd, rangeDays };
  }, [tasks]);

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

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
          <a
            href={toggleUrl}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted ? "Show completed & cancelled" : "Hide completed & cancelled"}
          </a>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setView("table")}
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
            onClick={() => setView("gantt")}
            className={`rounded-md px-3 py-1.5 font-semibold ${
              view === "gantt"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
          >
            Gantt
          </button>
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">
                  <a href={buildSortUrl("title")} className={headerClass("title")}>
                    Task
                    {sortIndicator("title")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <div className="relative flex items-center justify-between gap-2">
                    <a href={buildSortUrl("client")} className={headerClass("client")}>
                      Client
                      {sortIndicator("client")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter client"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) => (current === "client" ? null : "client"));
                      }}
                    >
                      <FilterIcon active={filters.client.length > 0} />
                    </button>
                    {openMenu === "client" ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuMulti
                          title="Client"
                          options={clients.map((client) => ({
                            value: client.id,
                            label: client.name,
                          }))}
                          selectedValues={filters.client}
                          onChange={(next) => applyFilters({ ...filters, client: next })}
                          onClear={() => applyFilters({ ...filters, client: [] })}
                        />
                      </div>
                    ) : null}
                  </div>
                </th>
                <th className="px-6 py-3">
                  <div className="relative flex items-center justify-between gap-2">
                    <a href={buildSortUrl("project")} className={headerClass("project")}>
                      Project
                      {sortIndicator("project")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter project"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) => (current === "project" ? null : "project"));
                      }}
                    >
                      <FilterIcon active={filters.project.length > 0} />
                    </button>
                    {openMenu === "project" ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuMulti
                          title="Project"
                          options={projects.map((project) => {
                            const clientName = Array.isArray(project.clients)
                              ? project.clients[0]?.name
                              : project.clients?.name;
                            const label = clientName
                              ? `${project.name} - ${clientName}`
                              : project.name;
                            return { value: project.id, label };
                          })}
                          selectedValues={filters.project}
                          onChange={(next) => applyFilters({ ...filters, project: next })}
                          onClear={() => applyFilters({ ...filters, project: [] })}
                        />
                      </div>
                    ) : null}
                  </div>
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
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuMulti
                          title="Status"
                          options={statusOptions.map((status) => ({
                            value: status,
                            label: formatTaskStatusLabel(status),
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
                    <a
                      href={buildSortUrl("priority")}
                      className={headerClass("priority")}
                    >
                      Priority
                      {sortIndicator("priority")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter priority"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) =>
                          current === "priority" ? null : "priority"
                        );
                      }}
                    >
                      <FilterIcon active={filters.priority.length > 0} />
                    </button>
                    {openMenu === "priority" ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuMulti
                          title="Priority"
                          options={priorityOptions.map((priority) => ({
                            value: priority,
                            label: priority,
                          }))}
                          selectedValues={filters.priority}
                          onChange={(next) => applyFilters({ ...filters, priority: next })}
                          onClear={() => applyFilters({ ...filters, priority: [] })}
                        />
                      </div>
                    ) : null}
                  </div>
                </th>
                <th className="px-6 py-3">
                  <div className="relative flex items-center justify-between gap-2">
                    <a
                      href={buildSortUrl("assignees")}
                      className={headerClass("assignees")}
                    >
                      Assignees
                      {sortIndicator("assignees")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter assignees"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) =>
                          current === "assignees" ? null : "assignees"
                        );
                      }}
                    >
                      <FilterIcon active={filters.assignee.length > 0} />
                    </button>
                    {openMenu === "assignees" ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuMulti
                          title="Assignees"
                          options={[
                            { value: "unassigned", label: "Unassigned" },
                            ...users.map((user) => ({
                              value: user.id,
                              label: user.full_name || user.email || "Unnamed user",
                            })),
                          ]}
                          selectedValues={filters.assignee}
                          onChange={(next) => applyFilters({ ...filters, assignee: next })}
                          onClear={() => applyFilters({ ...filters, assignee: [] })}
                        />
                      </div>
                    ) : null}
                  </div>
                </th>
                <th className="px-6 py-3">
                  <a href={buildSortUrl("start")} className={headerClass("start")}>
                    Start
                    {sortIndicator("start")}
                  </a>
                </th>
                <th className="px-6 py-3">
                  <div className="relative flex items-center justify-between gap-2">
                    <a href={buildSortUrl("due")} className={headerClass("due")}>
                      Due
                      {sortIndicator("due")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter due"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) => (current === "due" ? null : "due"));
                      }}
                    >
                      <FilterIcon active={filters.due !== "all"} />
                    </button>
                    {openMenu === "due" ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-30 mt-2"
                      >
                        <FilterMenuSingle
                          title="Due"
                          options={dueOptions.map((opt) => ({
                            value: opt.value,
                            label: opt.label,
                          }))}
                          value={filters.due}
                          onChange={(next) => applyFilters({ ...filters, due: next })}
                          onClear={() => applyFilters({ ...filters, due: "all" })}
                        />
                      </div>
                    ) : null}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.length ? (
                tasks.map((task) => (
                  <TaskInlineRow
                    key={task.id}
                    task={task}
                    assigneeUserIds={assigneesByTask[task.id] || []}
                    users={users}
                    clients={clients}
                    projects={projects}
                    statusOptions={statusOptions}
                    priorityOptions={priorityOptions}
                    onUpdate={onUpdate}
                  />
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={8}>
                    No tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {tasks.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 240 }}>
              <div className="grid grid-cols-[240px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  Task
                </div>
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

              {ganttData.tasks.map((task) => {
                const startOffset = diffDays(ganttData.rangeStart, task.start);
                const duration = Math.max(1, diffDays(task.start, task.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = statusColors[task.status || ""] || "bg-slate-400";

                return (
                  <div
                    key={task.id}
                    className="grid grid-cols-[240px_1fr] border-b border-slate-100"
                  >
                    <div className="px-6 py-3 text-sm text-slate-900">
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        {task.title}
                      </Link>
                    </div>
                    <div className="relative px-6 py-3">
                      <div className="absolute inset-y-0 left-6 right-6">
                        <Link
                          href={`/tasks/${task.id}`}
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${barColor}`}
                          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                          aria-label={`Open ${task.title}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No tasks found.</div>
          )}
        </div>
      )}
    </>
  );
}

