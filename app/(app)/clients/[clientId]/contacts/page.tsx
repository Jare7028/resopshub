import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ClientContactsPage({
  params,
  searchParams,
}: {
  params: { clientId: string };
  searchParams?: { error?: string; success?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", params.clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: contacts } = await supabase
    .from("client_contacts")
    .select("id,full_name,title,email,phone,is_primary")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  async function createContact(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const fullName = String(formData.get("full_name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const isPrimary = formData.get("is_primary") === "on";

    if (!fullName) {
      redirect(`/clients/${client.id}/contacts?error=Name%20is%20required`);
    }

    const { error } = await supabase.from("client_contacts").insert({
      client_id: client.id,
      full_name: fullName,
      title: title || null,
      email: email || null,
      phone: phone || null,
      is_primary: isPrimary,
    });

    if (error) {
      redirect(`/clients/${client.id}/contacts?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${client.id}/contacts`);
    redirect(`/clients/${client.id}/contacts?success=Saved`);
  }

  async function updateContact(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const contactId = String(formData.get("contact_id") || "");
    const fullName = String(formData.get("full_name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const isPrimary = formData.get("is_primary") === "on";

    if (!contactId || !fullName) {
      redirect(`/clients/${client.id}/contacts?error=Contact%20name%20is%20required`);
    }

    const { error } = await supabase
      .from("client_contacts")
      .update({
        full_name: fullName,
        title: title || null,
        email: email || null,
        phone: phone || null,
        is_primary: isPrimary,
      })
      .eq("id", contactId);

    if (error) {
      redirect(`/clients/${client.id}/contacts?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${client.id}/contacts`);
    redirect(`/clients/${client.id}/contacts?success=Updated`);
  }

  async function deleteContact(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const contactId = String(formData.get("contact_id") || "");

    if (!contactId) {
      return;
    }

    const { error } = await supabase
      .from("client_contacts")
      .delete()
      .eq("id", contactId);

    if (error) {
      redirect(`/clients/${client.id}/contacts?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${client.id}/contacts`);
    redirect(`/clients/${client.id}/contacts?success=Deleted`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} · Contacts
        </h1>
        <ClientTabs clientId={client.id} active="contacts" />
      </section>

      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
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
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add contact</h2>
        <form action={createContact} className="mt-4 grid gap-4 md:grid-cols-5">
          <input
            name="full_name"
            placeholder="Full name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            name="title"
            placeholder="Title"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="phone"
            placeholder="Phone"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="is_primary" />
            Primary
          </label>
          <button
            type="submit"
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Add contact
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Contacts</h2>
        {contacts?.length ? (
          contacts.map((contact) => (
            <div key={contact.id} className="rounded-lg border border-slate-200 bg-white p-6">
              <form action={updateContact} className="grid gap-4 md:grid-cols-2">
                <input type="hidden" name="contact_id" value={contact.id} />
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Name</label>
                  <input
                    name="full_name"
                    defaultValue={contact.full_name}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Title</label>
                  <input
                    name="title"
                    defaultValue={contact.title || ""}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Email</label>
                  <input
                    name="email"
                    type="email"
                    defaultValue={contact.email || ""}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Phone</label>
                  <input
                    name="phone"
                    defaultValue={contact.phone || ""}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="is_primary" defaultChecked={contact.is_primary} />
                  Primary contact
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
                  >
                    Save
                  </button>
                  <button
                    type="submit"
                    formAction={deleteContact}
                    className="text-sm font-semibold text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </form>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No contacts yet.</p>
        )}
      </section>
    </div>
  );
}

