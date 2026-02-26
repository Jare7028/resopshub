import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import RouteModalOverlay from "../_components/RouteModalOverlay";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withPerfTiming } from "@/lib/perf";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActionPanel = "" | "edit_client_settings";

type ClientRow = {
  id: string;
  name: string;
};

type JobCodeRow = {
  id: string;
  code: string;
  color_hex: string;
  is_active: boolean;
};

type ClientSettingsRow = {
  client_id: string;
  default_weekly_billable_hours: number | string | null;
  breaks_billable: boolean;
};

type BillableCodeRow = {
  job_code_id: string;
};

type WeeklyOverrideRow = {
  client_id: string;
  week_start_date: string;
  weekly_billable_hours: number | string | null;
};

function normalizeActionPanel(value: string | null | undefined): ActionPanel {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "edit_client_settings") return "edit_client_settings";
  return "";
}

function buildSchedulesPath(args: {
  action?: ActionPanel;
  clientId?: string;
  error?: string;
  success?: string;
}) {
  const sp = new URLSearchParams();
  if (args.action) sp.set("action", args.action);
  if (args.clientId) sp.set("client_id", args.clientId);
  if (args.error) sp.set("error", args.error);
  if (args.success) sp.set("success", args.success);
  const query = sp.toString();
  return query ? `/schedules?${query}` : "/schedules";
}

function buildClientSettingsPath(clientId: string, status?: { error?: string; success?: string }) {
  return buildSchedulesPath({
    action: "edit_client_settings",
    clientId,
    error: status?.error,
    success: status?.success,
  });
}

function parseNonNegativeNumber(value: FormDataEntryValue | null, label: string) {
  const text = String(value || "").trim();
  if (!text) return { value: 0, error: null as string | null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: 0, error: `${label} must be a non-negative number` };
  }
  return { value: parsed, error: null as string | null };
}

function toNonNegativeNumber(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatHours(value: number | string | null | undefined) {
  const parsed = toNonNegativeNumber(value, 0);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/\.?0+$/, "");
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatWeekLabel(value: string) {
  if (!isDateOnly(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function mondayForDate(value: Date) {
  const copy = new Date(`${toDateOnly(value)}T00:00:00.000Z`);
  const day = copy.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  copy.setUTCDate(copy.getUTCDate() - offset);
  return copy;
}

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    action?: string;
    client_id?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const resolvedSearch = await searchParams;
  const actionPanel = normalizeActionPanel(resolvedSearch?.action);
  const selectedClientIdRaw = String(resolvedSearch?.client_id || "").trim();
  const selectedClientId = uuidRegex.test(selectedClientIdRaw) ? selectedClientIdRaw : "";

  async function saveClientSettingsAction(formData: FormData) {
    "use server";

    const clientId = String(formData.get("client_id") || "").trim();
    if (!uuidRegex.test(clientId)) {
      redirect(buildSchedulesPath({ error: "Invalid client id" }));
    }

    const defaultHours = parseNonNegativeNumber(
      formData.get("default_weekly_billable_hours"),
      "Default weekly billable hours"
    );
    if (defaultHours.error) {
      redirect(buildClientSettingsPath(clientId, { error: defaultHours.error }));
    }

    const selectedJobCodeIdsRaw = formData
      .getAll("billable_job_code_ids")
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const hasInvalidJobCodeId = selectedJobCodeIdsRaw.some((value) => !uuidRegex.test(value));
    if (hasInvalidJobCodeId) {
      redirect(buildClientSettingsPath(clientId, { error: "Invalid billable job code selection" }));
    }

    const billableJobCodeIds = Array.from(new Set(selectedJobCodeIdsRaw));
    const breaksBillable = String(formData.get("breaks_billable") || "").trim() === "on";

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_upsert_client_billable_settings", {
      p_client_id: clientId,
      p_default_weekly_billable_hours: defaultHours.value,
      p_breaks_billable: breaksBillable,
      p_billable_job_code_ids: billableJobCodeIds,
    });

    revalidatePath("/schedules");
    revalidatePath(`/schedules/${clientId}`);

    redirect(
      error
        ? buildClientSettingsPath(clientId, { error: error.message })
        : buildClientSettingsPath(clientId, { success: "Client settings saved" })
    );
  }

  async function upsertWeeklyOverrideAction(formData: FormData) {
    "use server";

    const clientId = String(formData.get("client_id") || "").trim();
    if (!uuidRegex.test(clientId)) {
      redirect(buildSchedulesPath({ error: "Invalid client id" }));
    }

    const weekStartDate = String(formData.get("week_start_date") || "").trim();
    if (!isDateOnly(weekStartDate)) {
      redirect(buildClientSettingsPath(clientId, { error: "Week start date must be a valid date" }));
    }

    const weeklyHours = parseNonNegativeNumber(
      formData.get("weekly_billable_hours"),
      "Weekly billable hours"
    );
    if (weeklyHours.error) {
      redirect(buildClientSettingsPath(clientId, { error: weeklyHours.error }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_upsert_client_weekly_billable_override", {
      p_client_id: clientId,
      p_week_start_date: weekStartDate,
      p_weekly_billable_hours: weeklyHours.value,
    });

    revalidatePath("/schedules");
    revalidatePath(`/schedules/${clientId}`);

    redirect(
      error
        ? buildClientSettingsPath(clientId, { error: error.message })
        : buildClientSettingsPath(clientId, { success: "Weekly override saved" })
    );
  }

  async function deleteWeeklyOverrideAction(formData: FormData) {
    "use server";

    const clientId = String(formData.get("client_id") || "").trim();
    if (!uuidRegex.test(clientId)) {
      redirect(buildSchedulesPath({ error: "Invalid client id" }));
    }

    const weekStartDate = String(formData.get("week_start_date") || "").trim();
    if (!isDateOnly(weekStartDate)) {
      redirect(buildClientSettingsPath(clientId, { error: "Invalid weekly override date" }));
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.rpc("schedule_delete_client_weekly_billable_override", {
      p_client_id: clientId,
      p_week_start_date: weekStartDate,
    });

    revalidatePath("/schedules");
    revalidatePath(`/schedules/${clientId}`);

    redirect(
      error
        ? buildClientSettingsPath(clientId, { error: error.message })
        : buildClientSettingsPath(clientId, { success: "Weekly override removed" })
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: clientsData, error: clientsError } = await withPerfTiming("schedules.clients", () =>
    supabase.from("clients").select("id,name").order("name", { ascending: true })
  );

  const clients = (clientsData || []) as ClientRow[];
  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) || null
    : null;

  let canEditSelectedClient = false;
  let modalLoadError = "";
  let jobCodes: JobCodeRow[] = [];
  let settings: ClientSettingsRow | null = null;
  let billableCodeRows: BillableCodeRow[] = [];
  let weeklyOverrides: WeeklyOverrideRow[] = [];

  if (actionPanel === "edit_client_settings") {
    if (!selectedClient) {
      modalLoadError = "Selected client was not found or is not accessible.";
    } else {
      const [
        { data: canEditData, error: canEditError },
        { data: jobCodesData, error: jobCodesError },
        { data: settingsData, error: settingsError },
        { data: billableCodesData, error: billableCodesError },
        { data: overridesData, error: overridesError },
      ] = await Promise.all([
        supabase.rpc("schedule_can_edit_client", { client_uuid: selectedClient.id }),
        supabase
          .from("schedule_job_codes")
          .select("id,code,color_hex,is_active")
          .order("sort_order", { ascending: true })
          .order("code", { ascending: true }),
        supabase
          .from("schedule_client_settings")
          .select("client_id,default_weekly_billable_hours,breaks_billable")
          .eq("client_id", selectedClient.id)
          .maybeSingle(),
        supabase
          .from("schedule_client_billable_job_codes")
          .select("job_code_id")
          .eq("client_id", selectedClient.id),
        supabase
          .from("schedule_client_weekly_billable_overrides")
          .select("client_id,week_start_date,weekly_billable_hours")
          .eq("client_id", selectedClient.id)
          .order("week_start_date", { ascending: false }),
      ]);

      const firstError =
        canEditError || jobCodesError || settingsError || billableCodesError || overridesError;

      if (firstError) {
        modalLoadError = firstError.message;
      }

      canEditSelectedClient = Boolean(canEditData);
      jobCodes = (jobCodesData || []) as JobCodeRow[];
      settings = (settingsData || null) as ClientSettingsRow | null;
      billableCodeRows = (billableCodesData || []) as BillableCodeRow[];
      weeklyOverrides = (overridesData || []) as WeeklyOverrideRow[];
    }
  }

  const hasSettingsData = Boolean(settings) || billableCodeRows.length > 0;
  const selectedBillableCodeIds = hasSettingsData
    ? new Set(billableCodeRows.map((row) => row.job_code_id))
    : new Set(jobCodes.map((code) => code.id));
  const defaultWeeklyBillableHours = toNonNegativeNumber(settings?.default_weekly_billable_hours, 0);
  const breaksBillable = settings?.breaks_billable ?? true;
  const defaultOverrideWeekStart = toDateOnly(mondayForDate(new Date()));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Schedules</h1>
        <p className="text-sm text-slate-600">
          Select a client to open weekly schedule management and billable settings.
        </p>
      </section>

      {resolvedSearch?.error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {resolvedSearch.error}
        </section>
      ) : null}

      {resolvedSearch?.success ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {resolvedSearch.success}
        </section>
      ) : null}

      {clientsError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load clients: {clientsError.message}
        </section>
      ) : null}

      {!clientsError ? (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Client Name</th>
                <th className="px-6 py-3 text-slate-700">Action</th>
                <th className="px-6 py-3 text-slate-700">Client Settings</th>
              </tr>
            </thead>
            <tbody>
              {clients.length ? (
                clients.map((client) => (
                  <tr key={client.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">{client.name}</td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/schedules/${client.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Open schedule
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={buildSchedulesPath({
                          action: "edit_client_settings",
                          clientId: client.id,
                        })}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5"
                        >
                          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                          <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6-2-3.4-2.5 1a8.8 8.8 0 0 0-1.7-1l-.4-2.7H9.1l-.4 2.7a8.8 8.8 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 13a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1L2.5 16.6l2 3.4 2.5-1a8.8 8.8 0 0 0 1.7 1l.4 2.7h5.8l.4-2.7a8.8 8.8 0 0 0 1.7-1l2.5 1 2-3.4L19.4 15Z" />
                        </svg>
                        <span>Edit Client Settings</span>
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={3}>
                    No accessible clients found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      {actionPanel === "edit_client_settings" ? (
        <RouteModalOverlay closeHref="/schedules" overlayLabel="Close client settings dialog">
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pt-8">
            <section className="w-full max-w-3xl rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold text-slate-900">
                  Edit Client Settings{selectedClient ? ` - ${selectedClient.name}` : ""}
                </h2>
                <Link
                  href="/schedules"
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </Link>
              </div>

              <div className="space-y-5 px-4 pb-5 pt-4 md:px-6 md:pb-6">
                {modalLoadError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {modalLoadError}
                  </p>
                ) : null}

                {selectedClient && !modalLoadError ? (
                  <>
                    <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                      <h3 className="text-sm font-semibold text-slate-900">Billable defaults</h3>
                      <p className="mt-1 text-xs text-slate-600">
                        Configure weekly target, break treatment, and job codes that count as billable.
                      </p>

                      <form action={saveClientSettingsAction} className="mt-4 space-y-4">
                        <input type="hidden" name="client_id" value={selectedClient.id} />

                        <label className="block text-xs text-slate-600">
                          Default weekly billable hours
                          <input
                            type="number"
                            name="default_weekly_billable_hours"
                            min={0}
                            step="0.25"
                            defaultValue={defaultWeeklyBillableHours}
                            disabled={!canEditSelectedClient}
                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                          />
                        </label>

                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            name="breaks_billable"
                            defaultChecked={breaksBillable}
                            disabled={!canEditSelectedClient}
                          />
                          Breaks are billable
                        </label>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Billable job codes
                          </p>
                          <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-slate-200 bg-white p-2">
                            {jobCodes.length ? (
                              jobCodes.map((code) => (
                                <label
                                  key={code.id}
                                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <input
                                      type="checkbox"
                                      name="billable_job_code_ids"
                                      value={code.id}
                                      defaultChecked={selectedBillableCodeIds.has(code.id)}
                                      disabled={!canEditSelectedClient}
                                    />
                                    <span
                                      className="inline-flex h-2.5 w-2.5 rounded-full"
                                      style={{ backgroundColor: code.color_hex }}
                                    />
                                    <span className="truncate font-semibold text-slate-900">
                                      {code.code}
                                    </span>
                                  </span>
                                  {!code.is_active ? (
                                    <span className="text-[11px] font-semibold text-amber-700">
                                      inactive
                                    </span>
                                  ) : null}
                                </label>
                              ))
                            ) : (
                              <p className="px-2 py-1 text-sm text-slate-500">No job codes found.</p>
                            )}
                          </div>
                        </div>

                        {canEditSelectedClient ? (
                          <button
                            type="submit"
                            className="w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                          >
                            Save client settings
                          </button>
                        ) : (
                          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            You have view-only access for this client&apos;s schedule settings.
                          </p>
                        )}
                      </form>
                    </section>

                    <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                      <h3 className="text-sm font-semibold text-slate-900">Week-specific billable overrides</h3>
                      <p className="mt-1 text-xs text-slate-600">
                        Overrides apply to a Monday-start week only.
                      </p>

                      {canEditSelectedClient ? (
                        <form action={upsertWeeklyOverrideAction} className="mt-4 grid gap-2 md:grid-cols-3">
                          <input type="hidden" name="client_id" value={selectedClient.id} />
                          <label className="text-xs text-slate-600">
                            Week start (Monday)
                            <input
                              type="date"
                              name="week_start_date"
                              defaultValue={defaultOverrideWeekStart}
                              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                              required
                            />
                          </label>
                          <label className="text-xs text-slate-600">
                            Weekly billable hours
                            <input
                              type="number"
                              name="weekly_billable_hours"
                              min={0}
                              step="0.25"
                              defaultValue={defaultWeeklyBillableHours}
                              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                              required
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="submit"
                              className="w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                            >
                              Save override
                            </button>
                          </div>
                        </form>
                      ) : null}

                      <div className="mt-4 space-y-2">
                        {weeklyOverrides.length ? (
                          weeklyOverrides.map((override) => (
                            <div
                              key={`${override.client_id}-${override.week_start_date}`}
                              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">
                                  {formatWeekLabel(override.week_start_date)}
                                </p>
                                <p className="text-xs text-slate-600">
                                  Override target: {formatHours(override.weekly_billable_hours)}h
                                </p>
                              </div>
                              {canEditSelectedClient ? (
                                <form action={deleteWeeklyOverrideAction}>
                                  <input type="hidden" name="client_id" value={selectedClient.id} />
                                  <input
                                    type="hidden"
                                    name="week_start_date"
                                    value={override.week_start_date}
                                  />
                                  <button
                                    type="submit"
                                    className="text-xs font-semibold text-red-700 hover:underline"
                                  >
                                    Remove
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                            No weekly overrides configured.
                          </p>
                        )}
                      </div>
                    </section>
                  </>
                ) : null}
              </div>
            </section>
          </div>
        </RouteModalOverlay>
      ) : null}
    </div>
  );
}
