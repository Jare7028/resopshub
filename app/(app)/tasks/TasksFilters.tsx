"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MultiSelect from "../_components/MultiSelect";
import { setCsvParam } from "@/lib/queryParams";
import { formatTaskStatusLabel } from "@/lib/taskStatus";

type Option = { value: string; label: string };
type ClientOption = { id: string; name: string };
type ProjectOption = {
  id: string;
  name: string;
  client_id: string | null;
  clients?: { name?: string | null } | { name?: string | null }[] | null;
};
type UserOption = { id: string; full_name: string | null; email: string | null };

export type TasksFiltersState = {
  status: string[];
  priority: string[];
  assignee: string[];
  due: string;
  client: string[];
  project: string[];
};

function buildQuery(
  filters: TasksFiltersState,
  hideCompleted: boolean,
  sort?: string | null,
  dir?: string | null
) {
  const params = new URLSearchParams();
  setCsvParam(params, "status", filters.status);
  setCsvParam(params, "priority", filters.priority);
  setCsvParam(params, "assignee", filters.assignee);
  if (filters.due && filters.due !== "all") params.set("due", filters.due);
  setCsvParam(params, "client", filters.client);
  setCsvParam(params, "project", filters.project);
  params.set("hide", hideCompleted ? "1" : "0");
  if (sort) params.set("sort", sort);
  if (dir) params.set("dir", dir);
  return params.toString();
}

export default function TasksFilters({
  statusOptions,
  priorityOptions,
  dueOptions,
  users,
  clients,
  projects,
  initialFilters,
  hideCompleted,
  sort,
  dir,
}: {
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  dueOptions: readonly Option[];
  users: UserOption[];
  clients: ClientOption[];
  projects: ProjectOption[];
  initialFilters: TasksFiltersState;
  hideCompleted: boolean;
  sort?: string;
  dir?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<TasksFiltersState>(initialFilters);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  const apply = useCallback(
    (next: TasksFiltersState) => {
      const query = buildQuery(next, hideCompleted, sort, dir);
      startTransition(() => {
        router.replace(query ? `/tasks?${query}` : "/tasks", { scroll: false });
      });
    },
    [hideCompleted, router, sort, dir]
  );

  const update = useCallback(
    <K extends keyof TasksFiltersState>(key: K, value: TasksFiltersState[K]) => {
      const next = { ...filters, [key]: value } as TasksFiltersState;
      setFilters(next);
    },
    [filters]
  );

  const assigneeOptions = useMemo(() => {
    const options: Option[] = [{ value: "unassigned", label: "Unassigned" }];
    users.forEach((user) => {
      options.push({
        value: user.id,
        label: user.full_name || user.email || "Unnamed user",
      });
    });
    return options;
  }, [users]);

  const projectOptions = useMemo(() => {
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

    return projects.map((project) => {
      const clientName = getRelationName(project.clients, "");
      return {
        value: project.id,
        label: clientName ? `${project.name} - ${clientName}` : project.name,
      };
    });
  }, [projects]);

  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        apply(filters);
      }}
    >
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
        options={priorityOptions.map((priority) => ({ value: priority, label: priority }))}
        selectedValues={filters.priority}
        placeholder="All priorities"
        onChange={(next) => update("priority", next)}
      />

      <MultiSelect
        options={assigneeOptions}
        selectedValues={filters.assignee}
        placeholder="All assignees"
        onChange={(next) => update("assignee", next)}
      />

      <select
        name="due"
        value={filters.due}
        className="h-11 rounded-md border border-slate-300 px-3 text-sm"
        onChange={(event) => update("due", event.target.value)}
      >
        {dueOptions.map((filter) => (
          <option key={filter.value} value={filter.value}>
            {filter.label}
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
        options={projectOptions}
        selectedValues={filters.project}
        placeholder="All projects"
        onChange={(next) => update("project", next)}
      />

      <button
        type="submit"
        className="sm:col-span-2 xl:col-span-6 inline-flex min-h-11 w-full items-center justify-center rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white sm:w-fit"
      >
        Apply filters
      </button>
    </form>
  );
}
