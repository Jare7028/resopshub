"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type RangeOption = { value: string; label: string };
type ClientOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };
type UserOption = { id: string; full_name: string | null; email: string | null };

type DashboardFiltersState = {
  range: string;
  client: string;
  project: string;
  user: string;
  status: string;
  priority: string;
};

const COOKIE_NAME = "resopshub_dashboard_filters";

function buildQuery(filters: DashboardFiltersState) {
  const params = new URLSearchParams();
  if (filters.range && filters.range !== "all") params.set("range", filters.range);
  if (filters.client && filters.client !== "all") params.set("client", filters.client);
  if (filters.project && filters.project !== "all") params.set("project", filters.project);
  if (filters.user && filters.user !== "all") params.set("user", filters.user);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.priority && filters.priority !== "all") params.set("priority", filters.priority);
  return params.toString();
}

function writeCookie(filters: DashboardFiltersState) {
  const maxAgeSeconds = 60 * 60 * 24 * 365;
  const encoded = encodeURIComponent(JSON.stringify(filters));
  let cookie = `${COOKIE_NAME}=${encoded}; path=/dashboard; max-age=${maxAgeSeconds}; samesite=lax`;
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    cookie += "; secure";
  }
  document.cookie = cookie;
}

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
  const [isPending, startTransition] = useTransition();
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
      writeCookie(next);
      const query = buildQuery(next);
      startTransition(() => {
        router.replace(query ? `/dashboard?${query}` : "/dashboard", {
          scroll: false,
        });
      });
    },
    [router]
  );

  const update = useCallback(
    <K extends keyof DashboardFiltersState>(key: K, value: string) => {
      const next = { ...filters, [key]: value };
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

      <select
        name="client"
        value={filters.client}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("client", event.target.value)}
      >
        <option value="all">All clients</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>

      <select
        name="project"
        value={filters.project}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("project", event.target.value)}
      >
        <option value="all">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <select
        name="user"
        value={filters.user}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("user", event.target.value)}
      >
        <option value="all">All users</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.full_name || user.email}
          </option>
        ))}
      </select>

      <select
        name="status"
        value={filters.status}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("status", event.target.value)}
      >
        <option value="all">All statuses</option>
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status.replace("_", " ")}
          </option>
        ))}
      </select>

      <select
        name="priority"
        value={filters.priority}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        onChange={(event) => update("priority", event.target.value)}
      >
        <option value="all">All priorities</option>
        {priorityOptions.map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
        disabled={isPending}
      >
        {isPending ? "Saving…" : "Apply filters"}
      </button>
    </form>
  );
}
