import Link from "next/link";
import { notFound } from "next/navigation";
import HelpRichContent from "@/app/(app)/help/_components/HelpRichContent";
import { createEmptyDoc } from "@/lib/editorContent";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";

export const dynamic = "force-dynamic";

function normalizeDoc(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyDoc();
  }
  return value;
}

export default async function SharedPersonalPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const safeToken = decodeURIComponent(String(token || "")).trim();
  if (!safeToken) {
    notFound();
  }

  const supabase = createSupabaseServerClient();
  const resolveResult = await supabase.rpc("resolve_personal_page_share_link", {
    p_token: safeToken,
  });

  if (isSupabaseMissingFunctionError(resolveResult.error)) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">
          Shared Personal Pages Not Configured
        </h1>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Run <code>sql/personal_page_share_links.sql</code> in Supabase SQL editor.
        </p>
      </div>
    );
  }

  if (resolveResult.error) {
    notFound();
  }

  const rows = (resolveResult.data || []) as Array<{
    page_id: string;
    page_title: string | null;
    page_content: unknown;
    page_updated_at: string | null;
  }>;
  const sharedPage = rows[0];
  if (!sharedPage?.page_id) {
    notFound();
  }

  const content = normalizeDoc(sharedPage.page_content);
  const updatedAtLabel = sharedPage.page_updated_at
    ? new Date(sharedPage.page_updated_at).toLocaleString("en-US")
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Shared personal note
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">
          {sharedPage.page_title || "Shared page"}
        </h1>
        {updatedAtLabel ? (
          <p className="text-sm text-slate-600">Last updated: {updatedAtLabel}</p>
        ) : null}
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <HelpRichContent content={content} />
      </section>

      <footer className="flex flex-wrap items-center gap-2">
        <Link
          href="/login"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
        >
          App login
        </Link>
      </footer>
    </div>
  );
}

