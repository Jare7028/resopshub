"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDelete from "../_components/ConfirmDelete";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";

type ClientRow = {
  id: string;
  name: string;
  status: string | null;
  industry: string | null;
  created_at: string | null;
};

type HeaderMenuKey = "name" | "status" | "industry";

export default function ClientsTable({
  clients,
  statusOptions,
  initialFilters,
  onDelete,
}: {
  clients: ClientRow[];
  statusOptions: readonly string[];
  initialFilters: { q: string; status: string[]; industry: string[] };
  onDelete: (formData: FormData) => void;
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
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMenu]);

  const industryOptions = useMemo(() => {
    const values = new Set<string>();
    clients.forEach((client) => {
      if (client.industry) values.add(client.industry);
    });
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [clients]);

  const buildQuery = (next: typeof filters) => {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    setCsvParam(params, "status", next.status);
    setCsvParam(params, "industry", next.industry);
    return params.toString();
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next);
    startTransition(() => {
      router.replace(query ? `/clients?${query}` : "/clients", { scroll: false });
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-slate-700">Client</span>
                <button
                  type="button"
                  aria-label="Filter client name"
                  onClick={() =>
                    setOpenMenu((current) => (current === "name" ? null : "name"))
                  }
                >
                  <FilterIcon active={Boolean(filters.q.trim())} />
                </button>
                {openMenu === "name" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuText
                      title="Client"
                      value={filters.q}
                      placeholder="Search by name..."
                      onApply={(next) => {
                        applyFilters({ ...filters, q: next });
                        setOpenMenu(null);
                      }}
                      onClear={() => {
                        applyFilters({ ...filters, q: "" });
                        setOpenMenu(null);
                      }}
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
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-slate-700">Industry</span>
                <button
                  type="button"
                  aria-label="Filter industry"
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === "industry" ? null : "industry"
                    )
                  }
                >
                  <FilterIcon active={filters.industry.length > 0} />
                </button>
                {openMenu === "industry" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Industry"
                      options={industryOptions}
                      selectedValues={filters.industry}
                      onChange={(next) => applyFilters({ ...filters, industry: next })}
                      onClear={() => applyFilters({ ...filters, industry: [] })}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3 text-slate-700">Created</th>
            <th className="px-6 py-3 text-slate-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.length ? (
            clients.map((client) => (
              <tr key={client.id} className="border-t border-slate-200">
                <td className="px-6 py-3 font-medium text-slate-900">
                  <Link href={`/clients/${client.id}`} className="hover:underline">
                    {client.name}
                  </Link>
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {client.status?.replaceAll("_", " ") || "-"}
                </td>
                <td className="px-6 py-3 text-slate-600">{client.industry || "-"}</td>
                <td className="px-6 py-3 text-slate-600">
                  {client.created_at
                    ? new Date(client.created_at).toLocaleDateString("en-US")
                    : "-"}
                </td>
                <td className="px-6 py-3">
                  <form action={onDelete}>
                    <input type="hidden" name="client_id" value={client.id} />
                    <ConfirmDelete name={client.name} itemType="Client" />
                  </form>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={5}>
                No clients found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

