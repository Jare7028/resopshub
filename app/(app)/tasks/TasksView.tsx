"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import TaskInlineRow from "./TaskInlineRow";

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
  onUpdate: (formData: FormData) => void;
  hideCompleted: boolean;
  toggleUrl: string;
};

const statusColors: Record<string, string> = {
  backlog: "bg-slate-400",
  in_progress: "bg-blue-500",
  blocked: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-rose-400",
};

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
  onUpdate,
  hideCompleted,
  toggleUrl,
}: TasksViewProps) {
  const [view, setView] = useState<"table" | "gantt">("table");

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
            aria-pressed={hideCompleted}
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
                <th className="px-6 py-3">Task</th>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Project</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Assignees</th>
                <th className="px-6 py-3">Start</th>
                <th className="px-6 py-3">Due</th>
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
