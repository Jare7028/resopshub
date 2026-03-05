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
  basePath = "/projects",
}: {
  projects: ProjectRow[];
  clients: ClientOption[];
  statusOptions: readonly string[];
  initialFilters: { client: string[]; status: string[] };
  hideCompleted: boolean;
  openTaskCountByProjectId: Record<string, number>;
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  basePath?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const [openMenuPosition, setOpenMenuPosition] = useState<{ left: number; top: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openMenuAnchorRef = useRef<HTMLElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    if (!openMenu) {
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
      return;
    }

    const closeOpenMenu = () => {
      setOpenMenu(null);
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
    };

    const syncOpenMenuPosition = () => {
      if (!openMenuAnchorRef.current || typeof window === "undefined") return;
      const rect = openMenuAnchorRef.current.getBoundingClientRect();
      const panelWidth = 288;
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
      );
      const top = Math.max(viewportPadding, rect.bottom + 8);
      setOpenMenuPosition({ left, top });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOpenMenu();
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) closeOpenMenu();
    };

    syncOpenMenuPosition();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", syncOpenMenuPosition, true);
    window.addEventListener("resize", syncOpenMenuPosition);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", syncOpenMenuPosition, true);
      window.removeEventListener("resize", syncOpenMenuPosition);
    };
  }, [openMenu]);

  const computeHeaderMenuPosition = (trigger: HTMLElement) => {
    if (typeof window === "undefined") return null;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = 288;
    const viewportPadding = 8;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - panelWidth),
      Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
    );
    const top = Math.max(viewportPadding, rect.bottom + 8);
    return { left, top };
  };

  const toggleHeaderMenu = (menuKey: HeaderMenuKey, trigger: HTMLElement) => {
    if (openMenu === menuKey) {
      setOpenMenu(null);
      setOpenMenuPosition(null);
      openMenuAnchorRef.current = null;
      return;
    }
    openMenuAnchorRef.current = trigger;
    const nextPosition = computeHeaderMenuPosition(trigger);
    setOpenMenuPosition(nextPosition);
    setOpenMenu(menuKey);
  };

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
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3 text-slate-700">Project</th>
            <th className="px-6 py-3 text-right text-slate-700">Open tasks</th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-slate-700">Client</span>
                <button
                  type="button"
                  aria-label="Filter client"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleHeaderMenu("client", event.currentTarget);
                  }}
                >
                  <FilterIcon active={filters.client.length > 0} />
                </button>
                {openMenu === "client" ? (
                  <div
                    ref={menuRef}
                    className="fixed z-[260]"
                    style={
                      openMenuPosition
                        ? { left: openMenuPosition.left, top: openMenuPosition.top }
                        : { left: 8, top: 8 }
                    }
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
                <span className="text-slate-700">Status</span>
                <button
                  type="button"
                  aria-label="Filter status"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleHeaderMenu("status", event.currentTarget);
                  }}
                >
                  <FilterIcon active={filters.status.length > 0} />
                </button>
                {openMenu === "status" ? (
                  <div
                    ref={menuRef}
                    className="fixed z-[260]"
                    style={
                      openMenuPosition
                        ? { left: openMenuPosition.left, top: openMenuPosition.top }
                        : { left: 8, top: 8 }
                    }
                  >
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

