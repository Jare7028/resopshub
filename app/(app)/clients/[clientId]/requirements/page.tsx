import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ClientRequirementsPage({
  params,
  searchParams,
}: {
  params: { clientId: string };
  searchParams?: { error?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: requirements } = await supabase
    .from("requirements")
    .select("id,start_date,billable_hours,notes,created_at")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  async function createRequirement(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const startDate = String(formData.get("start_date") || "");
    const billableHoursRaw = String(formData.get("billable_hours") || "");
    const notes = String(formData.get("notes") || "").trim();
    const billableHours = Number(billableHoursRaw);

    if (!startDate) {
      redirect(`/clients/${client.id}/requirements?error=Start%20date%20is%20required`);
    }

    if (!billableHoursRaw || Number.isNaN(billableHours) || billableHours < 0) {
      redirect(`/clients/${client.id}/requirements?error=Billable%20hours%20must%20be%20a%20valid%20number`);
    }

    const { error } = await supabase.from("requirements").insert({
      client_id: client.id,
      start_date: startDate,
      billable_hours: billableHours,
      notes: notes || null,
    });

    if (error) {
      redirect(`/clients/${client.id}/requirements?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${client.id}/requirements`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Requirements
        </h1>
        <ClientTabs clientId={client.id} active="requirements" />
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add requirement</h2>
        <form action={createRequirement} className="mt-4 grid gap-4 md:grid-cols-3">
          <input
            type="date"
            name="start_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="number"
            step="0.25"
            min="0"
            name="billable_hours"
            placeholder="Billable hours"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="text"
            name="notes"
            placeholder="Notes"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-3"
          />
          <button
            type="submit"
            className="md:col-span-3 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
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
                <th className="px-6 py-3">Billable hours</th>
                <th className="px-6 py-3">Notes</th>
                <th className="px-6 py-3">Created</th>
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
                      {req.billable_hours}
                    </td>
                    <td className="px-6 py-3 text-slate-700">
                      {req.notes || ""}
                    </td>
                    <td className="px-6 py-3 text-slate-500">
                      {req.created_at
                        ? new Date(req.created_at).toLocaleDateString("en-US")
                        : ""}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={4}>
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

