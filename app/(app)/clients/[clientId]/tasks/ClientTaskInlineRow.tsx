"use client";

import Link from "next/link";
import { type ChangeEvent } from "react";

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
  users: UserOption[];
  projects: ProjectOption[];
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
};

export default function ClientTaskInlineRow({
  task,
  users,
  projects,
  statusOptions,
  priorityOptions,
  onUpdate,
}: ClientTaskInlineRowProps) {
  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    event.currentTarget.form?.requestSubmit();
  };

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
          <select
            name="assignee_user_id"
            aria-label="Assignee"
            defaultValue={task.assignee_user_id || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          >
            <option value="">Unassigned</option>
            {users?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email}
              </option>
            ))}
          </select>
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
