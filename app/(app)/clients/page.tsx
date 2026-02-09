import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmDelete from "../_components/ConfirmDelete";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;

export default async function ClientsPage(props: {
  searchParams?: Promise<{ q?: string; status?: string; error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const query = (searchParams?.q || "").trim();
  const status = (searchParams?.status || "").trim();

  let request = supabase
    .from("clients")
    .select("id,name,status,industry,created_at")
    .order("created_at", { ascending: false });

  if (query) {
    request = request.ilike("name", `%${query}%`);
  }

  if (status && status !== "all") {
    request = request.eq("status", status);
  }

  const { data: clients } = await request;

  async function deleteClient(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const clientId = String(formData.get("client_id") || "");

    if (!clientId) {
      return;
    }

    const { error } = await supabase.from("clients").delete().eq("id", clientId);

    if (error) {
      redirect(`/clients?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/clients");
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-600">
            Manage client accounts, contacts, projects, tasks, and billing in one place.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
        >
          New client
        </Link>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Search</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-3">
          <input
            name="q"
            placeholder="Search by name"
            defaultValue={query}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue={status || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Apply filters
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">All clients</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Industry</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients?.length ? (
                clients.map((client) => (
                  <tr key={client.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      <Link href={`/clients/${client.id}`} className="hover:underline">
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {client.status?.replace("_", " ")}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {client.industry || "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {client.created_at
                        ? new Date(client.created_at).toLocaleDateString("en-US")
                        : "-"}
                    </td>
                    <td className="px-6 py-3">
                      <form action={deleteClient}>
                        <input type="hidden" name="client_id" value={client.id} />
                        <ConfirmDelete name={client.name} itemType="Client" />
                      </form>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
                    No clients found.
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


