"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCsvParam } from "@/lib/queryParams";
import ProjectInlineRow from "./ProjectInlineRow";
import { FilterIcon, FilterMenuMulti } from "../_components/TableHeaderFilters";

type ClientOption = { id: string; name: string };

type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  client_id: string | null;
  clients?: { name?: string | null } | { name?: string | null }[] | null;
};

type HeaderMenuKey = "client" | "status";

export default function ProjectsTable({
  projects,
  clients,
  statusOptions,
  initialFilters,
  hideCompleted,
  openTaskCountByProjectId,
  onUpdate,
}: {
  projects: ProjectRow[];
  clients: ClientOption[];
  statusOptions: readonly string[];
  initialFilters: { client: string[]; status: string[] };
  hideCompleted: boolean;
  openTaskCountByProjectId: Record<string, number>;
  onUpdate: (formData: FormData) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

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

  const buildQuery = (next: typeof filters) => {
    const params = new URLSearchParams();
    setCsvParam(params, "client", next.client);
    setCsvParam(params, "status", next.status);
    params.set("hide", hideCompleted ? "1" : "0");
    const query = params.toString();
    return query;
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next);
    startTransition(() => {
      router.replace(query ? `/projects?${query}` : "/projects", { scroll: false });
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3 text-slate-700">Project</th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-slate-700">Client</span>
                <button
                  type="button"
                  aria-label="Filter client"
                  onClick={() =>
                    setOpenMenu((current) => (current === "client" ? null : "client"))
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
                <span className="text-slate-700">Status</span>
                <button
                  type="button"
                  aria-label="Filter status"
                  onClick={() =>
                    setOpenMenu((current) => (current === "status" ? null : "status"))
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
                        label: status.replaceAll("_", " "),
                      }))}
                      selectedValues={filters.status}
                      onChange={(next) => applyFilters({ ...filters, status: next })}
                      onClear={() => applyFilters({ ...filters, status: [] })}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3 text-slate-700">Start</th>
            <th className="px-6 py-3 text-slate-700">End</th>
            <th className="px-6 py-3 text-right text-slate-700">Open tasks</th>
          </tr>
        </thead>
        <tbody>
          {projects.length ? (
            projects.map((project) => (
              <ProjectInlineRow
                key={project.id}
                project={project}
                clients={clients}
                statusOptions={statusOptions}
                openTaskCount={openTaskCountByProjectId[project.id] ?? 0}
                onUpdate={onUpdate}
              />
            ))
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={6}>
                No projects found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
