import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam } from "@/lib/queryParams";
import NotesView from "./NotesView";

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


export default async function NotesPage(props: {
  searchParams?: Promise<{
    client?: string | string[];
    user?: string | string[];
    date_from?: string;
    date_to?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const selectedClientIds = parseCsvParam(searchParams?.client);
  const selectedUserIds = parseCsvParam(searchParams?.user);
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

  if (selectedClientIds.length) {
    request = request.in("client_id", selectedClientIds);
  }

  if (selectedUserIds.length) {
    request = request.in("user_id", selectedUserIds);
  }

  const fromStamp = dateFrom ? `${dateFrom}T00:00:00Z` : "";
  const toStamp = dateTo ? `${dateTo}T23:59:59.999Z` : "";

  if (fromStamp || toStamp) {
    const lastEditedParts: string[] = [];
    const createdParts: string[] = ["last_edited_at.is.null"];

    if (fromStamp) {
      lastEditedParts.push(`last_edited_at.gte.${fromStamp}`);
      createdParts.push(`created_at.gte.${fromStamp}`);
    }

    if (toStamp) {
      lastEditedParts.push(`last_edited_at.lte.${toStamp}`);
      createdParts.push(`created_at.lte.${toStamp}`);
    }

    const lastEditedExpr =
      lastEditedParts.length > 1
        ? `and(${lastEditedParts.join(",")})`
        : lastEditedParts[0];
    const createdExpr = `and(${createdParts.join(",")})`;

    // Prefer last_edited_at, but include a fallback for older rows where it is null.
    request = request.or([lastEditedExpr, createdExpr].filter(Boolean).join(","));
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

    if (selectedClientIds.length) {
      legacyRequest = legacyRequest.in("client_id", selectedClientIds);
    }

    if (selectedUserIds.length) {
      legacyRequest = legacyRequest.in("user_id", selectedUserIds);
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

  const editorLabelsById = Object.fromEntries(editorMap.entries());

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

      {notesError && !isMissingColumnError(notesError) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Unable to load notes. Check Supabase RLS policies for the notes table.
        </p>
      ) : null}

      <NotesView
        notes={(notes || []) as NoteRow[]}
        supportsNotePages={supportsNotePages}
        clients={(clients || []) as { id: string; name: string }[]}
        users={
          (users || []) as { id: string; full_name: string | null; email: string | null }[]
        }
        editorLabelsById={editorLabelsById}
        initialFilters={{
          client: selectedClientIds,
          user: selectedUserIds,
          dateFrom,
          dateTo,
        }}
        onDelete={deleteNote}
      />
    </div>
  );
}
