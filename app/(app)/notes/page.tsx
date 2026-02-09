import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmDelete from "../_components/ConfirmDelete";

export const dynamic = "force-dynamic";

type NoteRow = {
  id: string;
  title?: string | null;
  content?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  client_id?: string | null;
  last_edited_at?: string | null;
  last_edited_by_user_id?: string | null;
  clients?:
    | { name?: string | null }
    | { name?: string | null }[]
    | null
    | undefined;
};

type EditorUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

function truncate(value: string, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

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

  let supportsNotePages = true;

  let request = supabase
    .from("notes")
    .select(
      "id,title,content,created_at,user_id,client_id,last_edited_at,last_edited_by_user_id,clients(name)"
    )
    .order("last_edited_at", { ascending: false })
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

  let notes: NoteRow[] | null = null;
  let notesError: unknown = null;

  const { data: notePageRows, error: notePageError } = await request;

  if (notePageError && isMissingColumnError(notePageError)) {
    supportsNotePages = false;
    let legacyRequest = supabase
      .from("notes")
      .select("id,content,created_at,user_id,client_id,clients(name)")
      .order("created_at", { ascending: false });

    if (selectedClient && selectedClient !== "all") {
      legacyRequest = legacyRequest.eq("client_id", selectedClient);
    }

    if (selectedUser && selectedUser !== "all") {
      legacyRequest = legacyRequest.eq("user_id", selectedUser);
    }

    if (dateFrom) {
      legacyRequest = legacyRequest.gte("created_at", `${dateFrom}T00:00:00Z`);
    }

    if (dateTo) {
      legacyRequest = legacyRequest.lte("created_at", `${dateTo}T23:59:59.999Z`);
    }

    const { data: legacyRows, error: legacyError } = await legacyRequest;
    notes = legacyRows as NoteRow[] | null;
    notesError = legacyError;
  } else {
    notes = notePageRows as NoteRow[] | null;
    notesError = notePageError;
  }

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

  const lastEditorIds = supportsNotePages
    ? Array.from(
        new Set(
          (notes || [])
            .map((note) => note.last_edited_by_user_id || note.user_id)
            .filter(Boolean)
        )
      )
    : [];

  const { data: editorUsers } =
    supportsNotePages && lastEditorIds.length
      ? await supabase
          .from("users")
          .select("id,full_name,email")
          .in("id", lastEditorIds)
      : { data: [] as EditorUserRow[] };

  const editorMap = new Map<string, string>(
    ((editorUsers || []) as EditorUserRow[]).map((user) => [
      user.id,
      user.full_name || user.email || "Unknown user",
    ])
  );

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
        {notesError && !isMissingColumnError(notesError) ? (
          <p className="m-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            Unable to load notes. Check Supabase RLS policies for the notes table.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Client</th>
                {supportsNotePages ? (
                  <>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Preview</th>
                    <th className="px-4 py-2">Last edited</th>
                    <th className="px-4 py-2">Edited by</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-2">Note</th>
                    <th className="px-4 py-2">Date added</th>
                    <th className="px-4 py-2">User added</th>
                  </>
                )}
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {notes?.length ? (
                notes.map((note) => {
                  const lastEditedAt = note.last_edited_at || note.created_at || null;
                  const editedById =
                    note.last_edited_by_user_id || note.user_id || "";
                  const editedByLabel = editedById
                    ? editorMap.get(editedById) || "Unknown user"
                    : "Unknown user";

                  return (
                    <tr key={note.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {getRelationName(note.clients, "Unknown client")}
                      </td>
                      {supportsNotePages ? (
                        <>
                          <td className="px-4 py-3">
                            <Link
                              href={`/clients/${note.client_id}/notes/${note.id}`}
                              className="font-semibold text-slate-900 hover:underline"
                            >
                              {note.title || "Untitled"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {truncate(note.content || "") || "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {lastEditedAt
                              ? new Date(lastEditedAt).toLocaleString("en-US")
                              : ""}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {editedByLabel}
                          </td>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                      <td className="px-4 py-3">
                        <form action={deleteNote}>
                          <input type="hidden" name="note_id" value={note.id} />
                          <ConfirmDelete
                            name={
                              (note.content || "")
                                .replace(/\s+/g, " ")
                                .trim()
                                .slice(0, 40) || "this"
                            }
                            itemType="Note"
                          />
                        </form>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    className="px-4 py-6 text-slate-500"
                    colSpan={supportsNotePages ? 6 : 5}
                  >
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
