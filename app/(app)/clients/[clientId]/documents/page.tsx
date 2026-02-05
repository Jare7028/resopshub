import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const visibilityOptions = ["internal", "client_shared"] as const;

export default async function ClientDocumentsPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string }>;
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

  const { data: documents } = await supabase
    .from("documents")
    .select("id,filename,storage_path,visibility,size_bytes,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function uploadDocument(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const file = formData.get("file") as File | null;
    const visibility = String(formData.get("visibility") || "internal");

    if (!file || file.size === 0) {
      redirect(`/clients/${clientId}/documents?error=File%20is%20required`);
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${clientId}/${Date.now()}_${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
      });

    if (uploadError) {
      redirect(`/clients/${clientId}/documents?error=${encodeURIComponent(uploadError.message)}`);
    }

    const { error } = await supabase.from("documents").insert({
      client_id: clientId,
      filename: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      visibility,
    });

    if (error) {
      redirect(`/clients/${clientId}/documents?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/documents`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} . Documents
        </h1>
        <ClientTabs clientId={clientId} active="documents" />
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Upload document</h2>
        <form action={uploadDocument} className="mt-4 grid gap-4">
          <input
            type="file"
            name="file"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
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
            className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Upload document
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {documents?.length ? (
            documents.map((doc) => (
              <div key={doc.id} className="px-6 py-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-slate-500">{doc.storage_path}</p>
                  </div>
                  <div className="text-xs text-slate-500">
                    {doc.size_bytes ? `${Math.round(doc.size_bytes / 1024)} KB` : ""}
                    {doc.created_at
                      ? ` . ${new Date(doc.created_at).toLocaleDateString("en-US")}`
                      : ""}
                    {doc.visibility ? ` . ${doc.visibility}` : ""}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="px-6 py-6 text-sm text-slate-500">No documents yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}



