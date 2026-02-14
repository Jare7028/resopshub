"use client";

import Link from "next/link";
import {
  Fragment,
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { setCsvParam } from "@/lib/queryParams";
import AssigneeMultiSelect from "../tasks/_components/AssigneeMultiSelect";
import {
  readDefaultViewMode,
  writeDefaultViewMode,
  type ViewPreferenceScope,
} from "@/lib/viewPreferences";
import { FilterIcon, FilterMenuMulti } from "../_components/TableHeaderFilters";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ClientOption = {
  id: string;
  name: string;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
  client_id: string | null;
  clients?: { name?: string | null } | { name?: string | null }[] | null;
};

type OpenProjectTaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assignee_user_ids: string[];
};

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

type ProjectsViewProps = {
  projects: ProjectRow[];
  users: UserOption[];
  clients: ClientOption[];
  assigneesByProject: Record<string, string[]>;
  openTaskCountByProjectId: Record<string, number>;
  openTasksByProjectId?: Record<string, OpenProjectTaskRow[]>;
  statusOptions: readonly string[];
  initialView?: "table" | "gantt" | "board";
  initialFilters: {
    client: string[];
    status: string[];
    assignee: string[];
  };
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  hideCompleted: boolean;
  toggleUrl: string;
  includeWatching: boolean;
  watchToggleUrl: string;
  sortKey: ProjectSortKey;
  sortDir: ProjectSortDir;
  basePath?: string;
  hasExplicitView?: boolean;
  viewPreferenceScope?: ViewPreferenceScope;
};

type HeaderMenuKey = "client" | "status" | "assignees";

const statusColors: Record<string, string> = {
  planned: "bg-slate-400",
  active: "bg-blue-500",
  on_hold: "bg-yellow-500",
  completed: "bg-green-500",
  cancelled: "bg-red-500",
};

function formatProjectStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown";
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

export default function ProjectsView({
  projects,
  users,
  clients,
  assigneesByProject,
  openTaskCountByProjectId,
  openTasksByProjectId = {},
  statusOptions,
  initialView = "table",
  initialFilters,
  onUpdate,
  hideCompleted,
  toggleUrl,
  includeWatching,
  watchToggleUrl,
  sortKey,
  sortDir,
  basePath = "/projects",
  hasExplicitView = false,
  viewPreferenceScope = "projects",
}: ProjectsViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useState<"table" | "gantt" | "board">(initialView);
  const [defaultView, setDefaultView] = useState<"table" | "gantt" | "board" | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    const validIds = new Set(projects.map((project) => project.id));
    setExpandedProjectIds((current) => {
      const next = new Set<string>();
      current.forEach((projectId) => {
        if (validIds.has(projectId)) {
          next.add(projectId);
        }
      });
      return next.size === current.size ? current : next;
    });
  }, [projects]);

  useEffect(() => {
    if (!openMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) setOpenMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMenu]);

  const usersById = useMemo(
    () =>
      users.reduce<Record<string, string>>((acc, user) => {
        acc[user.id] = user.full_name || user.email || "Unknown user";
        return acc;
      }, {}),
    [users]
  );

  const clientNameById = useMemo(
    () =>
      clients.reduce<Record<string, string>>((acc, client) => {
        acc[client.id] = client.name;
        return acc;
      }, {}),
    [clients]
  );

  const buildQuery = (
    nextFilters: typeof filters,
    nextSortKey: ProjectSortKey,
    nextSortDir: ProjectSortDir,
    nextView: typeof view,
    nextHideCompleted: boolean,
    nextIncludeWatching: boolean
  ) => {
    const params = new URLSearchParams();
    setCsvParam(params, "client", nextFilters.client);
    setCsvParam(params, "status", nextFilters.status);
    setCsvParam(params, "assignee", nextFilters.assignee);
    params.set("hide", nextHideCompleted ? "1" : "0");
    if (nextIncludeWatching) params.set("watch", "1");
    params.set("sort", nextSortKey);
    params.set("dir", nextSortDir);
    if (nextView !== "table") params.set("view", nextView);
    return params.toString();
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(
      next,
      sortKey,
      sortDir,
      view,
      hideCompleted,
      includeWatching
    );
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  const buildSortUrl = (key: ProjectSortKey) => {
    const nextDir: ProjectSortDir =
      sortKey === key && sortDir === "asc" ? "desc" : "asc";
    const query = buildQuery(
      filters,
      key,
      nextDir,
      view,
      hideCompleted,
      includeWatching
    );
    return query ? `${basePath}?${query}` : basePath;
  };

  const applyView = (nextView: typeof view) => {
    setView(nextView);
    const query = buildQuery(
      filters,
      sortKey,
      sortDir,
      nextView,
      hideCompleted,
      includeWatching
    );
    startTransition(() => {
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const savedDefaultView = readDefaultViewMode(viewPreferenceScope);
    setDefaultView(savedDefaultView);
    if (!hasExplicitView && savedDefaultView && savedDefaultView !== view) {
      applyView(savedDefaultView);
    }
  }, [hasExplicitView, view, viewPreferenceScope]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveDefaultView = () => {
    writeDefaultViewMode(viewPreferenceScope, view);
    setDefaultView(view);
  };

  const headerClass = (key: ProjectSortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;
  const sortIndicator = (key: ProjectSortKey) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    );
  };

  const projectStatusById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => map.set(project.id, String(project.status || "planned")));
    return map;
  }, [projects]);

  const boardProjectsByStatus = useMemo(() => {
    const buckets = new Map<string, ProjectRow[]>();
    statusOptions.forEach((status) => buckets.set(status, []));
    projects.forEach((project) => {
      const normalized = String(project.status || "planned");
      const bucketKey = buckets.has(normalized) ? normalized : statusOptions[0] || normalized;
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(project);
    });
    return buckets;
  }, [projects, statusOptions]);

  const ganttData = useMemo(() => {
    const normalized = projects.map((project) => {
      const startDate =
        toDate(project.start_date) ??
        toDate(project.created_at) ??
        toDate(project.end_date) ??
        new Date();
      const endDate = toDate(project.end_date) ?? startDate;
      const start = startDate;
      const end = endDate < start ? start : endDate;
      return { ...project, start, end };
    });

    if (!normalized.length) {
      const today = new Date();
      return { projects: [], rangeStart: today, rangeDays: 1 };
    }

    const rangeStart = normalized.reduce(
      (min, project) => (project.start < min ? project.start : min),
      normalized[0].start
    );
    const rangeEnd = normalized.reduce(
      (max, project) => (project.end > max ? project.end : max),
      normalized[0].end
    );
    const rangeDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
    return { projects: normalized, rangeStart, rangeDays };
  }, [projects]);

  const timelineWidth = useMemo(() => {
    const dayWidth = 20;
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

  const submitStatusUpdate = (projectId: string, status: string) => {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("status", status);
    startTransition(() => {
      void onUpdate(formData);
    });
  };

  const handleInlineChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    const form = event.currentTarget.form;
    if (!form) return;
    const formData = new FormData(form);
    startTransition(() => {
      void onUpdate(formData);
    });
  };

  const handleAssigneesChange = (projectId: string, selectedUserIds: string[]) => {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("assignees_updated", "1");
    selectedUserIds.forEach((userId) => {
      if (userId) {
        formData.append("assignee_user_ids", userId);
      }
    });
    startTransition(() => {
      void onUpdate(formData);
    });
  };

  const toggleProjectTasks = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const getAssigneeLabel = (userIds: string[]) => {
    if (!userIds.length) {
      return "Unassigned";
    }
    if (userIds.length > 1) {
      return `${usersById[userIds[0]] || "Assigned"} +${userIds.length - 1}`;
    }
    return usersById[userIds[0]] || "Assigned";
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          <a
            href={toggleUrl}
            onClick={(event) => {
              event.preventDefault();
              const query = buildQuery(
                filters,
                sortKey,
                sortDir,
                view,
                !hideCompleted,
                includeWatching
              );
              startTransition(() => {
                router.replace(query ? `${basePath}?${query}` : basePath, {
                  scroll: false,
                });
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            {hideCompleted
              ? "Show completed & cancelled"
              : "Hide completed & cancelled"}
          </a>
          <a
            href={watchToggleUrl}
            onClick={(event) => {
              event.preventDefault();
              const query = buildQuery(
                filters,
                sortKey,
                sortDir,
                view,
                hideCompleted,
                !includeWatching
              );
              startTransition(() => {
                router.replace(query ? `${basePath}?${query}` : basePath, {
                  scroll: false,
                });
              });
            }}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              includeWatching
                ? "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 hover:text-blue-800"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
            }`}
          >
            {includeWatching
              ? "Hide Projects I'm watching"
              : "Show Projects I'm watching"}
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
                  <a href={buildSortUrl("name")} className={headerClass("name")}>
                    Project
                    {sortIndicator("name")}
                  </a>
                </th>
                <th className="px-6 py-3 text-right">
                  <a
                    href={buildSortUrl("open_tasks")}
                    className={`${headerClass("open_tasks")} justify-end`}
                  >
                    Open tasks
                    {sortIndicator("open_tasks")}
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
                      onClick={() =>
                        setOpenMenu((current) =>
                          current === "client" ? null : "client"
                        )
                      }
                    >
                      <FilterIcon active={filters.client.length > 0} />
                    </button>
                    {openMenu === "client" ? (
                      <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
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
                    <a href={buildSortUrl("status")} className={headerClass("status")}>
                      Status
                      {sortIndicator("status")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter status"
                      onClick={() =>
                        setOpenMenu((current) =>
                          current === "status" ? null : "status"
                        )
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
                            label: formatProjectStatusLabel(status),
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
                    <a href={buildSortUrl("assignees")} className={headerClass("assignees")}>
                      Assignees
                      {sortIndicator("assignees")}
                    </a>
                    <button
                      type="button"
                      aria-label="Filter assignees"
                      onClick={() =>
                        setOpenMenu((current) =>
                          current === "assignees" ? null : "assignees"
                        )
                      }
                    >
                      <FilterIcon active={filters.assignee.length > 0} />
                    </button>
                    {openMenu === "assignees" ? (
                      <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
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
                  <a href={buildSortUrl("end")} className={headerClass("end")}>
                    End
                    {sortIndicator("end")}
                  </a>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.length ? (
                projects.map((project) => {
                  const assigneeIds = assigneesByProject[project.id] || [];

                  return (
                    <Fragment key={project.id}>
                      <tr className="border-t border-slate-200">
                        <td className="px-6 py-3 font-medium text-slate-900">
                          <Link href={`/projects/${project.id}`} className="hover:underline">
                            {project.name}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-right text-slate-600 tabular-nums">
                          {(openTaskCountByProjectId[project.id] ?? 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleProjectTasks(project.id)}
                              className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                              aria-expanded={expandedProjectIds.has(project.id)}
                              aria-label={`${
                                expandedProjectIds.has(project.id) ? "Hide" : "Show"
                              } open tasks for ${project.name}`}
                            >
                              <span>{openTaskCountByProjectId[project.id] ?? 0}</span>
                              <span aria-hidden="true" className="text-[10px]">
                                {expandedProjectIds.has(project.id) ? "v" : ">"}
                              </span>
                            </button>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          <form>
                            <input type="hidden" name="project_id" value={project.id} />
                            <select
                              name="client_id"
                              aria-label="Client"
                              defaultValue={project.client_id || ""}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              onChange={handleInlineChange}
                            >
                              <option value="">No client</option>
                              {clients.map((client) => (
                                <option key={client.id} value={client.id}>
                                  {client.name}
                                </option>
                              ))}
                            </select>
                          </form>
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          <form>
                            <input type="hidden" name="project_id" value={project.id} />
                            <select
                              name="status"
                              aria-label="Status"
                              defaultValue={project.status ?? "planned"}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              onChange={handleInlineChange}
                            >
                              {statusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {formatProjectStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </form>
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          <form id={`project-${project.id}-assignees`}>
                            <input type="hidden" name="project_id" value={project.id} />
                            <AssigneeMultiSelect
                              users={users}
                              name="assignee_user_ids"
                              defaultSelected={assigneeIds}
                              className="w-full"
                              form={`project-${project.id}-assignees`}
                              onSelectionChange={(selectedIds) =>
                                handleAssigneesChange(project.id, selectedIds)
                              }
                            />
                          </form>
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          <form>
                            <input type="hidden" name="project_id" value={project.id} />
                            <input
                              type="date"
                              name="start_date"
                              aria-label="Start date"
                              defaultValue={project.start_date || ""}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              onChange={handleInlineChange}
                            />
                          </form>
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          <form>
                            <input type="hidden" name="project_id" value={project.id} />
                            <input
                              type="date"
                              name="end_date"
                              aria-label="End date"
                              defaultValue={project.end_date || ""}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              onChange={handleInlineChange}
                            />
                          </form>
                        </td>
                      </tr>
                      {expandedProjectIds.has(project.id)
                        ? (openTasksByProjectId[project.id] || []).map((task) => (
                            <tr
                              key={task.id}
                              className="border-t border-slate-100 bg-slate-50/60"
                            >
                              <td className="px-6 py-2 text-slate-700">
                                <div className="flex items-center gap-2 pl-6">
                                  <span aria-hidden="true" className="text-slate-400">
                                    {"->"}
                                  </span>
                                  <Link href={`/tasks/${task.id}`} className="hover:underline">
                                    {task.title}
                                  </Link>
                                </div>
                              </td>
                              <td className="px-6 py-2 text-right text-slate-400">-</td>
                              <td className="px-6 py-2 text-slate-400">-</td>
                              <td className="px-6 py-2 text-slate-600">
                                {formatProjectStatusLabel(task.status)}
                              </td>
                              <td className="px-6 py-2 text-slate-600">
                                {getAssigneeLabel(task.assignee_user_ids)}
                              </td>
                              <td className="px-6 py-2 text-slate-400">-</td>
                              <td className="px-6 py-2 text-slate-600">
                                {task.due_date || "-"}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={7}>
                    No projects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : view === "gantt" ? (
        <div className="overflow-x-auto">
          {projects.length ? (
            <div className="min-w-full" style={{ minWidth: timelineWidth + 240 }}>
              <div className="grid grid-cols-[240px_1fr] border-b border-slate-200">
                <div className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                  Project
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

              {ganttData.projects.map((project) => {
                const startOffset = diffDays(ganttData.rangeStart, project.start);
                const duration = Math.max(1, diffDays(project.start, project.end) + 1);
                const leftPercent = (startOffset / ganttData.rangeDays) * 100;
                const widthPercent = (duration / ganttData.rangeDays) * 100;
                const barColor = statusColors[project.status || ""] || "bg-slate-400";

                return (
                  <div
                    key={project.id}
                    className="grid grid-cols-[240px_1fr] border-b border-slate-100"
                  >
                    <div className="px-6 py-3 text-sm text-slate-900">
                      <Link href={`/projects/${project.id}`} className="hover:underline">
                        {project.name}
                      </Link>
                    </div>
                    <div className="relative px-6 py-3">
                      <div className="absolute inset-y-0 left-6 right-6">
                        <Link
                          href={`/projects/${project.id}`}
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${barColor}`}
                          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                          aria-label={`Open ${project.name}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No projects found.</div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {projects.length ? (
            <div className="min-w-full px-6 py-6">
              <div className="flex min-w-max gap-4">
                {statusOptions.map((status) => {
                  const columnProjects = boardProjectsByStatus.get(status) || [];
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
                      onDragLeave={() =>
                        setDragOverStatus((current) => (current === status ? null : current))
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        const projectId = event.dataTransfer.getData("text/plain");
                        setDragOverStatus(null);
                        if (!projectId) return;
                        const currentStatus = projectStatusById.get(projectId);
                        if (currentStatus === status) return;
                        submitStatusUpdate(projectId, status);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {formatProjectStatusLabel(status)}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {columnProjects.length}
                        </span>
                      </div>
                      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
                        {columnProjects.length ? (
                          columnProjects.map((project) => {
                            const assigneeIds = assigneesByProject[project.id] || [];
                            const assigneeNames = assigneeIds
                              .map((id) => usersById[id])
                              .filter(Boolean);
                            const clientName = project.client_id
                              ? clientNameById[project.client_id] || "Client N/A"
                              : "Client N/A";
                            return (
                              <div
                                key={project.id}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", project.id);
                                }}
                                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                              >
                                <Link
                                  href={`/projects/${project.id}`}
                                  className="block text-sm font-semibold text-slate-900 hover:underline"
                                >
                                  {project.name}
                                </Link>
                                <p className="mt-1 text-xs text-slate-500">{clientName}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {project.start_date || "No start"}
                                  {" -> "}
                                  {project.end_date || "No end"}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                    {openTaskCountByProjectId[project.id] ?? 0} open tasks
                                  </span>
                                  <span className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                    {assigneeNames.length
                                      ? `${assigneeNames[0]}${
                                          assigneeNames.length > 1
                                            ? ` +${assigneeNames.length - 1}`
                                            : ""
                                        }`
                                      : "Unassigned"}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="px-1 py-4 text-sm text-slate-500">No projects.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-slate-500">No projects found.</div>
          )}
        </div>
      )}
    </>
  );
}
