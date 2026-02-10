import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam } from "@/lib/queryParams";
import ClientsTable from "./ClientsTable";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;

export default async function ClientsPage(props: {
  searchParams?: Promise<{
    q?: string;
    status?: string | string[];
    industry?: string | string[];
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const query = (searchParams?.q || "").trim();
  const selectedStatuses = parseCsvParam(searchParams?.status).filter((value) =>
    statusOptions.includes(value as (typeof statusOptions)[number])
  );
  const selectedIndustries = parseCsvParam(searchParams?.industry);

  let request = supabase
    .from("clients")
    .select("id,name,status,industry,created_at")
    .order("created_at", { ascending: false });

  if (query) {
    request = request.ilike("name", `%${query}%`);
  }

  if (selectedStatuses.length) {
    request = request.in("status", selectedStatuses);
  }

  if (selectedIndustries.length) {
    request = request.in("industry", selectedIndustries);
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

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">All clients</h2>
        </div>
        <ClientsTable
          clients={clients || []}
          statusOptions={statusOptions}
          initialFilters={{
            q: query,
            status: selectedStatuses,
            industry: selectedIndustries,
          }}
          onDelete={deleteClient}
        />
      </section>
    </div>
  );
}


