import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listScoutJobs, SCOUT_STATUSES, type ScoutJob, type ScoutStatus } from "@/lib/scout";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { createScoutJobAction, updateScoutJobStatusAction } from "./actions";

export const dynamic = "force-dynamic";

type ScoutPageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    scout?: string;
    detail?: string;
  }>;
};

const STATUS_LABELS: Record<ScoutStatus, string> = {
  active: "Active",
  watchlist: "Watchlist",
  contacted: "Contacted",
  ignore: "Ignore",
};

const STATUS_STYLES: Record<ScoutStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watchlist: "border-amber-200 bg-amber-50 text-amber-700",
  contacted: "border-sky-200 bg-sky-50 text-sky-700",
  ignore: "border-slate-200 bg-slate-100 text-slate-700",
};

function getMessage(code?: string, detail?: string) {
  switch (String(code || "").trim()) {
    case "created":
      return { tone: "success" as const, text: "Role saved." };
    case "updated":
      return { tone: "success" as const, text: "Role updated." };
    case "missing-fields":
      return { tone: "error" as const, text: "Company and role title are required." };
    case "ignore-reason-required":
      return { tone: "error" as const, text: "Ignore needs a reason." };
    case "invalid-status":
      return { tone: "error" as const, text: "Invalid status." };
    case "missing-job":
    case "create-failed":
    case "update-failed":
    case "history-failed":
      return { tone: "error" as const, text: detail || "Scout update failed." };
    default:
      return null;
  }
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function JobRow({ job, canManage }: { job: ScoutJob; canManage: boolean }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[job.status]}`}>
              {STATUS_LABELS[job.status]}
            </span>
            {job.source_name ? (
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {job.source_name}
              </span>
            ) : null}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">{job.role_title}</h2>
            <p className="text-sm text-slate-600">{job.company_name}</p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
            {job.location_text ? <span>{job.location_text}</span> : null}
            {job.employment_type ? <span>{job.employment_type}</span> : null}
            {job.compensation_text ? <span>{job.compensation_text}</span> : null}
            <span>Updated {formatDateTime(job.status_updated_at)}</span>
          </div>

          {job.role_summary ? <p className="max-w-3xl text-sm text-slate-600">{job.role_summary}</p> : null}

          {job.status === "ignore" && job.ignore_reason ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">Ignore reason:</span> {job.ignore_reason}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 text-sm text-slate-500">
            {job.source_url ? (
              <a
                className="font-medium text-sky-700 underline-offset-4 hover:underline"
                href={job.source_url}
                rel="noreferrer"
                target="_blank"
              >
                Open source
              </a>
            ) : null}
            {job.contacted_at ? <span>Contacted {formatDateTime(job.contacted_at)}</span> : null}
            {job.ignored_at ? <span>Ignored {formatDateTime(job.ignored_at)}</span> : null}
          </div>
        </div>

        {canManage ? (
          <form action={updateScoutJobStatusAction} className="w-full max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input name="jobId" type="hidden" value={job.id} />
            <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-end">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Status</span>
                <select
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                  defaultValue={job.status}
                  name="status"
                >
                  {SCOUT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Ignore reason</span>
                <textarea
                  className="min-h-[92px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                  defaultValue={job.ignore_reason || ""}
                  name="ignoreReason"
                  placeholder="Required when status is Ignore"
                />
              </label>

              <button
                type="submit"
                className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Save
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}

export default async function ScoutPage({ searchParams }: ScoutPageProps) {
  const params = (await searchParams) || {};
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const canEditResult = await supabase.rpc("can_edit_page", { p_page_key: "scout" });
  const canManage = Boolean(canEditResult.data);

  let jobs: ScoutJob[] = [];
  let missingSchema = false;

  try {
    jobs = await listScoutJobs({ query: params.q, status: params.status });
  } catch (error) {
    if (isSupabaseMissingTableError(error as { message?: string; code?: string })) {
      missingSchema = true;
    } else {
      throw error;
    }
  }

  const message = getMessage(params.scout, params.detail);
  const counts = jobs.reduce(
    (acc, job) => {
      acc.total += 1;
      acc[job.status] += 1;
      return acc;
    },
    { total: 0, active: 0, watchlist: 0, contacted: 0, ignore: 0 }
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Scout</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Hiring tracker</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Keep customer service role leads inside ResOpsHub, move them through a simple funnel, and capture why a lead gets dropped.
          </p>
        </div>
      </section>

      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {missingSchema ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Scout is in the app, but the Supabase migration has not been applied yet.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total roles" value={counts.total} />
            <StatCard label="Active" value={counts.active} />
            <StatCard label="Watchlist" value={counts.watchlist} />
            <StatCard label="Contacted" value={counts.contacted} />
            <StatCard label="Ignored" value={counts.ignore} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Tracked roles</h2>
                  <p className="text-sm text-slate-500">Filter the shortlist and keep the status current.</p>
                </div>
                <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_auto]">
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    defaultValue={String(params.q || "")}
                    name="q"
                    placeholder="Search company, role, location"
                  />
                  <select
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    defaultValue={String(params.status || "")}
                    name="status"
                  >
                    <option value="">All statuses</option>
                    {SCOUT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Filter
                  </button>
                </form>
              </div>

              {jobs.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 px-6 py-12 text-center text-sm text-slate-500">
                  No tracked roles yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <JobRow key={job.id} canManage={canManage} job={job} />
                  ))}
                </div>
              )}
            </section>

            <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900">Add role</h2>
                <p className="text-sm text-slate-500">Quick capture for jobs you want to track in ResOpsHub.</p>
              </div>

              {canManage ? (
                <form action={createScoutJobAction} className="mt-5 space-y-3">
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="companyName"
                    placeholder="Company name"
                    required
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="roleTitle"
                    placeholder="Role title"
                    required
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="locationText"
                    placeholder="Location"
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="employmentType"
                    placeholder="Employment type"
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="compensationText"
                    placeholder="Compensation"
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="sourceName"
                    placeholder="Source"
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="sourceUrl"
                    placeholder="Source URL"
                    type="url"
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="externalJobKey"
                    placeholder="Optional external job key"
                  />
                  <textarea
                    className="min-h-[120px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                    name="roleSummary"
                    placeholder="Notes or summary"
                  />
                  <button
                    className="h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                    type="submit"
                  >
                    Save role
                  </button>
                </form>
              ) : (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  You have view-only access to Scout.
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
