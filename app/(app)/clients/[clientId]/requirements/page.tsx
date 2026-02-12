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

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message.toLowerCase() : "";
  return code === "42703" || message.includes("does not exist");
}

export default async function ClientRequirementsPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
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
          <h2 className="text-lg font-semibold text-slate-900">Requirements</h2>
        </div>

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
      </section>
    </div>
  );
}
