"use client";

import Link from "next/link";
import { type ChangeEvent } from "react";

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
  client_id: string | null;
  clients?: { name?: string | null } | { name?: string | null }[] | null;
};

type ProjectInlineRowProps = {
  project: ProjectRow;
  clients: ClientOption[];
  statusOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
};

export default function ProjectInlineRow({
  project,
  clients,
  statusOptions,
  onUpdate,
}: ProjectInlineRowProps) {
  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <tr className="border-t border-slate-200">
      <td className="px-6 py-3 font-medium text-slate-900">
        <Link href={`/projects/${project.id}`} className="hover:underline">
          {project.name}
        </Link>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="project_id" value={project.id} />
          <select
            name="client_id"
            aria-label="Client"
            defaultValue={project.client_id || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
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
        <form action={onUpdate}>
          <input type="hidden" name="project_id" value={project.id} />
          <select
            name="status"
            aria-label="Status"
            defaultValue={project.status ?? "planned"}
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
          <input type="hidden" name="project_id" value={project.id} />
          <input
            type="date"
            name="start_date"
            aria-label="Start date"
            defaultValue={project.start_date || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          />
        </form>
      </td>
      <td className="px-6 py-3 text-slate-600">
        <form action={onUpdate}>
          <input type="hidden" name="project_id" value={project.id} />
          <input
            type="date"
            name="end_date"
            aria-label="End date"
            defaultValue={project.end_date || ""}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            onChange={handleChange}
          />
        </form>
      </td>
    </tr>
  );
}
