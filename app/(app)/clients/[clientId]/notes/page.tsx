import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmDelete from "../../_components/ConfirmDelete";

export const dynamic = "force-dynamic";

const visibilityOptions = ["internal", "client_shared"] as const;

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
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: notes } = await supabase
    .from("notes")
    .select("id,content,visibility,created_at,user_id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function createNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const content = String(formData.get("content") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!content) {
      redirect(`/clients/${clientId}/notes?error=Note%20content%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;

    if (!authUser) {
      redirect(`/clients/${clientId}/notes?error=You%20must%20be%20signed%20in%20to%20add%20notes`);
    }

    const fallbackName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      (authUser.email ? authUser.email.split("@")[0] : "Unknown");

    const { data: existingById } = await supabase
      .from("users")
      .select("id")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!existingById && authUser.email) {
      const { data: existingByEmail } = await supabase
        .from("users")
        .select("id")
        .eq("email", authUser.email)
        .maybeSingle();

      if (!existingByEmail?.id) {
        const { error: userError } = await supabase.from("users").insert({
          id: authUser.id,
          email: authUser.email,
          full_name: fallbackName,
          role: "member",
          status: "active",
        });

        if (userError) {
          redirect(`/clients/${clientId}/notes?error=${encodeURIComponent(userError.message)}`);
        }
      }
    }

    const { error } = await supabase.from("notes").insert({
      client_id: clientId,
      project_id: null,
      content,
      visibility,
      user_id: authUser.id,
    });

    if (error) {
      redirect(`/clients/${clientId}/notes?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}/notes?success=Saved`);
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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Published notes</h2>
        <form action={createNote} className="mt-4 grid gap-3">
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
    </div>
  );
}



