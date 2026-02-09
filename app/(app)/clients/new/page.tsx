import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;
const toClientCode = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const ensureUniqueClientCode = async (base: string) => {
  const supabase = createSupabaseServerClient();
  const safeBase = base || "client";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? safeBase : `${safeBase}-${attempt + 1}`;
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!data) {
      return candidate;
    }
  }
  return `${safeBase}-${Date.now()}`;
};

export default async function NewClientPage(props: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const searchParams = await props.searchParams;
  async function createClient(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const creatorId = authData.user?.id;
    if (!creatorId) {
      redirect("/login");
    }
    const name = String(formData.get("name") || "").trim();
    const status = String(formData.get("status") || "active");
    const industry = String(formData.get("industry") || "").trim();
    const website = String(formData.get("website") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!name) {
      redirect("/clients/new?error=Name%20is%20required");
    }

    const { data: existingName } = await supabase
      .from("clients")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existingName) {
      redirect("/clients/new?error=Client%20name%20already%20exists");
    }

    const code = await ensureUniqueClientCode(toClientCode(name));

    const { data, error } = await supabase
      .from("clients")
      .insert({
        name,
        code,
        status,
        created_by_user_id: creatorId,
        industry: industry || null,
        website: website || null,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      redirect(`/clients/new?error=${encodeURIComponent(error?.message || "Unable to create client")}`);
    }

    redirect(`/clients/${data.id}`);
  }

  return (
    <div className="space-y-8">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Create client</h1>
          <p className="text-sm text-slate-600">Add a new client profile.</p>
        </div>
        <Link href="/clients" className="text-sm text-slate-600 hover:underline">
          Back to clients
        </Link>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <form action={createClient} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Client name
            </label>
            <input
              id="name"
              name="name"
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
              defaultValue="active"
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
              type="url"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Create client
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

