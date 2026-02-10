"use client";

import Link from "next/link";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatTaskStatusLabel, normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { statusSelectClasses } from "@/lib/taskIndicators";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ProjectOption = {
  id: string;
  name: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
  project_id: string | null;
};

type ClientTaskInlineRowProps = {
  task: TaskRow;
  assigneeUserIds: string[];
  users: UserOption[];
  projects: ProjectOption[];
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
  returnTo: string;
};

export default function ClientTaskInlineRow({
  task,
  assigneeUserIds,
  users,
  projects,
  statusOptions,
  priorityOptions,
  onUpdate,
  returnTo,
}: ClientTaskInlineRowProps) {
  const normalizedStatus = normalizeTaskStatusOrDefault(task.status);
  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    event.currentTarget.form?.requestSubmit();
  };

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef<HTMLDivElement | null>(null);
  const assigneeButtonRef = useRef<HTMLButtonElement | null>(null);
  const assigneeMenuRef = useRef<HTMLDivElement | null>(null);
  const [assigneeMenuStyle, setAssigneeMenuStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [assigneeMounted, setAssigneeMounted] = useState(false);

  useEffect(() => {
    setAssigneeMounted(true);
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (assigneeButtonRef.current?.contains(target)) {
        return;
      }
      if (assigneeMenuRef.current?.contains(target)) {
        return;
      }
      if (!assigneeRef.current?.contains(target)) {
        setAssigneeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!assigneeOpen) {
      return;
    }
    const updatePosition = () => {
      if (!assigneeButtonRef.current) {
        return;
      }
      const rect = assigneeButtonRef.current.getBoundingClientRect();
      setAssigneeMenuStyle({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 256),
      });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [assigneeOpen]);

  const assigneeLabel = (() => {
    if (!assigneeUserIds.length) {
      return "Unassigned";
    }
    if (assigneeUserIds.length > 1) {
      return "Multiple";
    }
    const assignee = users.find((user) => user.id === assigneeUserIds[0]);
    return assignee?.full_name || assignee?.email || "Assigned";
  })();

  return (
    <tr className="border-t border-slate-200">
      <td className="px-6 py-3 font-medium text-slate-900">
        <Link href={`/tasks/${task.id}`} className="hover:underline">
          {task.title}
        </Link>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <select
            name="project_id"
            aria-label="Project"
            defaultValue={task.project_id || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          >
            <option value="" disabled>
              Select project
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <input type="hidden" name="assignee_user_ids" value="" />
          <div className="relative w-full min-w-[12rem]" ref={assigneeRef}>
            <button
              type="button"
              ref={assigneeButtonRef}
              className="relative w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-8 text-left text-sm text-slate-700"
              onClick={() => setAssigneeOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={assigneeOpen}
            >
              <span className="block truncate">{assigneeLabel}</span>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-slate-400">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </button>
            {assigneeOpen && assigneeMounted && assigneeMenuStyle
              ? createPortal(
                  <div
                    ref={assigneeMenuRef}
                    className="z-50 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg"
                    style={{
                      position: "fixed",
                      top: assigneeMenuStyle.top,
                      left: assigneeMenuStyle.left,
                      width: assigneeMenuStyle.width,
                    }}
                  >
                    {users?.length ? (
                      users.map((user) => (
                        <label
                          key={user.id}
                          className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            name="assignee_user_ids"
                            value={user.id}
                            defaultChecked={assigneeUserIds.includes(user.id)}
                            onChange={handleChange}
                          />
                          <span>{user.full_name || user.email}</span>
                        </label>
                      ))
                    ) : (
                      <p className="px-2 py-1 text-sm text-slate-500">No users</p>
                    )}
                  </div>,
                  document.body
                )
              : null}
          </div>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <select
            name="status"
            aria-label="Status"
            defaultValue={normalizedStatus}
            className={`w-full rounded-md border px-2 py-1 text-sm ${statusSelectClasses(
              normalizedStatus
            )}`}
            onChange={handleChange}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {formatTaskStatusLabel(status)}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <select
            name="priority"
            aria-label="Priority"
            defaultValue={task.priority ?? "medium"}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          >
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <input
            type="date"
            name="start_date"
            aria-label="Start date"
            defaultValue={task.start_date || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          />
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <input
            type="date"
            name="due_date"
            aria-label="Due date"
            defaultValue={task.due_date || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          />
        </form>
      </td>
    </tr>
  );
}
