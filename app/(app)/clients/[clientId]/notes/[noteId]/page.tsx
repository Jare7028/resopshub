import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { plainTextToTiptapDoc } from "@/lib/plainTextToTiptapDoc";
import ClientNoteEditorClient from "./ClientNoteEditorClient";
import ConfirmDelete from "../../../../_components/ConfirmDelete";

export const dynamic = "force-dynamic";

const visibilityOptions = ["internal", "client_shared"] as const;

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

export default async function ClientNotePage(props: {
  params: Promise<{ clientId: string; noteId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const noteId = params.noteId;
  const supabase = createSupabaseServerClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select(
      "id,client_id,title,content,content_json,visibility,created_at,last_edited_at,last_edited_by_user_id,user_id,source_personal_page_id"
    )
    .eq("id", noteId)
    .eq("client_id", clientId)
    .single();

  if (noteError && isMissingColumnError(noteError)) {
    redirect(
      `/clients/${clientId}/notes?error=${encodeURIComponent(
        "Client notes need a database migration before note pages can be used."
      )}`
    );
  }

  if (!note) {
    notFound();
  }

  const linkedPersonalPageId = note.source_personal_page_id || null;

  const initialContent =
    note.content_json ?? plainTextToTiptapDoc(note.content || "");

  const lastEditedAtLabel = note.last_edited_at
    ? new Date(note.last_edited_at).toLocaleString("en-US")
    : note.created_at
    ? new Date(note.created_at).toLocaleString("en-US")
    : null;

  const lastEditorId = note.last_edited_by_user_id || note.user_id || null;
  const { data: lastEditor } = lastEditorId
    ? await supabase
        .from("users")
        .select("full_name,email")
        .eq("id", lastEditorId)
        .maybeSingle()
    : { data: null };

  const lastEditedByLabel = lastEditor
    ? lastEditor.full_name || lastEditor.email || null
    : null;

  async function updateNoteDetails(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!title) {
      redirect(`/clients/${clientId}/notes/${noteId}?error=Title%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const editorId = authData.user?.id ?? null;
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("notes")
      .update({
        title,
        visibility,
        last_edited_at: now,
        last_edited_by_user_id: editorId,
      })
      .eq("id", noteId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/notes/${noteId}?error=${encodeURIComponent(error.message)}`);
    }

    if (linkedPersonalPageId) {
      const { error: linkedPageSyncError } = await supabase
        .from("personal_pages")
        .update({
          title,
          updated_at: now,
          last_edited_at: now,
          last_edited_by_user_id: editorId,
        })
        .eq("id", linkedPersonalPageId);

      if (linkedPageSyncError && !isMissingColumnError(linkedPageSyncError)) {
        console.error("[clientNotes.updateNoteDetails.personal.syncTitle]", linkedPageSyncError.message);
      }
    }

    revalidatePath(`/clients/${clientId}/notes/${noteId}`);
    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/notes");
    if (linkedPersonalPageId) {
      revalidatePath(`/personal/${linkedPersonalPageId}`);
    }
    revalidatePath("/personal");
    redirect(`/clients/${clientId}/notes/${noteId}?success=Saved`);
  }

  async function deleteNote() {
    "use server";
    const supabase = createSupabaseServerClient();

    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", noteId)
      .eq("client_id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/notes/${noteId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/notes");
    redirect(`/clients/${clientId}/notes?success=Note%20deleted`);
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Client note
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{note.title}</h1>
          <p className="text-sm text-slate-600">
            <Link href={`/clients/${clientId}`} className="hover:underline">
              {client.name}
            </Link>{" "}
            /{" "}
            <Link href={`/clients/${clientId}/notes`} className="hover:underline">
              Notes
            </Link>
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          <form action={updateNoteDetails} className="flex flex-wrap items-end gap-2">
            <input
              name="title"
              defaultValue={note.title || ""}
              className="min-w-[240px] rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Note title"
              required
            />
            <select
              name="visibility"
              defaultValue={note.visibility || "internal"}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {visibilityOptions.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {visibility.replace("_", " ")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Update
            </button>
          </form>

          <form action={deleteNote}>
            <ConfirmDelete
              name={note.title || "this"}
              itemType="Note"
              triggerLabel="Delete note"
              confirmLabel="Confirm delete"
            />
          </form>
        </div>
      </section>

      <ClientTabs clientId={clientId} active="notes" />

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

      <ClientNoteEditorClient
        clientId={clientId}
        noteId={noteId}
        sourcePersonalPageId={linkedPersonalPageId}
        initialContent={initialContent}
        lastEditedAtLabel={lastEditedAtLabel}
        lastEditedByLabel={lastEditedByLabel}
      />
    </div>
  );
}
