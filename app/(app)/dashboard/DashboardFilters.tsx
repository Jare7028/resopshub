"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MultiSelect from "../_components/MultiSelect";
import { formatTaskStatusLabel } from "@/lib/taskStatus";
import {
  buildDashboardQuery,
  writeDashboardFiltersCookie,
} from "./filterState";
import type { DashboardFiltersState } from "./types";

type RangeOption = { value: string; label: string };
type ClientOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };
type UserOption = { id: string; full_name: string | null; email: string | null };

export default function DashboardFilters({
  rangeOptions,
  clients,
  projects,
  users,
  statusOptions,
  priorityOptions,
  initialFilters,
}: {
  rangeOptions: readonly RangeOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  users: UserOption[];
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  initialFilters: DashboardFiltersState;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<DashboardFiltersState>(initialFilters);

  const initialKey = useMemo(
    () => JSON.stringify(initialFilters),
    [initialFilters]
  );

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  const apply = useCallback(
    (next: DashboardFiltersState) => {
      writeDashboardFiltersCookie(next);
      const query = buildDashboardQuery(next);
      startTransition(() => {
        router.replace(query ? `/dashboard?${query}` : "/dashboard", {
          scroll: false,
        });
      });
    },
    [router]
  );

  const update = useCallback(
    <K extends keyof DashboardFiltersState>(key: K, value: DashboardFiltersState[K]) => {
      const next = { ...filters, [key]: value } as DashboardFiltersState;
      setFilters(next);
      apply(next);
    },
    [apply, filters]
  );

  return (
    <form
      method="get"
      action="/dashboard"
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        apply(filters);
      }}
      >
      <input type="hidden" name="currency" value={filters.currency} />
      <select
        name="range"
        value={filters.range}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("range", event.target.value)}
      >
        {rangeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <MultiSelect
        options={clients.map((client) => ({ value: client.id, label: client.name }))}
        selectedValues={filters.client}
        placeholder="All clients"
        onChange={(next) => update("client", next)}
      />

      <MultiSelect
        options={projects.map((project) => ({ value: project.id, label: project.name }))}
        selectedValues={filters.project}
        placeholder="All projects"
        onChange={(next) => update("project", next)}
      />

      <MultiSelect
        options={users.map((user) => ({
          value: user.id,
          label: user.full_name || user.email || "Unnamed user",
        }))}
        selectedValues={filters.user}
        placeholder="All users"
        onChange={(next) => update("user", next)}
      />

      <MultiSelect
        options={statusOptions.map((status) => ({
          value: status,
          label: formatTaskStatusLabel(status),
        }))}
        selectedValues={filters.status}
        placeholder="All statuses"
        onChange={(next) => update("status", next)}
      />

      <MultiSelect
        options={priorityOptions.map((priority) => ({
          value: priority,
          label: priority,
        }))}
        selectedValues={filters.priority}
        placeholder="All priorities"
        onChange={(next) => update("priority", next)}
      />
    </form>
  );
}
