import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  TASK_STATUS_OPTIONS,
  formatTaskStatusLabel,
  normalizeTaskStatusOrDefault,
} from "@/lib/taskStatus";

const statusOptions = TASK_STATUS_OPTIONS;

type RequirementRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  requirement_type: string | null;
  billable_hours: number | null;
  notes: string | null;
  created_at: string | null;
};

function normalizeRequirementsView(value: string | undefined): "table" | "board" | "gantt" {
  if (value === "board" || value === "gantt") return value;
  return "table";
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message.toLowerCase() : "";
  return code === "42703" || message.includes("does not exist");
}

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayStamp(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(start: Date, end: Date) {
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((toDayStamp(end) - toDayStamp(start)) / dayMs);
}

function formatTick(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function ClientRequirementsPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; view?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const selectedView = normalizeRequirementsView(String(searchParams?.view || "").trim().toLowerCase());
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const fullSelect = await supabase
    .from("requirements")
    .select("id,start_date,end_date,status,requirement_type,billable_hours,notes,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  let requirements = (fullSelect.data || []) as RequirementRow[];

  if (fullSelect.error && isMissingColumnError(fullSelect.error)) {
    const fallback = await supabase
      .from("requirements")
      .select("id,start_date,requirement_type,billable_hours,notes,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    requirements = ((fallback.data || []) as Array<
      Omit<RequirementRow, "end_date" | "status">
    >).map((row) => ({
      ...row,
      end_date: null,
      status: "to_do",
    }));
  }

  const basePath = `/clients/${clientId}/requirements`;
  const buildViewUrl = (nextView: "table" | "board" | "gantt") => {
    const params = new URLSearchParams();
    if (nextView !== "table") {
      params.set("view", nextView);
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  async function createRequirement(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const startDate = String(formData.get("start_date") || "");
    const endDate = String(formData.get("end_date") || "").trim();
    const status = normalizeTaskStatusOrDefault(String(formData.get("status") || "to_do"));
    const requirementType = String(formData.get("requirement_type") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!startDate) {
      redirect(`/clients/${clientId}/requirements?error=Start%20date%20is%20required`);
    }

    if (!requirementType) {
      redirect(`/clients/${clientId}/requirements?error=Requirement%20type%20is%20required`);
    }

    const basePayload = {
      client_id: clientId,
      start_date: startDate,
      end_date: endDate || null,
      status,
      requirement_type: requirementType,
      notes: notes || null,
    };

    let { error } = await supabase.from("requirements").insert(basePayload);

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from("requirements")
        .insert({
          client_id: clientId,
          start_date: startDate,
          requirement_type: requirementType,
          notes: notes || null,
        });
      error = retry.error;
    }

    // Legacy fallback if billable_hours still has a NOT NULL constraint.
    if (error && error.message.toLowerCase().includes("billable_hours")) {
      const retry = await supabase
        .from("requirements")
        .insert({
          client_id: clientId,
          start_date: startDate,
          requirement_type: requirementType,
          notes: notes || null,
          billable_hours: 0,
        });
      error = retry.error;
    }

    if (error) {
      redirect(`/clients/${clientId}/requirements?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/requirements`);
  }

  const boardByStatus = statusOptions.reduce<Record<string, RequirementRow[]>>((acc, status) => {
    acc[status] = [];
    return acc;
  }, {});

  requirements.forEach((requirement) => {
    const status = normalizeTaskStatusOrDefault(requirement.status || "to_do");
    boardByStatus[status] ||= [];
    boardByStatus[status].push(requirement);
  });

  Object.values(boardByStatus).forEach((items) => {
    items.sort((a, b) => {
      const aDate = a.start_date || "";
      const bDate = b.start_date || "";
      return bDate.localeCompare(aDate);
    });
  });

  const ganttData = (() => {
    const today = new Date();
    const normalized = requirements
      .map((requirement) => {
        const start = toDate(requirement.start_date) || toDate(requirement.created_at) || today;
        const rawEnd = toDate(requirement.end_date);
        let end = rawEnd || today;
        if (end < start) {
          end = start;
        }
        return { ...requirement, start, end };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (!normalized.length) {
      return { items: normalized, rangeStart: today, rangeDays: 1 };
    }

    const rangeStart = normalized.reduce(
      (min, requirement) => (requirement.start < min ? requirement.start : min),
      normalized[0].start
    );
    const rangeEnd = normalized.reduce(
      (max, requirement) => (requirement.end > max ? requirement.end : max),
      normalized[0].end
    );

    return {
      items: normalized,
      rangeStart,
      rangeDays: Math.max(1, diffDays(rangeStart, rangeEnd) + 1),
    };
  })();

  const timelineTicks = (() => {
    const ticks = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const offset = Math.round((ganttData.rangeDays - 1) * (i / steps));
      const tickDate = new Date(ganttData.rangeStart);
      tickDate.setDate(tickDate.getDate() + offset);
      ticks.push({ label: formatTick(tickDate), left: (i / steps) * 100 });
    }
    return ticks;
  })();

  const timelineWidth = Math.max(560, ganttData.rangeDays * 18);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Requirements
        </h1>
        <ClientTabs clientId={clientId} active="requirements" />
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add requirement</h2>
        <form action={createRequirement} className="mt-4 grid gap-4 md:grid-cols-4">
          <input
            type="date"
            name="start_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="date"
            name="end_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue="to_do"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {formatTaskStatusLabel(status)}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="requirement_type"
            placeholder="Requirement type"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="text"
            name="notes"
            placeholder="Notes"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-4"
          />
          <button
            type="submit"
            className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Save requirement
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Requirements</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <a
                href={buildViewUrl("table")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  selectedView === "table"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Table
              </a>
              <a
                href={buildViewUrl("board")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  selectedView === "board"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Board
              </a>
              <a
                href={buildViewUrl("gantt")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  selectedView === "gantt"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Gantt
              </a>
            </div>
          </div>
        </div>

        {selectedView === "table" ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3">Start date</th>
                  <th className="px-6 py-3">Requirement Type</th>
                  <th className="px-6 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {requirements?.length ? (
                  requirements.map((req) => (
                    <tr key={req.id} className="border-t border-slate-200">
                      <td className="px-6 py-3 text-slate-700">
                        {req.start_date
                          ? new Date(req.start_date).toLocaleDateString("en-US")
                          : ""}
                      </td>
                      <td className="px-6 py-3 text-slate-700">
                        {req.requirement_type ||
                          (req.billable_hours !== null && req.billable_hours !== undefined
                            ? String(req.billable_hours)
                            : "")}
                      </td>
                      <td className="px-6 py-3 text-slate-700">{req.notes || ""}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-6 py-6 text-slate-500" colSpan={3}>
                      No requirements yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {selectedView === "board" ? (
          <div className="overflow-x-auto p-6">
            <div className="grid min-w-[960px] gap-4 md:grid-cols-5">
              {statusOptions.map((status) => {
                const items = boardByStatus[status] || [];
                return (
                  <section
                    key={status}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {formatTaskStatusLabel(status)}
                      </h3>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.length ? (
                        items.map((req) => (
                          <article
                            key={req.id}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2"
                          >
                            <p className="text-sm font-semibold text-slate-900">
                              {req.requirement_type || "Requirement"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Start: {req.start_date || "-"}
                            </p>
                            {req.end_date ? (
                              <p className="text-xs text-slate-500">End: {req.end_date}</p>
                            ) : null}
                            {req.notes ? (
                              <p className="mt-2 text-xs text-slate-600">{req.notes}</p>
                            ) : null}
                          </article>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500">No items</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}

        {selectedView === "gantt" ? (
          <div className="overflow-x-auto p-6">
            {ganttData.items.length ? (
              <div style={{ minWidth: `${timelineWidth}px` }}>
                <div className="relative h-8 border-b border-slate-200">
                  {timelineTicks.map((tick) => (
                    <div
                      key={`${tick.left}-${tick.label}`}
                      className="absolute top-0 h-8"
                      style={{ left: `${tick.left}%` }}
                    >
                      <div className="h-4 border-l border-slate-200" />
                      <p className="-ml-4 text-[10px] text-slate-500">{tick.label}</p>
                    </div>
                  ))}
                </div>

                <div className="divide-y divide-slate-100">
                  {ganttData.items.map((req) => {
                    const offset = diffDays(ganttData.rangeStart, req.start);
                    const duration = Math.max(1, diffDays(req.start, req.end) + 1);
                    const left = (offset / ganttData.rangeDays) * 100;
                    const width = (duration / ganttData.rangeDays) * 100;
                    return (
                      <div key={req.id} className="grid grid-cols-[280px_minmax(0,1fr)] items-center py-3">
                        <div className="pr-4">
                          <p className="text-sm font-semibold text-slate-900">
                            {req.requirement_type || "Requirement"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {req.start_date || "-"} to {req.end_date || "Today"}
                          </p>
                        </div>
                        <div className="relative h-5 rounded bg-slate-100">
                          <div
                            className="absolute top-0 h-5 rounded bg-slate-700"
                            style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                            title={`${req.start_date || "-"} - ${req.end_date || "Today"}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No requirements yet.</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
