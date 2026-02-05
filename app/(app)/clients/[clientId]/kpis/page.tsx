import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const KPI_SLOTS = [1, 2, 3] as const;

export default async function ClientKpisPage(props: {
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

  const { data: kpis } = await supabase
    .from("client_kpis")
    .select("id,position,name,value,note,updated_at")
    .eq("client_id", clientId)
    .order("position", { ascending: true });

  const byPosition = new Map<number, typeof kpis[number]>();
  kpis?.forEach((kpi) => {
    byPosition.set(kpi.position, kpi);
  });

  async function saveKpis(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    for (const position of KPI_SLOTS) {
      const name = String(formData.get(`name_${position}`) || "").trim();
      const value = String(formData.get(`value_${position}`) || "").trim();
      const note = String(formData.get(`note_${position}`) || "").trim();

      const hasData = name || value || note;

      if (!hasData) {
        await supabase
          .from("client_kpis")
          .delete()
          .eq("client_id", clientId)
          .eq("position", position);
        continue;
      }

      const { error } = await supabase.from("client_kpis").upsert(
        {
          client_id: clientId,
          position,
          name: name || null,
          value: value || null,
          note: note || null,
        },
        { onConflict: "client_id,position" }
      );

      if (error) {
        redirect(`/clients/${clientId}/kpis?error=${encodeURIComponent(error.message)}`);
      }
    }

    revalidatePath(`/clients/${clientId}/kpis`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . KPIs
        </h1>
        <ClientTabs clientId={clientId} active="kpis" />
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">KPI list</h2>
        <form action={saveKpis} className="mt-4 space-y-4">
          {KPI_SLOTS.map((position) => {
            const existing = byPosition.get(position);
            return (
              <div key={position} className="grid gap-3 md:grid-cols-3">
                <input
                  name={`name_${position}`}
                  placeholder="KPI name"
                  defaultValue={existing?.name ?? ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  name={`value_${position}`}
                  placeholder="Value"
                  defaultValue={existing?.value ?? ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  name={`note_${position}`}
                  placeholder="Note"
                  defaultValue={existing?.note ?? ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            );
          })}
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Save KPIs
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Current KPIs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">KPI</th>
                <th className="px-6 py-3">Value</th>
                <th className="px-6 py-3">Note</th>
                <th className="px-6 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {kpis?.length ? (
                kpis.map((kpi) => (
                  <tr key={kpi.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 text-slate-700">{kpi.name}</td>
                    <td className="px-6 py-3 text-slate-700">{kpi.value}</td>
                    <td className="px-6 py-3 text-slate-700">{kpi.note}</td>
                    <td className="px-6 py-3 text-slate-500">
                      {kpi.updated_at
                        ? new Date(kpi.updated_at).toLocaleDateString("en-US")
                        : ""}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={4}>
                    No KPIs set.
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


