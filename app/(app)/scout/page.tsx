import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listScoutJobs,
  SCOUT_STATUSES,
  type ScoutContact,
  type ScoutJob,
  type ScoutJobMetadata,
  type ScoutStatus,
} from "@/lib/scout";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { ScoutStatusCell } from "./status-cell";

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

function getMessage(code?: string, detail?: string) {
  switch (String(code || "").trim()) {
    case "updated":
      return { tone: "success" as const, text: "Role updated." };
    case "ignore-reason-required":
      return { tone: "error" as const, text: "Ignore needs a reason." };
    case "invalid-status":
      return { tone: "error" as const, text: "Invalid status." };
    case "missing-job":
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

function readJobMetadata(job: ScoutJob): ScoutJobMetadata {
  if (!job.metadata_json || typeof job.metadata_json !== "object" || Array.isArray(job.metadata_json)) {
    return {};
  }
  return job.metadata_json;
}

function getJobContacts(metadata: ScoutJobMetadata) {
  if (!Array.isArray(metadata.contacts)) return [] as ScoutContact[];
  return metadata.contacts.filter((contact) => contact && typeof contact === "object") as ScoutContact[];
}

function contactLabel(contact?: ScoutContact) {
  if (!contact) return null;
  const name = String(contact.name || "").trim();
  const title = String(contact.title || "").trim();
  if (!name) return null;
  return title ? `${name} • ${title}` : name;
}

function ContactCell({ contact }: { contact?: ScoutContact }) {
  const label = contactLabel(contact);
  const profile = String(contact?.profile || "").trim();

  if (!label) {
    return <span className="text-zinc-400">-</span>;
  }

  if (!profile) {
    return <span>{label}</span>;
  }

  return (
    <a href={profile} target="_blank" rel="noreferrer" className="font-medium text-zinc-800 hover:text-zinc-950">
      {label}
    </a>
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

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Scout</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Search across captured roles, keep the pipeline status current, and use the live ResOpsHub DB as the source of truth.
        </p>

        <form className="mt-5 grid gap-3 md:grid-cols-[1.8fr_1fr_auto]">
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search title, company, location"
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm"
          />
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm"
          >
            <option value="">All statuses</option>
            {SCOUT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <button className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white">Filter</button>
        </form>
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
        <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="max-h-[72vh] overflow-auto rounded-2xl border border-zinc-100">
            <table className="min-w-[1500px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-[0.12em] text-zinc-500">
                  <th className="sticky left-0 top-0 z-30 w-56 min-w-[14rem] bg-white px-3 py-3">Job</th>
                  <th className="sticky left-56 top-0 z-30 min-w-[12rem] bg-white px-3 py-3">Company</th>
                  <th className="sticky top-0 z-20 min-w-[12rem] bg-white px-3 py-3">Location</th>
                  <th className="sticky top-0 z-20 min-w-[8rem] bg-white px-3 py-3">Posted</th>
                  <th className="sticky top-0 z-20 min-w-[13rem] bg-white px-3 py-3">Status</th>
                  <th className="sticky top-0 z-20 min-w-[14rem] bg-white px-3 py-3">Finance contact</th>
                  <th className="sticky top-0 z-20 min-w-[14rem] bg-white px-3 py-3">CS contact</th>
                  <th className="sticky top-0 z-20 min-w-[14rem] bg-white px-3 py-3">Hiring contact</th>
                  <th className="sticky top-0 z-20 min-w-[7rem] bg-white px-3 py-3">Remote</th>
                  <th className="sticky top-0 z-20 min-w-[10rem] bg-white px-3 py-3">Links</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const metadata = readJobMetadata(job);
                  const contacts = getJobContacts(metadata);
                  const postedText = typeof metadata.posted_text === "string" ? metadata.posted_text : null;
                  const remoteType = typeof metadata.remote_type === "string" ? metadata.remote_type : null;
                  return (
                    <tr key={job.id} className="border-b border-zinc-100 align-top odd:bg-zinc-50/40">
                      <td className="sticky left-0 z-10 w-56 min-w-[14rem] bg-inherit px-3 py-3 font-medium text-zinc-900">
                        <div>{job.role_title}</div>
                        <div className="mt-1 text-xs font-normal text-zinc-500">
                          Updated {formatDateTime(job.status_updated_at) || "-"}
                        </div>
                      </td>
                      <td className="sticky left-56 z-10 min-w-[12rem] bg-inherit px-3 py-3 text-zinc-700">{job.company_name}</td>
                      <td className="px-3 py-3 text-zinc-700">{job.location_text || "-"}</td>
                      <td className="px-3 py-3 text-zinc-700">{postedText || "Unverified"}</td>
                      <td className="px-3 py-3">
                        <ScoutStatusCell jobId={job.id} status={job.status} ignoreReason={job.ignore_reason} />
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        <ContactCell contact={contacts[0]} />
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        <ContactCell contact={contacts[1]} />
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        <ContactCell contact={contacts[2]} />
                      </td>
                      <td className="px-3 py-3 text-zinc-700">{remoteType || "-"}</td>
                      <td className="px-3 py-3">
                        {job.source_url ? (
                          <a href={job.source_url} target="_blank" rel="noreferrer" className="font-medium text-zinc-800 hover:text-zinc-950">
                            Listing ↗
                          </a>
                        ) : (
                          <span className="text-zinc-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                      No jobs matched that filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
