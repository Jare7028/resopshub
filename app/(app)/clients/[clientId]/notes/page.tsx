import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmDelete from "../../../_components/ConfirmDelete";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";

export const dynamic = "force-dynamic";

const visibilityOptions = ["internal", "client_shared"] as const;

type ClientNoteRow = {
  id: string;
  title?: string | null;
  content?: string | null;
  visibility?: string | null;
  created_at?: string | null;
  last_edited_at?: string | null;
  last_edited_by_user_id?: string | null;
  user_id?: string | null;
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

function truncate(value: string, max = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export default async function ClientNotesPage(props: {
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

  let supportsNotePages = true;
  let notes: ClientNoteRow[] | null = null;
  let notesError: unknown = null;

  const { data: notePageRows, error: notePageError } = await supabase
    .from("notes")
    .select(
      "id,title,content,visibility,created_at,last_edited_at,last_edited_by_user_id,user_id"
    )
    .eq("client_id", clientId)
    .order("last_edited_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (notePageError && isMissingColumnError(notePageError)) {
    supportsNotePages = false;
    const { data: legacyRows, error: legacyError } = await supabase
      .from("notes")
      .select("id,content,visibility,created_at,user_id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    notes = legacyRows as ClientNoteRow[] | null;
    notesError = legacyError;
  } else {
    notes = notePageRows as ClientNoteRow[] | null;
    notesError = notePageError;
  }

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

  async function createNoteLegacy(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const content = String(formData.get("content") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!content) {
      redirect(`/clients/${clientId}/notes?error=Note%20content%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect(
        `/clients/${clientId}/notes?error=You%20must%20be%20signed%20in%20to%20add%20notes`
      );
    }

    const { error } = await supabase.from("notes").insert({
      client_id: clientId,
      project_id: null,
      content,
      visibility,
      user_id: user.id,
    });

    if (error) {
      redirect(`/clients/${clientId}/notes?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}/notes?success=Saved`);
  }

  async function createNotePage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!title) {
      redirect(`/clients/${clientId}/notes?error=Title%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect(`/clients/${clientId}/notes?error=You%20must%20be%20signed%20in`);
    }

    const now = new Date().toISOString();
    const contentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

    const { data: note, error } = await supabase
      .from("notes")
      .insert({
        client_id: clientId,
        project_id: null,
        title,
        visibility,
        content: contentText,
        content_json: DEFAULT_EDITOR_CONTENT,
        user_id: user.id,
        last_edited_at: now,
        last_edited_by_user_id: user.id,
      })
      .select("id")
      .single();

    if (error || !note) {
      redirect(
        `/clients/${clientId}/notes?error=${encodeURIComponent(
          error?.message || "Unable to create note"
        )}`
      );
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}/notes/${note.id}`);
  }

  async function deleteNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const noteId = String(formData.get("note_id") || "");

    if (!noteId) {
      return;
    }

    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", noteId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/notes?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/notes");
    redirect(`/clients/${clientId}/notes?success=Note%20deleted`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Notes
        </h1>
        <ClientTabs clientId={clientId} active="notes" />
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

      {notesError && !isMissingColumnError(notesError) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Unable to load notes. Check Supabase RLS policies for the notes table.
        </p>
      ) : null}

      {supportsNotePages ? (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Create note</h2>
            <form action={createNotePage} className="mt-4 grid gap-3 md:grid-cols-3">
              <input
                name="title"
                placeholder="Note title"
                className="md:col-span-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <select
                name="visibility"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                defaultValue="internal"
              >
                {visibilityOptions.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {visibility.replace("_", " ")}
                  </option>
                ))}
              </select>
              <div className="md:col-span-3 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Create note
                </button>
                <p className="text-xs text-slate-500">
                  Tip: type <span className="font-semibold">/</span> inside the note
                  to insert headings, lists, checklists, tables, and more.
                </p>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Notes</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Title</th>
                    <th className="px-6 py-3">Last edited</th>
                    <th className="px-6 py-3">Visibility</th>
                    <th className="px-6 py-3">Edited by</th>
                    <th className="px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notes?.length ? (
                    notes.map((note) => {
                      const lastEditedAt = note.last_edited_at || note.created_at;
                      const editedById = note.last_edited_by_user_id || note.user_id || "";
                      const editedByLabel = editedById ? editorMap.get(editedById) : "";
                      const snippet = truncate(note.content || "");

                      return (
                        <tr key={note.id} className="border-t border-slate-200">
                          <td className="px-6 py-3">
                            <Link
                              href={`/clients/${clientId}/notes/${note.id}`}
                              className="font-semibold text-slate-900 hover:underline"
                            >
                              {note.title || "Untitled"}
                            </Link>
                            {snippet ? (
                              <p className="mt-1 text-xs text-slate-500">{snippet}</p>
                            ) : null}
                          </td>
                          <td className="px-6 py-3 text-slate-600">
                            {lastEditedAt
                              ? new Date(lastEditedAt).toLocaleString("en-US")
                              : "-"}
                          </td>
                          <td className="px-6 py-3 text-slate-600">
                            {String(note.visibility || "internal").replace("_", " ")}
                          </td>
                          <td className="px-6 py-3 text-slate-600">
                            {editedByLabel || "Unknown user"}
                          </td>
                          <td className="px-6 py-3">
                            <form action={deleteNote}>
                              <input type="hidden" name="note_id" value={note.id} />
                              <ConfirmDelete name={note.title || "this"} itemType="Note" />
                            </form>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-6 py-6 text-slate-500" colSpan={5}>
                        No notes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Published notes</h2>
            <form action={createNoteLegacy} className="mt-4 grid gap-3">
              <textarea
                name="content"
                rows={3}
                placeholder="Write a note..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <div className="flex flex-wrap items-center gap-3">
                <select
                  name="visibility"
                  className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  defaultValue="internal"
                >
                  {visibilityOptions.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {visibility.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
                >
                  Publish note
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
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
                            <ConfirmDelete
                              name={truncate(note.content || "", 40) || "this"}
                              itemType="Note"
                            />
                          </form>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={4}>
                        No notes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
