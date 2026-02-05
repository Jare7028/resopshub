import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NotesPage(props: {
  searchParams?: Promise<{
    client?: string;
    user?: string;
    date_from?: string;
    date_to?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const selectedClient = (searchParams?.client || "").trim();
  const selectedUser = (searchParams?.user || "").trim();
  const dateFrom = (searchParams?.date_from || "").trim();
  const dateTo = (searchParams?.date_to || "").trim();

  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  let request = supabase
    .from("notes")
    .select("id,content,created_at,user_id,client_id,clients(name)")
    .order("created_at", { ascending: false });

  if (selectedClient && selectedClient !== "all") {
    request = request.eq("client_id", selectedClient);
  }

  if (selectedUser && selectedUser !== "all") {
    request = request.eq("user_id", selectedUser);
  }

  if (dateFrom) {
    request = request.gte("created_at", `${dateFrom}T00:00:00Z`);
  }

  if (dateTo) {
    request = request.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }

  const { data: notes } = await request;

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  async function deleteNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const noteId = String(formData.get("note_id") || "");

    if (!noteId) {
      return;
    }

    const { error } = await supabase.from("notes").delete().eq("id", noteId);

    if (error) {
      return;
    }

    revalidatePath("/notes");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Notes</h1>
        <p className="text-sm text-slate-600">
          View notes across all clients.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-4">
          <select
            name="client"
            defaultValue={selectedClient || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All clients</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="user"
            defaultValue={selectedUser || "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All users</option>
            {users?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email || "Unnamed user"}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="date_from"
            defaultValue={dateFrom}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            name="date_to"
            defaultValue={dateTo}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="md:col-span-4 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Apply filters
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">All notes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Note</th>
                <th className="px-4 py-2">Date added</th>
                <th className="px-4 py-2">User added</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {notes?.length ? (
                notes.map((note) => (
                  <tr key={note.id} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {getRelationName(note.clients, "Unknown client")}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-pre-line">
                      {note.content}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {note.created_at
                        ? new Date(note.created_at).toLocaleDateString("en-US")
                        : ""}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {note.user_id ? "Team member" : "Unknown user"}
                    </td>
                    <td className="px-4 py-3">
                      <form action={deleteNote}>
                        <input type="hidden" name="note_id" value={note.id} />
                        <button
                          type="submit"
                          className="text-sm font-semibold text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={5}>
                    No notes found.
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
