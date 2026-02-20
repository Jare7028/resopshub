import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

export const dynamic = "force-dynamic";

const HELP_NOTES_SLUG = "help-notes";
const MAX_HELP_NOTES_LENGTH = 100_000;

type HelpNotesRow = {
  guide?: unknown;
  updated_at?: string | null;
};

function readSingleSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function readHelpNotesText(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const candidate = value as { text?: unknown; content?: unknown };
  if (typeof candidate.text === "string") {
    return candidate.text;
  }
  if (typeof candidate.content === "string") {
    return candidate.content;
  }
  return "";
}

async function saveHelpNotes(formData: FormData) {
  "use server";

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = String(authData.user?.id || "").trim();
  if (!authUserId) {
    redirect("/help?error=You%20must%20be%20signed%20in%20to%20edit%20help%20notes.");
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id,role")
    .eq("id", authUserId)
    .maybeSingle();

  if (userError) {
    const message = isSupabaseMissingTableError(userError)
      ? "Users table is missing. Run sql/permissions_admin_member.sql first."
      : userError.message;
    redirect(`/help?error=${encodeURIComponent(message)}`);
  }

  if (user?.role !== "admin") {
    redirect("/help?error=Admin%20access%20is%20required%20to%20edit%20help%20notes.");
  }

  const rawContent = String(formData.get("content") || "");
  const content = rawContent.replace(/\r\n/g, "\n");

  if (content.length > MAX_HELP_NOTES_LENGTH) {
    redirect(
      `/help?error=${encodeURIComponent(
        `Help notes are too long. Maximum ${MAX_HELP_NOTES_LENGTH.toLocaleString()} characters.`
      )}`
    );
  }

  const { error: upsertError } = await supabase.from("help_guides").upsert(
    {
      slug: HELP_NOTES_SLUG,
      guide: { text: content },
      updated_by_user_id: authUserId,
    },
    { onConflict: "slug" }
  );

  if (upsertError) {
    const message = isSupabaseMissingTableError(upsertError)
      ? "Help guides table is missing. Run sql/help_guides.sql first."
      : upsertError.message;
    redirect(`/help?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/help");
  redirect("/help?success=Saved");
}

export default async function HelpPage(props: {
  searchParams?: Promise<{ success?: string | string[]; error?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const successMessage = readSingleSearchParam(searchParams?.success);
  const errorMessage = readSingleSearchParam(searchParams?.error);

  const supabase = createSupabaseServerClient();
  const [{ data: authData }, { data: notesRow, error: notesError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("help_guides")
      .select("guide,updated_at")
      .eq("slug", HELP_NOTES_SLUG)
      .maybeSingle(),
  ]);

  const authUserId = String(authData.user?.id || "").trim();
  let isAdmin = false;
  let usersTableMissing = false;

  if (authUserId) {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("role")
      .eq("id", authUserId)
      .maybeSingle();
    usersTableMissing = isSupabaseMissingTableError(userError);
    isAdmin = user?.role === "admin";
  }

  const tableMissing = isSupabaseMissingTableError(notesError);
  const loadErrorMessage =
    notesError && !tableMissing
      ? `Unable to load help notes: ${notesError.message}`
      : "";
  const canEdit = isAdmin && !tableMissing && !loadErrorMessage && !usersTableMissing;

  const noteRow = (notesRow || null) as HelpNotesRow | null;
  const notesText = readHelpNotesText(noteRow?.guide);
  const lastUpdated = noteRow?.updated_at
    ? new Date(noteRow.updated_at).toLocaleString()
    : "";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Help Notes</h1>
        <p className="text-sm text-slate-600">
          Simple plain-text notes for the Help page. Edit the text and click save.
        </p>
        {lastUpdated ? <p className="text-xs text-slate-500">Last updated: {lastUpdated}</p> : null}
      </section>

      {successMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {tableMissing ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Help notes need the `help_guides` table. Run `sql/help_guides.sql` in Supabase.
        </p>
      ) : null}

      {usersTableMissing ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Admin checks require the `users` table. Run `sql/permissions_admin_member.sql`.
        </p>
      ) : null}

      {loadErrorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadErrorMessage}
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          You can view this page, but only admins can edit help notes.
        </p>
      ) : null}

      <form action={saveHelpNotes} className="space-y-3">
        <textarea
          name="content"
          defaultValue={notesText}
          readOnly={!canEdit}
          spellCheck={false}
          className="min-h-[65vh] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 read-only:cursor-not-allowed read-only:bg-slate-50"
          placeholder="Write help notes here..."
        />
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={!canEdit}
            className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save notes
          </button>
        </div>
      </form>
    </div>
  );
}
