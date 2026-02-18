import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmDelete from "../../../_components/ConfirmDelete";
import { ensureClientPageViewAccess } from "../_lib/clientPageAccess";

export default async function ClientKpisPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
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
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "kpis",
  });

  const { data: kpis } = await supabase
    .from("client_kpis")
    .select("id,position,name,value,note,updated_at")
    .eq("client_id", clientId)
    .order("position", { ascending: true });

  async function updateKpi(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const kpiId = String(formData.get("kpi_id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const value = String(formData.get("value") || "").trim();
    const note = String(formData.get("note") || "").trim();

    if (!kpiId) {
      redirect(`/clients/${clientId}/kpis?error=Missing%20KPI%20id`);
    }

    if (!name) {
      redirect(`/clients/${clientId}/kpis?error=KPI%20name%20is%20required`);
    }

    if (!value && !note) {
      redirect(`/clients/${clientId}/kpis?error=Add%20a%20value%20or%20note`);
    }

    const { error } = await supabase
      .from("client_kpis")
      .update({
        name: name || null,
        value: value || null,
        note: note || null,
      })
      .eq("id", kpiId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/kpis?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/kpis`);
    redirect(`/clients/${clientId}/kpis?success=KPI%20updated`);
  }

  async function deleteKpi(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const kpiId = String(formData.get("kpi_id") || "").trim();

    if (!kpiId) {
      redirect(`/clients/${clientId}/kpis?error=Missing%20KPI%20id`);
    }

    const { error } = await supabase
      .from("client_kpis")
      .delete()
      .eq("id", kpiId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/kpis?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/kpis`);
    redirect(`/clients/${clientId}/kpis?success=KPI%20deleted`);
  }

  async function addKpi(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const value = String(formData.get("value") || "").trim();
    const note = String(formData.get("note") || "").trim();

    if (!name) {
      redirect(`/clients/${clientId}/kpis?error=KPI%20name%20is%20required`);
    }

    if (!value && !note) {
      redirect(`/clients/${clientId}/kpis?error=Add%20a%20value%20or%20note`);
    }

    const { data: last } = await supabase
      .from("client_kpis")
      .select("position")
      .eq("client_id", clientId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { error } = await supabase.from("client_kpis").insert({
      client_id: clientId,
      position: nextPosition,
      name: name || null,
      value: value || null,
      note: note || null,
    });

    if (error) {
      redirect(`/clients/${clientId}/kpis?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/kpis`);
    redirect(`/clients/${clientId}/kpis?success=KPI%20added`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . KPIs
        </h1>
        <ClientTabs clientId={clientId} active="kpis" />
      </section>

      {searchParams?.error || searchParams?.success ? (
        <div className="space-y-2">
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add KPI</h2>
        <p className="mt-1 text-sm text-slate-600">
          Add a KPI and it will appear in the table below.
        </p>
        <form action={addKpi} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <input
              name="name"
              placeholder="KPI name"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              name="value"
              placeholder="Value"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              name="note"
              placeholder="Note"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Add KPI
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
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {kpis?.length ? (
                kpis.map((kpi) => (
                  <tr key={kpi.id} className="border-t border-slate-200">
                    {(() => {
                      const formId = `kpi-${kpi.id}-edit`;
                      return (
                        <>
                          <td className="px-6 py-3 text-slate-700">
                            <input
                              form={formId}
                              name="name"
                              defaultValue={kpi.name || ""}
                              className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              aria-label="KPI name"
                              required
                            />
                          </td>
                          <td className="px-6 py-3 text-slate-700">
                            <input
                              form={formId}
                              name="value"
                              defaultValue={kpi.value || ""}
                              className="w-full min-w-[10rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              aria-label="Value"
                            />
                          </td>
                          <td className="px-6 py-3 text-slate-700">
                            <input
                              form={formId}
                              name="note"
                              defaultValue={kpi.note || ""}
                              className="w-full min-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                              aria-label="Note"
                            />
                          </td>
                          <td className="px-6 py-3 text-slate-500">
                            {kpi.updated_at
                              ? new Date(kpi.updated_at).toLocaleDateString("en-US")
                              : ""}
                          </td>
                          <td className="px-6 py-3">
                            <div className="flex flex-col items-start gap-3">
                              <form id={formId} action={updateKpi}>
                                <input type="hidden" name="kpi_id" value={kpi.id} />
                                <button
                                  type="submit"
                                  className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white"
                                >
                                  Save
                                </button>
                              </form>
                              <form action={deleteKpi}>
                                <input type="hidden" name="kpi_id" value={kpi.id} />
                                <ConfirmDelete name={kpi.name || "this"} itemType="KPI" />
                              </form>
                            </div>
                          </td>
                        </>
                      );
                    })()}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
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



