import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import PersonalSidebarTree from "./_components/PersonalSidebarTree";
import {
  loadPersonalPageUserStateMap,
  loadPersonalWorkspaceTree,
} from "./_lib/workspaceData";

export const dynamic = "force-dynamic";

const defaultPageContent = DEFAULT_EDITOR_CONTENT;
const defaultPageContentText = extractPlainText(defaultPageContent);

type PersonalWorkspacePage = {
  id: string;
  title: string | null;
  section_id: string | null;
  owner_id: string;
  share_mode: string | null;
  updated_at: string | null;
  sectionTitle: string;
};

type WorkspaceSearchParams = {
  tab?: string;
  q?: string;
  favorite?: string;
  page?: string;
  section?: string | string[];
  filter?: string;
  error?: string;
  share_mode?: string | string[];
  updated_from?: string;
  updated_to?: string;
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

function buildPersonalUrl(baseQuery: string, error?: string) {
  const sp = new URLSearchParams(baseQuery);
  if (error) {
    sp.set("error", error);
  }
  const qs = sp.toString();
  return qs ? `/personal?${qs}` : "/personal";
}

function getShareModeLabel(shareMode: string | null) {
  if (shareMode === "inherit") return "Shared section";
  if (shareMode === "custom") return "Shared page";
  return "Private";
}

function renderPageCards(
  items: PersonalWorkspacePage[],
  pageStateById: Record<string, { is_favorite?: boolean }>,
  emptyLabel: string
) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((page) => (
        <Link
          key={`workspace-card-${page.id}`}
          href={`/personal/${page.id}`}
          className="rounded-lg border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:shadow-sm"
        >
          <p className="truncate text-sm font-semibold text-slate-900">
            {page.title || "Untitled"}
            {pageStateById[page.id]?.is_favorite ? (
              <span className="ml-1 text-amber-500">*</span>
            ) : null}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">{page.sectionTitle}</p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>{getShareModeLabel(page.share_mode)}</span>
            <span>{page.updated_at ? new Date(page.updated_at).toLocaleDateString("en-US") : "-"}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default async function PersonalHome(props: {
  searchParams?: Promise<WorkspaceSearchParams>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const queryText = String(searchParams?.q || "").trim();
  const favoriteFilter = String(searchParams?.favorite || "").trim();
  const highlightedPageId = String(searchParams?.page || "").trim() || null;
  const selectedSectionIds = parseCsvParam(searchParams?.section);
  const selectedShareModes = parseCsvParam(searchParams?.share_mode);

  const baseParams = new URLSearchParams();
  if (queryText) baseParams.set("q", queryText);
  if (favoriteFilter) baseParams.set("favorite", favoriteFilter);
  if (highlightedPageId) baseParams.set("page", highlightedPageId);
  setCsvParam(baseParams, "section", selectedSectionIds);
  setCsvParam(baseParams, "share_mode", selectedShareModes);
  const baseQuery = baseParams.toString();

  const [
    { data: pageTemplatesRaw, error: pageTemplatesError },
    sidebarTree,
    { map: pageUserStateById, missingTable: pageUserStateTableMissing },
  ] = await Promise.all([
    supabase
      .from("personal_page_templates")
      .select("id,name")
      .eq("owner_id", user.id)
      .order("name", { ascending: true }),
    loadPersonalWorkspaceTree(
      supabase as unknown as Parameters<typeof loadPersonalWorkspaceTree>[0]
    ),
    loadPersonalPageUserStateMap(
      supabase as unknown as Parameters<typeof loadPersonalPageUserStateMap>[0]
    ),
  ]);
  const sections = sidebarTree.sections;

  const pageTemplatesTableMissing = Boolean(
    pageTemplatesError && isSupabaseMissingTableError(pageTemplatesError)
  );
  const pageTemplates = ((pageTemplatesError ? [] : pageTemplatesRaw) || []) as Array<{
    id: string;
    name: string;
  }>;

  const allWorkspacePages: PersonalWorkspacePage[] = [
    ...sidebarTree.generalPages.map((page) => ({
      ...page,
      sectionTitle: "General",
    })),
    ...sidebarTree.sections.flatMap((section) =>
      section.pages.map((page) => ({
        ...page,
        sectionTitle: section.title,
      }))
    ),
  ];

  const normalizedQuery = queryText.toLowerCase();
  const selectedSectionSet = new Set(selectedSectionIds);
  const selectedShareModeSet = new Set(selectedShareModes);
  const includeOnlyFavorites = favoriteFilter === "1";

  const filteredPages = allWorkspacePages.filter((page) => {
    if (selectedSectionSet.size) {
      const sectionId = page.section_id || "";
      if (!selectedSectionSet.has(sectionId)) {
        return false;
      }
    }
    if (selectedShareModeSet.size) {
      const shareMode = String(page.share_mode || "private");
      if (!selectedShareModeSet.has(shareMode)) {
        return false;
      }
    }
    if (normalizedQuery) {
      const title = String(page.title || "Untitled").toLowerCase();
      const sectionTitle = String(page.sectionTitle || "General").toLowerCase();
      if (!title.includes(normalizedQuery) && !sectionTitle.includes(normalizedQuery)) {
        return false;
      }
    }
    if (includeOnlyFavorites && !pageUserStateById[page.id]?.is_favorite) {
      return false;
    }
    return true;
  });

  const sortByRecent = (left: PersonalWorkspacePage, right: PersonalWorkspacePage) => {
    const leftOpened = pageUserStateById[left.id]?.last_opened_at
      ? new Date(pageUserStateById[left.id]!.last_opened_at as string).getTime()
      : 0;
    const rightOpened = pageUserStateById[right.id]?.last_opened_at
      ? new Date(pageUserStateById[right.id]!.last_opened_at as string).getTime()
      : 0;
    if (leftOpened !== rightOpened) {
      return rightOpened - leftOpened;
    }
    const leftUpdated = left.updated_at ? new Date(left.updated_at).getTime() : 0;
    const rightUpdated = right.updated_at ? new Date(right.updated_at).getTime() : 0;
    return rightUpdated - leftUpdated;
  };

  const recentPages = [...filteredPages].sort(sortByRecent).slice(0, 8);
  const favoritePages = filteredPages
    .filter((page) => pageUserStateById[page.id]?.is_favorite)
    .sort(sortByRecent)
    .slice(0, 8);
  const sharedWithMePages = filteredPages
    .filter((page) => page.owner_id !== user.id && (page.share_mode || "private") !== "private")
    .sort(sortByRecent)
    .slice(0, 8);
  const highlightedPage =
    (highlightedPageId
      ? filteredPages.find((page) => page.id === highlightedPageId)
      : null) || null;

  const latestSidebarState =
    Object.values(pageUserStateById)
      .filter((state) => state.last_opened_at)
      .sort((left, right) => {
        const leftTime = left.last_opened_at ? new Date(left.last_opened_at).getTime() : 0;
        const rightTime = right.last_opened_at ? new Date(right.last_opened_at).getTime() : 0;
        return rightTime - leftTime;
      })[0] || null;

  const sidebarPersistPageId =
    highlightedPageId || latestSidebarState?.page_id || allWorkspacePages[0]?.id || null;
  const sidebarInitiallyCollapsed = Boolean(latestSidebarState?.sidebar_collapsed);

  async function createPage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;

    if (!currentUser) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    const sectionIdRaw = String(formData.get("section_id") || "").trim();
    const templateId = String(formData.get("template_id") || "").trim();
    const sectionId = sectionIdRaw || null;

    if (!title) {
      redirect(buildPersonalUrl(baseQuery, "Page title is required"));
    }

    let pageContent: unknown = defaultPageContent;
    let pageContentText = defaultPageContentText;

    if (templateId) {
      const { data: template, error: templateError } = await supabase
        .from("personal_page_templates")
        .select("content")
        .eq("owner_id", currentUser.id)
        .eq("id", templateId)
        .maybeSingle();

      if (templateError) {
        if (isSupabaseMissingTableError(templateError)) {
          redirect(buildPersonalUrl(baseQuery, "Page templates need sql/personal_templates_and_page_order.sql"));
        }
        redirect(buildPersonalUrl(baseQuery, templateError.message));
      }

      if (template?.content && typeof template.content === "object") {
        pageContent = template.content;
        pageContentText = extractPlainText(template.content);
      }
    }

    let nextSortOrder: number | null = 1;
    const sortProbe = supabase
      .from("personal_pages")
      .select("sort_order")
      .eq("owner_id", currentUser.id)
      .limit(1)
      .order("sort_order", { ascending: false });
    const scopedSortProbe = sectionId
      ? sortProbe.eq("section_id", sectionId)
      : sortProbe.is("section_id", null);
    const { data: lastSortRows, error: lastSortError } = await scopedSortProbe;

    if (lastSortError && isMissingColumnError(lastSortError)) {
      nextSortOrder = null;
    } else if (lastSortError) {
      redirect(buildPersonalUrl(baseQuery, lastSortError.message));
    } else {
      nextSortOrder = Number(lastSortRows?.[0]?.sort_order || 0) + 1;
    }

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      owner_id: currentUser.id,
      title,
      section_id: sectionId,
      share_mode: "private",
      content: pageContent,
      updated_at: now,
      content_text: pageContentText,
      last_edited_at: now,
      last_edited_by_user_id: currentUser.id,
    };
    if (nextSortOrder !== null) {
      payload.sort_order = nextSortOrder;
    }

    let insert = await supabase.from("personal_pages").insert(payload).select("id").single();

    while (insert.error && isMissingColumnError(insert.error)) {
      const message = insert.error.message || "";
      if (message.includes("content_text")) {
        delete payload.content_text;
      } else if (message.includes("last_edited_at")) {
        delete payload.last_edited_at;
      } else if (message.includes("last_edited_by_user_id")) {
        delete payload.last_edited_by_user_id;
      } else if (message.includes("sort_order")) {
        delete payload.sort_order;
      } else {
        break;
      }
      insert = await supabase.from("personal_pages").insert(payload).select("id").single();
    }

    if (insert.error || !insert.data?.id) {
      redirect(buildPersonalUrl(baseQuery, insert.error?.message || "Unable to create page"));
    }

    revalidatePath("/personal");
    redirect(`/personal/${insert.data.id}`);
  }

  const sectionFilterValue = selectedSectionIds[0] || "";
  const shareModeFilterValue = selectedShareModes[0] || "";

  return (
    <div className="space-y-4 lg:flex lg:items-start lg:gap-4 lg:space-y-0">
      <PersonalSidebarTree
        sections={sidebarTree.sections}
        generalPages={sidebarTree.generalPages}
        currentPageId={highlightedPageId}
        persistPageId={sidebarPersistPageId}
        initialCollapsed={sidebarInitiallyCollapsed}
        pageStateByPageId={pageUserStateById}
      />

      <div className="space-y-4 lg:min-w-0 lg:flex-1">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Personal Workspace</h1>
            <p className="text-sm text-slate-600">
              Snapshot-first view of recent, favorite, and shared pages.
            </p>
          </div>
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              New page
            </summary>
            <form action={createPage} className="mt-3 grid min-w-[18rem] gap-2">
              <input
                name="title"
                placeholder="Page title"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <select
                name="section_id"
                defaultValue=""
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">General</option>
                {(sections || []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
              <select
                name="template_id"
                defaultValue=""
                disabled={pageTemplatesTableMissing}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="">Blank page</option>
                {pageTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    Template: {template.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md btn-primary px-3 py-2 text-sm font-semibold text-white"
              >
                Create page
              </button>
            </form>
          </details>
        </section>

        {searchParams?.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {searchParams.error}
          </p>
        ) : null}

        {pageUserStateTableMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Favorites, recents, and workspace view memory need
            <span className="font-mono"> sql/personal_workspace_user_state.sql</span>.
          </p>
        ) : null}

        {pageTemplatesTableMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Page templates need
            <span className="font-mono"> sql/personal_templates_and_page_order.sql</span>.
          </p>
        ) : null}

        {sidebarTree.pageSortOrderColumnMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Manual page ordering needs
            <span className="font-mono"> sql/personal_templates_and_page_order.sql</span>.
          </p>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_0.9fr_0.9fr_auto_auto]">
            <input
              type="text"
              name="q"
              defaultValue={queryText}
              placeholder="Search pages or sections"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              name="section"
              defaultValue={sectionFilterValue}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All sections</option>
              {(sections || []).map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </select>
            <select
              name="share_mode"
              defaultValue={shareModeFilterValue}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All sharing</option>
              <option value="private">Private</option>
              <option value="inherit">Shared (Section)</option>
              <option value="custom">Shared (Page)</option>
            </select>
            <select
              name="favorite"
              defaultValue={favoriteFilter === "1" ? "1" : ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All pages</option>
              <option value="1">Favorites only</option>
            </select>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Apply
              </button>
              <Link
                href="/personal"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300"
              >
                Reset
              </Link>
            </div>
          </form>
        </section>

        {highlightedPage ? (
          <section className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Focused page</p>
            <Link
              href={`/personal/${highlightedPage.id}`}
              className="mt-1 block text-sm font-semibold text-blue-900 underline underline-offset-2"
            >
              {highlightedPage.title || "Untitled"} ({highlightedPage.sectionTitle})
            </Link>
          </section>
        ) : null}

        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Recent</h2>
              <span className="text-xs text-slate-500">{recentPages.length}</span>
            </div>
            {renderPageCards(recentPages, pageUserStateById, "No recent pages in current scope.")}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Favorites</h2>
              <span className="text-xs text-slate-500">{favoritePages.length}</span>
            </div>
            {renderPageCards(
              favoritePages,
              pageUserStateById,
              "No favorite pages in current scope."
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Shared With Me
              </h2>
              <span className="text-xs text-slate-500">{sharedWithMePages.length}</span>
            </div>
            {renderPageCards(
              sharedWithMePages,
              pageUserStateById,
              "No shared pages in current scope."
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                All Filtered Pages
              </h2>
              <span className="text-xs text-slate-500">{filteredPages.length}</span>
            </div>
            {renderPageCards(
              filteredPages.slice(0, 30),
              pageUserStateById,
              "No pages match these filters."
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
