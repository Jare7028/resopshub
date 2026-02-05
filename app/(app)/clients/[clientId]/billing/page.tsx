import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusOptions = ["pending", "approved", "paid", "void"] as const;

export default async function ClientBillingPage(props: {
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
    .eq("id", clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: billingProfile } = await supabase
    .from("billing_profiles")
    .select("id,display_name,billing_address,currency,tax_id,payment_terms,default_rate")
    .eq("client_id", clientId)
    .maybeSingle();

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const { data: records } = await supabase
    .from("billing_records")
    .select("id,invoice_number,amount,status,due_date,projects(name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function saveBillingProfile(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const displayName = String(formData.get("display_name") || "").trim();
    const billingAddress = String(formData.get("billing_address") || "").trim();
    const currency = String(formData.get("currency") || "USD").trim();
    const taxId = String(formData.get("tax_id") || "").trim();
    const paymentTerms = String(formData.get("payment_terms") || "").trim();
    const defaultRate = String(formData.get("default_rate") || "").trim();

    if (!displayName) {
      redirect(`/clients/${clientId}/billing?error=Billing%20profile%20name%20is%20required`);
    }

    const payload = {
      client_id: clientId,
      display_name: displayName,
      billing_address: billingAddress || null,
      currency,
      tax_id: taxId || null,
      payment_terms: paymentTerms || null,
      default_rate: defaultRate ? Number(defaultRate) : null,
    };

    const { error } = billingProfile
      ? await supabase.from("billing_profiles").update(payload).eq("id", billingProfile.id)
      : await supabase.from("billing_profiles").insert(payload);

    if (error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
    redirect(`/clients/${clientId}/billing?success=Saved`);
  }

  async function createBillingRecord(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const invoiceNumber = String(formData.get("invoice_number") || "").trim();
    const amount = Number(formData.get("amount") || 0);
    const status = String(formData.get("status") || "pending");
    const dueDate = String(formData.get("due_date") || "");
    const projectId = String(formData.get("project_id") || "");

    if (!amount) {
      redirect(`/clients/${clientId}/billing?error=Amount%20is%20required`);
    }

    const { error } = await supabase.from("billing_records").insert({
      client_id: clientId,
      billing_profile_id: billingProfile?.id || null,
      invoice_number: invoiceNumber || null,
      amount,
      status,
      due_date: dueDate || null,
      project_id: projectId || null,
    });

    if (error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} · Billing
        </h1>
        <ClientTabs clientId={clientId} active="billing" />
      </section>

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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Billing profile</h2>
        <form action={saveBillingProfile} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="display_name">
              Display name
            </label>
            <input
              id="display_name"
              name="display_name"
              defaultValue={billingProfile?.display_name || client.name}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="currency">
              Currency
            </label>
            <input
              id="currency"
              name="currency"
              defaultValue={billingProfile?.currency || "USD"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="billing_address">
              Billing address
            </label>
            <textarea
              id="billing_address"
              name="billing_address"
              rows={3}
              defaultValue={billingProfile?.billing_address || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="tax_id">
              Tax ID
            </label>
            <input
              id="tax_id"
              name="tax_id"
              defaultValue={billingProfile?.tax_id || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="payment_terms">
              Payment terms
            </label>
            <input
              id="payment_terms"
              name="payment_terms"
              defaultValue={billingProfile?.payment_terms || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="default_rate">
              Default rate
            </label>
            <input
              id="default_rate"
              name="default_rate"
              type="number"
              step="0.01"
              defaultValue={billingProfile?.default_rate ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save billing profile
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add billing record</h2>
        <form action={createBillingRecord} className="mt-4 grid gap-4 md:grid-cols-5">
          <input
            name="invoice_number"
            placeholder="Invoice #"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="status"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue="pending"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="due_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="project_id"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Project (optional)</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create billing record
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Billing records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Invoice</th>
                <th className="px-6 py-3">Project</th>
                <th className="px-6 py-3">Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {records?.length ? (
                records.map((record) => (
                  <tr key={record.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {record.invoice_number || "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {record.projects?.name ?? "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      ${record.amount?.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{record.status}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {record.due_date
                        ? new Date(record.due_date).toLocaleDateString("en-US")
                        : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
                    No billing records yet.
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

