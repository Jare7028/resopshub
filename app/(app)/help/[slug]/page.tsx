import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadHelpGuides } from "@/lib/helpGuidesStore";
import HelpRichContent from "../_components/HelpRichContent";
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
  const relatedGuides = guide.related
    .map((relatedSlug) => guides.find((entry) => entry.slug === relatedSlug) || null)
    .filter(Boolean);

  return (
    <div className="space-y-8">
      <nav className="text-sm text-slate-600">
        <Link href="/help" className="hover:underline">
          Help Center
        </Link>{" "}
        / <span className="text-slate-800">{guide.title}</span>
      </nav>

      <section className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-slate-900">{guide.title}</h1>
          <p className="max-w-3xl text-sm text-slate-600">{guide.summary}</p>
          <p className="text-xs text-slate-500">
            Audience: {guide.audience} | Estimated time: {guide.estimatedTime}
          </p>
        </div>

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
              Edit guide
            </Link>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Before You Start</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          {guide.prerequisites.map((item) => (
            <li key={`${guide.slug}-prereq-${item}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">In This Guide</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {guide.sections.map((section) => (
            <li key={`${guide.slug}-toc-${section.id}`}>
              <a href={`#${section.id}`} className="hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </section>

      {isEditMode ? (
        <HelpGuideEditorClient
          initialGuide={guide}
          initialHasOverride={overrideSlugs.has(guide.slug)}
        />
      ) : (
        <div className="space-y-5">
          {guide.sections.map((section) => (
            <section
              key={`${guide.slug}-${section.id}`}
              id={section.id}
              className="rounded-lg border border-slate-200 bg-white p-6"
            >
              <h2 className="text-xl font-semibold text-slate-900">{section.title}</h2>
              <div className="mt-3">
                <HelpRichContent content={section.content} />
              </div>

              {section.links?.length ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Download Links
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {section.links.map((link) => (
                      <a
                        key={`${guide.slug}-${section.id}-link-${link.href}`}
                        href={link.href}
                        download
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {relatedGuides.length ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Related Guides</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {relatedGuides.map((relatedGuide) => (
              <Link
                key={`related-${relatedGuide?.slug}`}
                href={`/help/${relatedGuide?.slug}`}
                className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <p className="font-semibold text-slate-900">{relatedGuide?.title}</p>
                <p className="mt-1 text-xs text-slate-600">{relatedGuide?.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
