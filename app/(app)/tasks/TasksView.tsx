"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TaskInlineRow from "./TaskInlineRow";
import type { TaskSortDir, TaskSortKey } from "@/lib/taskSorting";
import { setCsvParam } from "@/lib/queryParams";
import { formatTaskStatusLabel, normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { duePillClasses, getDueUrgency, priorityPillClasses } from "@/lib/taskIndicators";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuSingle,
} from "../_components/TableHeaderFilters";

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
  due_time?: string | null;
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
  openSubtaskCountByTaskId: Record<string, number>;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  dueOptions: readonly { value: string; label: string }[];
  initialView?: "table" | "gantt" | "board";
  returnTo: string;
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
  basePath?: string;
  fixedParams?: Record<string, string | null | undefined>;
};

const statusColors: Record<string, string> = {
  to_do: "bg-slate-400",
  backlog: "bg-slate-400",
  in_progress: "bg-blue-500",
  blocked: "bg-yellow-500",
  completed: "bg-green-500",
  cancelled: "bg-red-500",
};

type HeaderMenuKey = "client" | "project" | "status" | "priority" | "assignees" | "due";

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
  openSubtaskCountByTaskId,
  statusOptions,
  priorityOptions,
  dueOptions,
  initialView = "table",
  returnTo,
  initialFilters,
  onUpdate,
  hideCompleted,
  toggleUrl,
  sortKey,
  sortDir,
  basePath = "/tasks",
  fixedParams = {},
}: TasksViewProps) {
  const [view, setView] = useState<"table" | "gantt" | "board">(initialView);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusUpdateFormRef = useRef<HTMLFormElement | null>(null);
  const statusUpdateTaskIdRef = useRef<HTMLInputElement | null>(null);
  const statusUpdateStatusRef = useRef<HTMLInputElement | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

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

  const buildQuery = (
    next: typeof filters,
    nextSortKey: TaskSortKey,
    nextSortDir: TaskSortDir,
    nextView: typeof view,
    nextHideCompleted: boolean
  ) => {
    const params = new URLSearchParams();
    Object.entries(fixedParams).forEach(([key, value]) => {
      const normalized = String(value || "").trim();
      if (normalized) {
        params.set(key, normalized);
      }
    });
    setCsvParam(params, "status", next.status);
    setCsvParam(params, "priority", next.priority);
    setCsvParam(params, "assignee", next.assignee);
    setCsvParam(params, "client", next.client);
    setCsvParam(params, "project", next.project);
    if (next.due && next.due !== "all") params.set("due", next.due);
    params.set("hide", nextHideCompleted ? "1" : "0");
    params.set("sort", nextSortKey);
    params.set("dir", nextSortDir);
    if (nextView !== "table") {
      params.set("view", nextView);
    }
    return params.toString();
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next, sortKey, sortDir, view, hideCompleted);
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  const buildSortUrl = (key: TaskSortKey) => {
    const nextDir: TaskSortDir =
      sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(filters, key, nextDir, view, hideCompleted);
    return query ? `${basePath}?${query}` : basePath;
  };

  const applyView = (nextView: typeof view) => {
    setView(nextView);
    const query = buildQuery(filters, sortKey, sortDir, nextView, hideCompleted);
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
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

  const todayMarker = useMemo(() => {
    if (!ganttData.rangeDays) return null;
    const todayOffset = diffDays(ganttData.rangeStart, new Date());
    if (todayOffset < 0 || todayOffset > ganttData.rangeDays - 1) return null;
    return { leftPercent: (todayOffset / ganttData.rangeDays) * 100 };
  }, [ganttData.rangeDays, ganttData.rangeStart]);

  const boardTasksByStatus = useMemo(() => {
    const buckets = new Map<string, TaskRow[]>();
    statusOptions.forEach((status) => buckets.set(status, []));
    tasks.forEach((task) => {
      const normalized = normalizeTaskStatusOrDefault(task.status);
      const bucketKey = buckets.has(normalized)
        ? normalized
        : statusOptions[0] || normalized;
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.push(task);
      }
    });
    return buckets;
  }, [tasks, statusOptions]);

  const statusByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      map.set(task.id, normalizeTaskStatusOrDefault(task.status));
    });
    return map;
  }, [tasks]);

  const submitStatusUpdate = (taskId: string, status: string) => {
    if (!statusUpdateFormRef.current) return;
    if (!statusUpdateTaskIdRef.current || !statusUpdateStatusRef.current) return;
    statusUpdateTaskIdRef.current.value = taskId;
    statusUpdateStatusRef.current.value = status;
    statusUpdateFormRef.current.requestSubmit();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
          <a
            href={toggleUrl}
            onClick={(event) => {
              event.preventDefault();
              const query = buildQuery(
                filters,
                sortKey,
                sortDir,
                view,
                !hideCompleted
              );
              startTransition(() => {
                router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted ? "Show completed & cancelled" : "Hide completed & cancelled"}
          </a>
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
        </div>
      </div>

      {/* Hidden form for board drag-and-drop status changes. */}
      <form action={onUpdate} ref={statusUpdateFormRef} className="hidden">
        <input ref={statusUpdateTaskIdRef} type="hidden" name="task_id" defaultValue="" />
        <input ref={statusUpdateStatusRef} type="hidden" name="status" defaultValue="" />
        <input type="hidden" name="return_to" value={returnTo} />
      </form>

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
                <th className="px-6 py-3 text-right text-slate-700">Open subtasks</th>
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
                    openSubtaskCount={openSubtaskCountByTaskId[task.id] ?? 0}
                    assigneeUserIds={assigneesByTask[task.id] || []}
                    users={users}
                    clients={clients}
                    projects={projects}
                    statusOptions={statusOptions}
                    priorityOptions={priorityOptions}
                    onUpdate={onUpdate}
                    returnTo={returnTo}
                  />
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={9}>
                    No tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : view === "gantt" ? (
        <div className="overflow-x-auto">
          {tasks.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 240 }}>
              <div className="grid grid-cols-[240px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  Task
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
      ) : (
        <div className="overflow-x-auto">
          {tasks.length ? (
            <div className="min-w-full px-6 py-6">
              <div className="flex min-w-max gap-4">
                {statusOptions.map((status) => {
                  const columnTasks = boardTasksByStatus.get(status) || [];
                  const color = statusColors[status] || "bg-slate-400";
                  const isOver = dragOverStatus === status;

                  return (
                    <div
                      key={status}
                      className={`w-72 rounded-xl border border-slate-200 bg-slate-50/60 ${
                        isOver ? "ring-2 ring-slate-300" : ""
                      }`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverStatus(status);
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDragLeave={() => {
                        setDragOverStatus((current) => (current === status ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const taskId = event.dataTransfer.getData("text/plain");
                        setDragOverStatus(null);
                        if (!taskId) return;
                        const currentStatus = statusByTaskId.get(taskId);
                        if (currentStatus === status) return;
                        submitStatusUpdate(taskId, status);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {formatTaskStatusLabel(status)}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {columnTasks.length}
                        </span>
                      </div>

                      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
                        {columnTasks.length ? (
                          columnTasks.map((task) => {
                            const priority = (task.priority || "medium").toLowerCase();
                            const dueLabel = task.due_date
                              ? new Date(task.due_date).toLocaleDateString("en-US")
                              : "";
                            const dueUrgency = getDueUrgency(task.due_date, task.due_time ?? null);
                            const clientName = Array.isArray(task.clients)
                              ? task.clients[0]?.name
                              : task.clients?.name;
                            const projectName = Array.isArray(task.projects)
                              ? task.projects[0]?.name
                              : task.projects?.name;

                            return (
                              <div
                                key={task.id}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", task.id);
                                }}
                                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                              >
                                <Link
                                  href={`/tasks/${task.id}`}
                                  className="block text-sm font-semibold text-slate-900 hover:underline"
                                >
                                  {task.title}
                                </Link>

                                {(clientName || projectName) ? (
                                  <p className="mt-1 text-xs text-slate-500">
                                    {clientName || "Client N/A"}
                                    {projectName ? ` · ${projectName}` : ""}
                                  </p>
                                ) : null}

                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${priorityPillClasses(
                                      task.priority
                                    )}`}
                                  >
                                    {priority}
                                  </span>
                                  <span
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${duePillClasses(
                                      dueUrgency
                                    )}`}
                                  >
                                    {dueLabel ? `Due ${dueLabel}` : "No due date"}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="px-1 py-4 text-sm text-slate-500">
                            No tasks.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No tasks found.</div>
          )}
        </div>
      )}
    </>
  );
}

