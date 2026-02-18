import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureClientPageViewAccess } from "../_lib/clientPageAccess";

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
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "documents",
  });

  const { data: documents } = await supabase
    .from("documents")
    .select(
      "id,title,source,external_url,filename,storage_path,visibility,size_bytes,created_at,mime_type,uploaded_by"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function uploadDocument(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const uploaderId = authData.user?.id;
    if (!uploaderId) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
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
      title: title || file.name,
      source: "upload",
      external_url: null,
      filename: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      visibility,
      uploaded_by: uploaderId,
    });

    if (error) {
      redirect(`/clients/${clientId}/documents?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/documents`);
    redirect(`/clients/${clientId}/documents`);
  }

  async function addLinkDocument(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const uploaderId = authData.user?.id;
    if (!uploaderId) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    const url = String(formData.get("url") || "").trim();
    const visibility = String(formData.get("visibility") || "internal");

    if (!title) {
      redirect(`/clients/${clientId}/documents?error=Document%20name%20is%20required`);
    }

    if (!url) {
      redirect(`/clients/${clientId}/documents?error=Link%20URL%20is%20required`);
    }

    const { error } = await supabase.from("documents").insert({
      client_id: clientId,
      title,
      source: "link",
      external_url: url,
      filename: null,
      storage_path: null,
      mime_type: null,
      size_bytes: null,
      visibility,
      uploaded_by: uploaderId,
    });

    if (error) {
      redirect(`/clients/${clientId}/documents?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/documents`);
    redirect(`/clients/${clientId}/documents`);
  }

  async function downloadDocument(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const documentId = String(formData.get("document_id") || "").trim();
    if (!documentId) {
      redirect(`/clients/${clientId}/documents?error=Missing%20document%20id`);
    }

    const { data: doc, error } = await supabase
      .from("documents")
      .select("id,storage_path,filename,source")
      .eq("id", documentId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (error || !doc) {
      redirect(`/clients/${clientId}/documents?error=Document%20not%20found`);
    }

    if (doc.source === "link") {
      redirect(`/clients/${clientId}/documents?error=This%20document%20is%20a%20link`);
    }

    if (!doc.storage_path) {
      redirect(`/clients/${clientId}/documents?error=Missing%20storage%20path`);
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60 * 15);

    if (signError || !signed?.signedUrl) {
      redirect(
        `/clients/${clientId}/documents?error=${encodeURIComponent(
          signError?.message || "Unable to download"
        )}`
      );
    }

    redirect(signed.signedUrl);
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
        <h2 className="text-lg font-semibold text-slate-900">Add document</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a file or add a link (OneDrive, Google Docs, etc.).
        </p>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Upload file</h3>
            <form action={uploadDocument} className="mt-4 grid gap-4">
              <input
                name="title"
                placeholder="Document name (optional)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
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
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Add link</h3>
            <form action={addLinkDocument} className="mt-4 grid gap-4">
              <input
                name="title"
                placeholder="Document name"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                name="url"
                type="url"
                placeholder="https:// ..."
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
                Add link
              </button>
            </form>
          </div>
        </div>
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
                      {doc.title || doc.filename || "Untitled document"}
                    </p>
                    {doc.source === "link" && doc.external_url ? (
                      <a
                        href={doc.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {doc.external_url}
                      </a>
                    ) : doc.storage_path ? (
                      <p className="text-xs text-slate-500">{doc.filename || doc.storage_path}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>
                      {doc.source === "link" ? "Link" : "Upload"}
                      {doc.size_bytes ? ` . ${Math.round(doc.size_bytes / 1024)} KB` : ""}
                      {doc.created_at
                        ? ` . ${new Date(doc.created_at).toLocaleDateString("en-US")}`
                        : ""}
                      {doc.visibility ? ` . ${doc.visibility}` : ""}
                    </span>
                    {doc.source === "upload" && doc.storage_path ? (
                      <form action={downloadDocument}>
                        <input type="hidden" name="document_id" value={doc.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Download
                        </button>
                      </form>
                    ) : null}
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



