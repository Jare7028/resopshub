import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadHelpGuides } from "@/lib/helpGuidesStore";
import HelpRichContent from "../_components/HelpRichContent";
import { buildGuideSingleDoc } from "../_lib/guideSingleDoc";
import HelpGuideEditorClient from "./HelpGuideEditorClient";

export const dynamic = "force-dynamic";

export default async function HelpGuidePage(props: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;
  const { guides, overrideSlugs } = await loadHelpGuides();
  const guide = guides.find((entry) => entry.slug === slug) || null;

  if (!guide) {
    notFound();
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = String(authData.user?.id || "").trim();
  let isAdmin = false;
  if (authUserId) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", authUserId)
      .maybeSingle();
    isAdmin = profile?.role === "admin";
  }
  const isEditMode = isAdmin && String(searchParams?.edit || "") === "1";
  const guideDoc = buildGuideSingleDoc(guide);
  const displayTitle = String(guide.title || "").trim() || "Untitled guide";

  return (
    <div className="space-y-8">
      <nav className="text-sm text-slate-600">
        <Link href="/help" className="hover:underline">
          Help Center
        </Link>{" "}
        / <span className="text-slate-800">{displayTitle}</span>
      </nav>

      <section className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={guide.appPath}
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Open Related App Section
          </Link>
          <Link
            href="/help"
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            Back To All Guides
          </Link>
          {isAdmin && !isEditMode ? (
            <Link
              href={`/help/${guide.slug}?edit=1`}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Edit guide page
            </Link>
          ) : null}
        </div>
      </section>

      {isEditMode ? (
        <HelpGuideEditorClient
          initialGuide={guide}
          initialStorageSlug={guide.storageSlug}
          initialHasOverride={overrideSlugs.has(guide.storageSlug)}
        />
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <HelpRichContent content={guideDoc} />
        </section>
      )}
    </div>
  );
}
