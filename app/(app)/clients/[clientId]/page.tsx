import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "./_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;
const visibilityOptions = ["internal", "client_shared"] as const;

export default async function ClientOverviewPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id,name,code,status,industry,website,notes,created_at,start_date,contract_renewal_date,hq_address"
    )
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: clientNotes, error: clientNotesError } = await supabase
    .from("notes")
    .select("id,content,created_at,user_id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function updateClient(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const name = String(formData.get("name") || "").trim();
    const code = String(formData.get("code") || client.code || "").trim();
    const status = String(formData.get("status") || "active");
    const industry = String(formData.get("industry") || "").trim();
    const website = String(formData.get("website") || "").trim();
    const startDate = String(formData.get("start_date") || "");
    const contractRenewalDate = String(formData.get("contract_renewal_date") || "");
    const hqAddress = String(formData.get("hq_address") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!name) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent("Name is required")}`);
    }

    const { error } = await supabase
      .from("clients")
      .update({
        name,
        code,
        status,
        industry: industry || null,
        website: website || null,
        start_date: startDate || null,
        contract_renewal_date: contractRenewalDate || null,
        hq_address: hqAddress || null,
        notes: notes || null,
      })
      .eq("id", clientId);

    if (error) {
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/notes`);
    redirect(`/clients/${clientId}?success=Saved`);
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
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Note%20deleted`);
  }

  async function createNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const content = String(formData.get("content") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!content) {
      redirect(`/clients/${clientId}?error=Note%20content%20is%20required`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;

    if (!authUser) {
      redirect(`/clients/${clientId}?error=You%20must%20be%20signed%20in%20to%20add%20notes`);
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
          redirect(`/clients/${clientId}?error=${encodeURIComponent(userError.message)}`);
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
      redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?success=Note%20saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Client
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{client.name}</h1>
      </section>

      <ClientTabs clientId={clientId} active="overview" />

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
        <h2 className="text-lg font-semibold text-slate-900">Client details</h2>
        <form action={updateClient} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={client.name}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={client.status || "active"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="industry">
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              defaultValue={client.industry || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="website">
              Website
            </label>
            <input
              id="website"
              name="website"
              defaultValue={client.website || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="start_date">
              Start date
            </label>
            <input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={client.start_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="contract_renewal_date"
            >
              Contract renewal date
            </label>
            <input
              id="contract_renewal_date"
              name="contract_renewal_date"
              type="date"
              defaultValue={client.contract_renewal_date || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="hq_address">
              HQ address
            </label>
            <textarea
              id="hq_address"
              name="hq_address"
              defaultValue={client.hq_address || ""}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save changes
            </button>
          </div>
        </form>

        <div className="mt-8 border-t border-slate-200 pt-6">
          <h3 className="text-base font-semibold text-slate-900">Published notes</h3>
          {clientNotesError ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Unable to load notes. Check Supabase RLS policies for the notes table.
            </p>
          ) : null}
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
                {clientNotes?.length ? (
                  clientNotes.map((note) => (
                    <tr key={note.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">
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
                    <td className="px-4 py-6 text-slate-500" colSpan={4}>
                      No notes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}


