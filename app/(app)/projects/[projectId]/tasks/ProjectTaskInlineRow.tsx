"use client";

import Link from "next/link";
import { type ChangeEvent } from "react";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
};

type ProjectTaskInlineRowProps = {
  task: TaskRow;
  assigneeUserIds: string[];
  users: UserOption[];
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
};

export default function ProjectTaskInlineRow({
  task,
  assigneeUserIds,
  users,
  statusOptions,
  priorityOptions,
  onUpdate,
}: ProjectTaskInlineRowProps) {
  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    event.currentTarget.form?.requestSubmit();
  };

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
          <input type="hidden" name="assignee_user_ids" value="" />
          <details className="relative w-full min-w-[12rem]">
            <summary className="w-full cursor-pointer list-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              {assigneeLabel}
            </summary>
            <div className="absolute z-10 mt-1 w-full min-w-[16rem] max-h-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
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
            </div>
          </details>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="status"
            aria-label="Status"
            defaultValue={task.status ?? "backlog"}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="task_id" value={task.id} />
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
