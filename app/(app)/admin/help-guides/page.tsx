import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  HELP_GUIDES,
  normalizeHelpGuide,
} from "@/app/(app)/help/_data/guides";
import { loadHelpGuides } from "@/lib/helpGuidesStore";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

type AdminHelpSearchParams = {
  slug?: string;
  error?: string;
  success?: string;
};

async function requireAdminAccess() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = String(authData.user?.email || "").trim().toLowerCase();

  if (!authEmail) {
    notFound();
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  if (currentUser?.role !== "admin") {
    redirect("/clients");
  }

  return {
    supabase,
    appUserId: currentUser?.id || null,
  };
}

function buildGuideAdminUrl(slug: string, params?: { error?: string; success?: string }) {
  const sp = new URLSearchParams();
  if (slug) {
    sp.set("slug", slug);
  }
  if (params?.error) {
    sp.set("error", params.error);
  }
  if (params?.success) {
    sp.set("success", params.success);
  }
  const query = sp.toString();
  return query ? `/admin/help-guides?${query}` : "/admin/help-guides";
}

export default async function AdminHelpGuidesPage(props: {
  searchParams?: Promise<AdminHelpSearchParams>;
}) {
  const searchParams = await props.searchParams;
  await requireAdminAccess();

  async function saveGuideAction(formData: FormData) {
    "use server";

    const slug = String(formData.get("slug") || "").trim();
    const returnTo = buildGuideAdminUrl(slug || "");
    const guideJson = String(formData.get("guide_json") || "").trim();

    if (!slug) {
      redirect("/admin/help-guides?error=Guide%20slug%20is%20required");
    }
    if (!guideJson) {
      redirect(`${returnTo}&error=Guide%20content%20is%20required`);
    }

    let parsedGuide: unknown;
    try {
      parsedGuide = JSON.parse(guideJson);
    } catch {
      redirect(`${returnTo}&error=Guide%20JSON%20is%20invalid`);
    }

    const normalizedGuide = normalizeHelpGuide(parsedGuide);
    if (!normalizedGuide) {
      redirect(
        `${returnTo}&error=Guide%20format%20is%20invalid.%20Keep%20required%20fields%20and%20at%20least%20one%20section.`
      );
    }

    const { supabase, appUserId } = await requireAdminAccess();
    const guideToSave = {
      ...normalizedGuide,
      slug,
    };

    const { error } = await supabase.from("help_guides").upsert(
      {
        slug,
        guide: guideToSave,
        updated_by_user_id: appUserId,
      },
      { onConflict: "slug" }
    );
    if (error) {
      if (isSupabaseMissingTableError(error)) {
        redirect(
          `${returnTo}&error=Help%20guides%20table%20is%20missing.%20Run%20sql/help_guides.sql%20first.`
        );
      }
      redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/help");
    revalidatePath(`/help/${slug}`);
    revalidatePath("/admin/help-guides");
    redirect(`${returnTo}&success=Guide%20saved`);
  }

  async function resetGuideAction(formData: FormData) {
    "use server";

    const slug = String(formData.get("slug") || "").trim();
    const returnTo = buildGuideAdminUrl(slug || "");

    if (!slug) {
      redirect("/admin/help-guides?error=Guide%20slug%20is%20required");
    }

    const { supabase } = await requireAdminAccess();
    const { error } = await supabase.from("help_guides").delete().eq("slug", slug);
    if (error && !isSupabaseMissingTableError(error)) {
      redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/help");
    revalidatePath(`/help/${slug}`);
    revalidatePath("/admin/help-guides");
    redirect(`${returnTo}&success=Guide%20reset%20to%20default`);
  }

  const { guides, tableAvailable, overrideSlugs } = await loadHelpGuides();
  const selectedSlugRaw = String(searchParams?.slug || "").trim();
  const selectedSlug = selectedSlugRaw || guides[0]?.slug || HELP_GUIDES[0]?.slug || "";
  const selectedGuide = guides.find((guide) => guide.slug === selectedSlug) || null;
  const selectedGuideJson = selectedGuide
    ? `${JSON.stringify(selectedGuide, null, 2)}\n`
    : "";
  const selectedHasOverride = selectedGuide ? overrideSlugs.has(selectedGuide.slug) : false;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Admin . Help Guides</h1>
        <p className="text-sm text-slate-600">
          Edit help guides shown in Help & Walkthrough. Changes are live for all users.
        </p>
        <Link href="/admin" className="text-sm text-slate-600 hover:underline">
          Back to Admin
        </Link>
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

      {!tableAvailable ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">Help guide editing table is not set up yet.</p>
          <p className="mt-2">
            Run <code>sql/help_guides.sql</code> in Supabase SQL editor, then refresh this page.
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Guides</h2>
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-2">
            {guides.map((guide) => {
              const isSelected = guide.slug === selectedSlug;
              const hasOverride = overrideSlugs.has(guide.slug);
              return (
                <Link
                  key={guide.slug}
                  href={buildGuideAdminUrl(guide.slug)}
                  className={`mb-1 block rounded-md border px-3 py-2 text-sm ${
                    isSelected
                      ? "border-slate-300 bg-slate-100 text-slate-900"
                      : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold">{guide.title}</p>
                  <p className="text-xs text-slate-500">
                    {guide.slug} . {hasOverride ? "Custom" : "Default"}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          {selectedGuide ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900">{selectedGuide.title}</h2>
                <p className="text-sm text-slate-600">
                  Edit JSON and click Save guide. You can reset back to default at any time.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={`/help/${selectedGuide.slug}`}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                  >
                    Open guide
                  </Link>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                    Source: {selectedHasOverride ? "Custom override" : "Default content"}
                  </span>
                </div>
              </div>

              <form action={saveGuideAction} className="space-y-3">
                <input type="hidden" name="slug" value={selectedGuide.slug} />
                <label className="block text-sm font-medium text-slate-700">
                  Guide JSON
                  <textarea
                    name="guide_json"
                    defaultValue={selectedGuideJson}
                    spellCheck={false}
                    className="mt-1 min-h-[26rem] w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800"
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Save guide
                </button>
              </form>

              {selectedHasOverride ? (
                <form action={resetGuideAction}>
                  <input type="hidden" name="slug" value={selectedGuide.slug} />
                  <button
                    type="submit"
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Reset to default
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No guide selected.</p>
          )}
        </section>
      </div>
    </div>
  );
}

