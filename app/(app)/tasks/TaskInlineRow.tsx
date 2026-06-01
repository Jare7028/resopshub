"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { formatTaskStatusLabel, normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import {
  dueInputClasses,
  getDueUrgency,
  prioritySelectClasses,
} from "@/lib/taskIndicators";
import { statusSelectStyle } from "@/lib/statusColorStyles";
import { encodeAssignmentTarget } from "@/lib/assignmentTargets";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AssignmentGroupOption = {
  id: string;
  name: string;
  memberCount: number;
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
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type TaskTableColumnId =
  | "task"
  | "open_subtasks"
  | "client"
  | "project"
  | "status"
  | "priority"
  | "assignees"
  | "start"
  | "next_subtask_due"
  | "due";

type TaskInlineRowProps = {
  task: TaskRow;
  openSubtaskCount?: number;
  isSubtasksExpanded?: boolean;
  onToggleSubtasks?: (taskId: string) => void;
  assigneeUserIds: string[];
  users: UserOption[];
  groups: AssignmentGroupOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  statusOptions: readonly string[];
  statusColorMap?: Record<string, string>;
  priorityOptions: readonly string[];
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  onStatusUpdate?: (taskId: string, status: string) => void;
  statusValue?: string;
  returnTo: string;
  rowVariant?: "task" | "subtask";
  onTitleHoverStart?: (taskId: string, anchor: { left: number; bottom: number }) => void;
  onTitleHoverMove?: (taskId: string, anchor: { left: number; bottom: number }) => void;
  onTitleHoverEnd?: () => void;
  visibleColumnIds: ReadonlySet<TaskTableColumnId>;
  showNextSubtaskDueDateColumn?: boolean;
  nextSubtaskDueDateIso?: string | null;
};

export default function TaskInlineRow({
  task,
  openSubtaskCount = 0,
  isSubtasksExpanded = false,
  onToggleSubtasks = () => {},
  assigneeUserIds,
  users,
  groups,
  clients,
  projects,
  statusOptions,
  statusColorMap = {},
  priorityOptions,
  onUpdate,
  onStatusUpdate,
  statusValue,
  returnTo,
  rowVariant = "task",
  onTitleHoverStart,
  onTitleHoverMove,
  onTitleHoverEnd,
  visibleColumnIds,
  showNextSubtaskDueDateColumn = false,
  nextSubtaskDueDateIso = null,
}: TaskInlineRowProps) {
  const assigneeFormId = `task-${task.id}-assignees`;
  const dueUrgency = getDueUrgency(task.due_date, task.due_time ?? null);
  const nextSubtaskDueUrgency = getDueUrgency(nextSubtaskDueDateIso, null);
  const normalizedStatus = normalizeTaskStatusOrDefault(statusValue ?? task.status);
  const statusColorHex =
    statusColorMap[normalizedStatus] ||
    statusColorMap[String(statusValue || task.status || "").trim().toLowerCase()] ||
    null;
  const isSubtaskRow = rowVariant === "subtask";
  const [, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback = ""
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    if (event.currentTarget.name === "status" && onStatusUpdate) {
      onStatusUpdate(task.id, normalizeTaskStatusOrDefault(event.currentTarget.value));
      return;
    }
    const form = event.currentTarget.form;
    if (!form) return;
    const formData = new FormData(form);
    setIsSaving(true);
    setSaveError("");
    startTransition(() => {
      void Promise.resolve(onUpdate(formData))
        .then((result) => {
          const actionResult = result as
            | { ok?: boolean; error?: string | null }
            | null
            | undefined;
          if (actionResult?.ok === false) {
            setSaveError(actionResult.error || "Unable to save change");
          }
        })
        .catch((error) => {
          setSaveError(error instanceof Error ? error.message : "Unable to save change");
        })
        .finally(() => {
          setIsSaving(false);
        });
    });
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
    if (assignee) return assignee.full_name || assignee.email || "Assigned";
    const group = groups.find(
      (item) => encodeAssignmentTarget("group", item.id) === assigneeUserIds[0]
    );
    return group?.name || "Assigned";
  })();

  const toHoverAnchor = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      left: rect.left,
      bottom: rect.bottom,
    };
  };

  const handleTitleHoverStart = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onTitleHoverStart) return;
    onTitleHoverStart(task.id, toHoverAnchor(event));
  };

  const handleTitleHoverMove = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onTitleHoverMove) return;
    onTitleHoverMove(task.id, toHoverAnchor(event));
  };

  const handleTitleHoverEnd = () => {
    if (!onTitleHoverEnd) return;
    onTitleHoverEnd();
  };
  const isColumnVisible = (columnId: TaskTableColumnId) => {
    if (columnId === "next_subtask_due") {
      return showNextSubtaskDueDateColumn && visibleColumnIds.has(columnId);
    }
    return visibleColumnIds.has(columnId);
  };

  return (
    <tr className={isSubtaskRow ? "border-t border-slate-100 bg-slate-50/60" : "border-t border-slate-200"}>
      {isColumnVisible("task") ? (
        <td className="px-6 py-3 font-medium text-slate-900">
          {isSubtaskRow ? (
            <div className="flex items-center gap-2 pl-6 text-slate-700">
              <span aria-hidden="true" className="text-slate-400">
                {"->"}
              </span>
              <Link
                href={`/tasks/${task.id}`}
                prefetch={false}
                className="hover:underline"
                onMouseEnter={handleTitleHoverStart}
                onMouseMove={handleTitleHoverMove}
                onMouseLeave={handleTitleHoverEnd}
              >
                {task.title}
              </Link>
            </div>
          ) : (
            <Link
              href={`/tasks/${task.id}`}
              prefetch={false}
              className="hover:underline"
              onMouseEnter={handleTitleHoverStart}
              onMouseMove={handleTitleHoverMove}
              onMouseLeave={handleTitleHoverEnd}
            >
              {task.title}
            </Link>
          )}
          {isSaving || saveError ? (
            <p
              className={`mt-1 text-[11px] font-medium ${
                saveError ? "text-rose-600" : "text-slate-500"
              }`}
            >
              {saveError || "Saving..."}
            </p>
          ) : null}
        </td>
      ) : null}
      {isColumnVisible("open_subtasks") ? (
        <td
          className={`px-6 py-3 text-right tabular-nums ${
            isSubtaskRow ? "text-slate-400" : "text-slate-600"
          }`}
        >
          {!isSubtaskRow && openSubtaskCount > 0 ? (
            <button
              type="button"
              onClick={() => onToggleSubtasks(task.id)}
              className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
              aria-expanded={isSubtasksExpanded}
              aria-label={`${isSubtasksExpanded ? "Hide" : "Show"} subtasks for ${task.title}`}
            >
              <span>{openSubtaskCount}</span>
              <span aria-hidden="true" className="text-[10px]">
                {isSubtasksExpanded ? "v" : ">"}
              </span>
            </button>
          ) : isSubtaskRow ? (
            "-"
          ) : (
            0
          )}
        </td>
      ) : null}
      {isColumnVisible("client") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select
              name="client_id"
              aria-label="Client"
              defaultValue={task.client_id || ""}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              onChange={handleChange}
            >
              <option value="">N/A</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </form>
        </td>
      ) : null}
      {isColumnVisible("project") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select
              name="project_id"
              aria-label="Project"
              defaultValue={task.project_id || ""}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              onChange={handleChange}
            >
              <option value="">N/A</option>
              {projects.map((project) => {
                const projectClientName = getRelationName(project.clients, "");
                return (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {projectClientName ? ` - ${projectClientName}` : ""}
                  </option>
                );
              })}
            </select>
          </form>
        </td>
      ) : null}
      {isColumnVisible("status") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select
              name="status"
              aria-label="Status"
              value={normalizedStatus}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              style={statusSelectStyle(statusColorHex)}
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
      ) : null}
      {isColumnVisible("priority") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select
              name="priority"
              aria-label="Priority"
              defaultValue={task.priority ?? "medium"}
              className={`w-full rounded-md border px-2 py-1 text-sm ${prioritySelectClasses(
                task.priority
              )}`}
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
      ) : null}
      {isColumnVisible("assignees") ? (
        <td className="px-6 py-3 text-slate-600">
          <form id={assigneeFormId}>
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
                        <div>
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            People
                          </p>
                          {users.map((user) => (
                            <label
                              key={user.id}
                              className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                form={assigneeFormId}
                                name="assignee_user_ids"
                                value={user.id}
                                defaultChecked={assigneeUserIds.includes(user.id)}
                                onChange={handleChange}
                              />
                              <span>{user.full_name || user.email}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="px-2 py-1 text-sm text-slate-500">No users</p>
                      )}
                      {groups.length ? (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Groups
                          </p>
                          {groups.map((group) => {
                            const groupValue = encodeAssignmentTarget("group", group.id);
                            return (
                              <label
                                key={`task-group-${group.id}`}
                                className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  form={assigneeFormId}
                                  name="assignee_user_ids"
                                  value={groupValue}
                                  defaultChecked={assigneeUserIds.includes(groupValue)}
                                  onChange={handleChange}
                                />
                                <span>{`${group.name} (${group.memberCount} members)`}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>,
                    document.body
                  )
                : null}
            </div>
          </form>
        </td>
      ) : null}
      {isColumnVisible("start") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
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
      ) : null}
      {isColumnVisible("next_subtask_due") ? (
        <td className="px-6 py-3 text-slate-600">
          {nextSubtaskDueDateIso ? (
            <input
              type="date"
              aria-label="Next subtask due date"
              value={nextSubtaskDueDateIso}
              readOnly
              tabIndex={-1}
              className={`pointer-events-none w-full rounded-md border px-2 py-1 text-sm ${dueInputClasses(
                nextSubtaskDueUrgency
              )}`}
            />
          ) : (
            <div
              className={`w-full rounded-md border px-2 py-1 text-sm ${dueInputClasses("none")}`}
            >
              -
            </div>
          )}
        </td>
      ) : null}
      {isColumnVisible("due") ? (
        <td className="px-6 py-3 text-slate-600">
          <form>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <input
              type="date"
              name="due_date"
              aria-label="Due date"
              defaultValue={task.due_date || ""}
              className={`w-full rounded-md border px-2 py-1 text-sm ${dueInputClasses(
                dueUrgency
              )}`}
              onChange={handleChange}
            />
          </form>
        </td>
      ) : null}
    </tr>
  );
}




