"use client";

import Link from "next/link";
import { type ChangeEvent } from "react";

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
  assignee_user_id: string | null;
  client_id: string | null;
  project_id: string | null;
  projects?: { name: string | null } | { name: string | null }[] | null;
  clients?: { name: string | null } | { name: string | null }[] | null;
};

type TaskInlineRowProps = {
  task: TaskRow;
  users: UserOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
};

export default function TaskInlineRow({
  task,
  users,
  clients,
  projects,
  statusOptions,
  priorityOptions,
  onUpdate,
}: TaskInlineRowProps) {
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


