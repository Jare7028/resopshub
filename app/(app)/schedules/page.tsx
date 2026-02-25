import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withPerfTiming } from "@/lib/perf";

type ClientRow = {
  id: string;
  name: string;
};

export default async function SchedulesPage() {
  const supabase = createSupabaseServerClient();
  const { data: clientsData, error: clientsError } = await withPerfTiming("schedules.clients", () =>
    supabase.from("clients").select("id,name").order("name", { ascending: true })
  );

  const clients = (clientsData || []) as ClientRow[];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Schedules</h1>
        <p className="text-sm text-slate-600">
          Select a client to open weekly schedule management.
        </p>
      </section>

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
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={2}>
                    No accessible clients found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
