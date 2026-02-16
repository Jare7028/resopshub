import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import PersonalTabs, {
  normalizePersonalTabKey,
  type PersonalTabKey,
} from "./_components/PersonalTabs";
import PersonalPagesView, {
  type PersonalPageRow,
  type PersonalSectionOption,
} from "./_components/PersonalPagesView";

export const dynamic = "force-dynamic";

const defaultPageContent = DEFAULT_EDITOR_CONTENT;
const defaultPageContentText = extractPlainText(defaultPageContent);

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

function getSelectedMembers(formData: FormData, ownerId: string) {
  const selected = formData.getAll("share_user").map((value) => String(value));
  return selected
    .filter((userId) => userId && userId !== ownerId)
    .map((userId) => ({
      user_id: userId,
      role: String(formData.get(`role_${userId}`) || "view"),
    }));
}

function buildPersonalUrlFromBase(
  baseQuery: string,
  tab: PersonalTabKey,
  params?: { error?: string }
) {
  const sp = new URLSearchParams(baseQuery);

  if (tab !== "pages") {
    sp.set("tab", tab);
  }
  if (params?.error) {
    sp.set("error", params.error);
  }

  const qs = sp.toString();
  return qs ? `/personal?${qs}` : "/personal";
}

export default async function PersonalHome(props: {
  searchParams?: Promise<{
    tab?: string;
    section?: string | string[];
    filter?: string;
    error?: string;
    share_mode?: string | string[];
    updated_from?: string;
    updated_to?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const selectedSectionIds = parseCsvParam(searchParams?.section);
  const selectedFilter = (searchParams?.filter || "all").trim();
  const activeTab = normalizePersonalTabKey(searchParams?.tab);
  const selectedShareModes = parseCsvParam(searchParams?.share_mode);
  const updatedFrom = (searchParams?.updated_from || "").trim();
  const updatedTo = (searchParams?.updated_to || "").trim();

  const baseParams = new URLSearchParams();
  setCsvParam(baseParams, "section", selectedSectionIds);
  if (selectedFilter !== "all") {
    baseParams.set("filter", selectedFilter);
  }
  setCsvParam(baseParams, "share_mode", selectedShareModes);
  if (updatedFrom) baseParams.set("updated_from", updatedFrom);
  if (updatedTo) baseParams.set("updated_to", updatedTo);

  const baseQuery = baseParams.toString();

  const personalTabUrls: Record<PersonalTabKey, string> = {
    pages: buildPersonalUrlFromBase(baseQuery, "pages"),
    sections: buildPersonalUrlFromBase(baseQuery, "sections"),
  };

  const [
    { data: sections },
    { data: users },
    { data: pageTemplatesRaw, error: pageTemplatesError },
  ] = await Promise.all([
    supabase
      .from("personal_sections")
      .select("id,title,owner_id,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
    supabase
      .from("personal_page_templates")
      .select("id,name")
      .eq("owner_id", user.id)
      .order("name", { ascending: true }),
  ]);
  const pageTemplatesTableMissing = Boolean(
    pageTemplatesError && isSupabaseMissingTableError(pageTemplatesError)
  );
  const pageTemplates = ((pageTemplatesError ? [] : pageTemplatesRaw) || []) as Array<{
    id: string;
    name: string;
  }>;

  let pages: Array<{
    id: string;
    title: string | null;
    section_id: string | null;
    share_mode: string | null;
    updated_at: string | null;
    created_at: string | null;
    sort_order?: number | null;
    personal_sections?:
      | { title?: string | null }
      | { title?: string | null }[]
      | null
      | undefined;
  }> = [];
  let pageSortOrderColumnMissing = false;
  let pagesRequest = supabase
    .from("personal_pages")
    .select(
      "id,title,section_id,share_mode,updated_at,created_at,sort_order,personal_sections(title)"
    );
  if (selectedSectionIds.length) {
    pagesRequest = pagesRequest.in("section_id", selectedSectionIds);
  }
  if (selectedShareModes.length) {
    pagesRequest = pagesRequest.in("share_mode", selectedShareModes);
  } else if (selectedFilter === "private") {
    pagesRequest = pagesRequest.eq("share_mode", "private");
  } else if (selectedFilter === "shared") {
    pagesRequest = pagesRequest.neq("share_mode", "private");
  }
  if (updatedFrom) {
    pagesRequest = pagesRequest.gte("updated_at", updatedFrom);
  }
  if (updatedTo) {
    pagesRequest = pagesRequest.lte("updated_at", updatedTo);
  }
  pagesRequest = pagesRequest.order("updated_at", { ascending: false });
  const { data: pagesRaw, error: pagesError } = await pagesRequest;
  if (pagesError && isMissingColumnError(pagesError)) {
    pageSortOrderColumnMissing = true;
    let fallbackPagesRequest = supabase
      .from("personal_pages")
      .select("id,title,section_id,share_mode,updated_at,created_at,personal_sections(title)");
    if (selectedSectionIds.length) {
      fallbackPagesRequest = fallbackPagesRequest.in("section_id", selectedSectionIds);
    }
    if (selectedShareModes.length) {
      fallbackPagesRequest = fallbackPagesRequest.in("share_mode", selectedShareModes);
    } else if (selectedFilter === "private") {
      fallbackPagesRequest = fallbackPagesRequest.eq("share_mode", "private");
    } else if (selectedFilter === "shared") {
      fallbackPagesRequest = fallbackPagesRequest.neq("share_mode", "private");
    }
    if (updatedFrom) {
      fallbackPagesRequest = fallbackPagesRequest.gte("updated_at", updatedFrom);
    }
    if (updatedTo) {
      fallbackPagesRequest = fallbackPagesRequest.lte("updated_at", updatedTo);
    }
    fallbackPagesRequest = fallbackPagesRequest.order("updated_at", { ascending: false });
    const { data: fallbackPagesRaw } = await fallbackPagesRequest;
    pages = (fallbackPagesRaw || []) as typeof pages;
  } else {
    pages = (pagesRaw || []) as typeof pages;
  }

  let sectionPages: Array<{
    id: string;
    title: string | null;
    section_id: string | null;
    owner_id: string;
    sort_order?: number | null;
    created_at: string | null;
  }> = [];
  const { data: sectionPagesRaw, error: sectionPagesError } = await supabase
    .from("personal_pages")
    .select("id,title,section_id,owner_id,sort_order,created_at")
    .order("section_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (sectionPagesError && isMissingColumnError(sectionPagesError)) {
    pageSortOrderColumnMissing = true;
    const { data: fallbackSectionPagesRaw } = await supabase
      .from("personal_pages")
      .select("id,title,section_id,owner_id,created_at")
      .order("section_id", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    sectionPages = (fallbackSectionPagesRaw || []) as typeof sectionPages;
  } else {
    sectionPages = (sectionPagesRaw || []) as typeof sectionPages;
  }

  const pageCountBySectionId = sectionPages.reduce<Record<string, number>>((acc, row) => {
    const sectionId = row.section_id;
    if (!sectionId) return acc;
    acc[sectionId] = (acc[sectionId] || 0) + 1;
    return acc;
  }, {});
  const pagesBySectionId = sectionPages.reduce<
    Record<
      string,
      Array<{ id: string; title: string | null; owner_id: string; sort_order?: number | null }>
    >
  >((acc, row) => {
    const sectionId = row.section_id || "__general__";
    acc[sectionId] ||= [];
    acc[sectionId].push({
      id: row.id,
      title: row.title,
      owner_id: row.owner_id,
      sort_order: row.sort_order,
    });
    return acc;
  }, {});

  async function createSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    if (!title) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Section title is required",
        })
      );
    }

    const { data: lastSection } = await supabase
      .from("personal_sections")
      .select("sort_order")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (lastSection?.sort_order || 0) + 1;

    const { error } = await supabase.from("personal_sections").insert({
      title,
      owner_id: user.id,
      sort_order: nextSort,
    });

    if (error) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: error.message }));
    }

    revalidatePath("/personal");
  }

  async function renameSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const sectionId = String(formData.get("section_id") || "").trim();
    const title = String(formData.get("title") || "").trim();

    if (!sectionId) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: "Missing section id" }));
    }

    if (!title) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Section title is required",
        })
      );
    }

    const { error } = await supabase
      .from("personal_sections")
      .update({ title })
      .eq("id", sectionId);

    if (error) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: error.message }));
    }

    revalidatePath("/personal");
  }

  async function deleteSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const sectionId = String(formData.get("section_id") || "").trim();
    if (!sectionId) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: "Missing section id" }));
    }

    // Enforce "owner only" delete in-app (RLS also enforces this).
    const { data: section, error: sectionError } = await supabase
      .from("personal_sections")
      .select("id,owner_id")
      .eq("id", sectionId)
      .maybeSingle();

    if (sectionError) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: sectionError.message }));
    }

    if (!section) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: "Section not found" }));
    }

    if (section.owner_id !== user.id) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Only the section owner can delete it",
        })
      );
    }

    const { error } = await supabase.from("personal_sections").delete().eq("id", sectionId);

    if (error) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: error.message }));
    }

    revalidatePath("/personal");
  }

  async function moveSectionOrder(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    const sectionId = String(formData.get("section_id") || "").trim();
    const direction = String(formData.get("direction") || "").trim();

    if (!currentUser) {
      redirect("/login");
    }
    if (!sectionId || (direction !== "up" && direction !== "down")) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Missing reorder details",
        })
      );
    }

    const { data: currentSection, error: currentError } = await supabase
      .from("personal_sections")
      .select("id,owner_id,sort_order")
      .eq("id", sectionId)
      .maybeSingle();
    if (currentError || !currentSection) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: currentError?.message || "Section not found",
        })
      );
    }
    if (currentSection.owner_id !== currentUser.id) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Only the section owner can reorder sections",
        })
      );
    }

    let neighborRequest = supabase
      .from("personal_sections")
      .select("id,sort_order")
      .eq("owner_id", currentUser.id)
      .limit(1);
    if (direction === "up") {
      neighborRequest = neighborRequest
        .lt("sort_order", currentSection.sort_order)
        .order("sort_order", { ascending: false });
    } else {
      neighborRequest = neighborRequest
        .gt("sort_order", currentSection.sort_order)
        .order("sort_order", { ascending: true });
    }

    const { data: neighborSection, error: neighborError } = await neighborRequest.maybeSingle();
    if (neighborError) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: neighborError.message }));
    }
    if (!neighborSection) {
      revalidatePath("/personal");
      return;
    }

    const currentSort = currentSection.sort_order;
    const neighborSort = neighborSection.sort_order;
    const { error: currentUpdateError } = await supabase
      .from("personal_sections")
      .update({ sort_order: neighborSort })
      .eq("id", currentSection.id);
    if (currentUpdateError) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", { error: currentUpdateError.message })
      );
    }

    const { error: neighborUpdateError } = await supabase
      .from("personal_sections")
      .update({ sort_order: currentSort })
      .eq("id", neighborSection.id);
    if (neighborUpdateError) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", { error: neighborUpdateError.message })
      );
    }

    revalidatePath("/personal");
  }

  async function movePageOrder(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    const pageId = String(formData.get("page_id") || "").trim();
    const direction = String(formData.get("direction") || "").trim();

    if (!currentUser) {
      redirect("/login");
    }
    if (!pageId || (direction !== "up" && direction !== "down")) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Missing page reorder details",
        })
      );
    }

    const { data: currentPage, error: currentPageError } = await supabase
      .from("personal_pages")
      .select("id,owner_id,section_id,sort_order")
      .eq("id", pageId)
      .maybeSingle();
    if (currentPageError) {
      if (isMissingColumnError(currentPageError)) {
        redirect(
          buildPersonalUrlFromBase(baseQuery, "sections", {
            error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
          })
        );
      }
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: currentPageError.message,
        })
      );
    }
    if (!currentPage) {
      redirect(buildPersonalUrlFromBase(baseQuery, "sections", { error: "Page not found" }));
    }
    if (currentPage.owner_id !== currentUser.id) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: "Only the page owner can reorder pages",
        })
      );
    }

    let neighborRequest = supabase
      .from("personal_pages")
      .select("id,sort_order")
      .eq("owner_id", currentUser.id)
      .limit(1);
    if (currentPage.section_id) {
      neighborRequest = neighborRequest.eq("section_id", currentPage.section_id);
    } else {
      neighborRequest = neighborRequest.is("section_id", null);
    }
    if (direction === "up") {
      neighborRequest = neighborRequest
        .lt("sort_order", currentPage.sort_order)
        .order("sort_order", { ascending: false });
    } else {
      neighborRequest = neighborRequest
        .gt("sort_order", currentPage.sort_order)
        .order("sort_order", { ascending: true });
    }

    const { data: neighborPage, error: neighborError } = await neighborRequest.maybeSingle();
    if (neighborError) {
      if (isMissingColumnError(neighborError)) {
        redirect(
          buildPersonalUrlFromBase(baseQuery, "sections", {
            error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
          })
        );
      }
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", {
          error: neighborError.message,
        })
      );
    }
    if (!neighborPage) {
      revalidatePath("/personal");
      return;
    }

    const currentSort = Number(currentPage.sort_order || 0);
    const neighborSort = Number(neighborPage.sort_order || 0);
    const { error: currentUpdateError } = await supabase
      .from("personal_pages")
      .update({ sort_order: neighborSort })
      .eq("id", currentPage.id);
    if (currentUpdateError) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", { error: currentUpdateError.message })
      );
    }

    const { error: neighborUpdateError } = await supabase
      .from("personal_pages")
      .update({ sort_order: currentSort })
      .eq("id", neighborPage.id);
    if (neighborUpdateError) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "sections", { error: neighborUpdateError.message })
      );
    }

    revalidatePath("/personal");
  }

  async function createPage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    let sectionId = String(formData.get("section_id") || "").trim();
    const templateId = String(formData.get("template_id") || "").trim();
    const privacy = String(formData.get("privacy") || "private");
    const shareScope = String(formData.get("share_scope") || "page");

    if (!title) {
      redirect(buildPersonalUrlFromBase(baseQuery, "pages", { error: "Page title is required" }));
    }

    if (!sectionId) {
      const { data: defaultSection } = await supabase
        .from("personal_sections")
        .select("id")
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultSection?.id) {
        sectionId = defaultSection.id;
      } else {
        const { data: createdSection, error: sectionError } = await supabase
          .from("personal_sections")
          .insert({
            title: "General",
            owner_id: user.id,
            sort_order: 1,
          })
          .select("id")
          .single();

        if (sectionError || !createdSection) {
          redirect(
            buildPersonalUrlFromBase(baseQuery, "pages", {
              error: sectionError?.message || "Unable to create section",
            })
          );
        }

        sectionId = createdSection.id;
      }
    }

    const shareMode =
      privacy === "private"
        ? "private"
        : shareScope === "section"
        ? "inherit"
        : "custom";

    let pageContent = defaultPageContent;
    let pageContentText = defaultPageContentText;
    if (templateId) {
      const { data: template, error: templateError } = await supabase
        .from("personal_page_templates")
        .select("id,content")
        .eq("owner_id", user.id)
        .eq("id", templateId)
        .maybeSingle();
      if (templateError) {
        if (isSupabaseMissingTableError(templateError)) {
          redirect(
            buildPersonalUrlFromBase(baseQuery, "pages", {
              error: "Page templates need sql/personal_templates_and_page_order.sql",
            })
          );
        }
        redirect(
          buildPersonalUrlFromBase(baseQuery, "pages", {
            error: templateError.message,
          })
        );
      }
      if (!template) {
        redirect(
          buildPersonalUrlFromBase(baseQuery, "pages", {
            error: "Template not found",
          })
        );
      }
      if (template.content && typeof template.content === "object") {
        pageContent = template.content;
        pageContentText = extractPlainText(template.content);
      }
    }

    let nextSortOrder: number | null = null;
    let lastPageSortRequest = supabase
      .from("personal_pages")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);
    if (sectionId) {
      lastPageSortRequest = lastPageSortRequest.eq("section_id", sectionId);
    } else {
      lastPageSortRequest = lastPageSortRequest.is("section_id", null);
    }
    const { data: lastPageSortRows, error: lastPageSortError } = await lastPageSortRequest;
    if (lastPageSortError && !isMissingColumnError(lastPageSortError)) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "pages", {
          error: lastPageSortError.message,
        })
      );
    }
    if (!lastPageSortError) {
      nextSortOrder = Number(lastPageSortRows?.[0]?.sort_order || 0) + 1;
    }

    const pageInsertPayload: Record<string, unknown> = {
      title,
      section_id: sectionId || null,
      owner_id: user.id,
      share_mode: shareMode,
      content: pageContent,
      content_text: pageContentText,
    };
    if (nextSortOrder !== null) {
      pageInsertPayload.sort_order = nextSortOrder;
    }

    let page: { id: string } | null = null;
    let pageError: { message: string } | null = null;
    const createPageResult = await supabase
      .from("personal_pages")
      .insert(pageInsertPayload)
      .select("id")
      .single();
    page = createPageResult.data || null;
    pageError = createPageResult.error;

    if (pageError && isMissingColumnError(pageError)) {
      delete pageInsertPayload.sort_order;
      const fallbackCreatePageResult = await supabase
        .from("personal_pages")
        .insert(pageInsertPayload)
        .select("id")
        .single();
      page = fallbackCreatePageResult.data || null;
      pageError = fallbackCreatePageResult.error;
    }

    if (pageError || !page) {
      redirect(
        buildPersonalUrlFromBase(baseQuery, "pages", {
          error: pageError?.message || "Unable to create page",
        })
      );
    }

    if (privacy !== "private") {
      const members = getSelectedMembers(formData, user.id);
      if (members.length) {
        if (shareScope === "section") {
          const inserts = members.map((member) => ({
            section_id: sectionId,
            user_id: member.user_id,
            role: member.role,
          }));
          const { error: sectionShareError } = await supabase
            .from("personal_section_members")
            .upsert(inserts, { onConflict: "section_id,user_id" });
          if (sectionShareError) {
            redirect(
              buildPersonalUrlFromBase(baseQuery, "pages", {
                error: sectionShareError.message,
              })
            );
          }
        } else {
          const inserts = members.map((member) => ({
            page_id: page.id,
            user_id: member.user_id,
            role: member.role,
          }));
          const { error: pageShareError } = await supabase
            .from("personal_page_members")
            .upsert(inserts, { onConflict: "page_id,user_id" });
          if (pageShareError) {
            redirect(
              buildPersonalUrlFromBase(baseQuery, "pages", {
                error: pageShareError.message,
              })
            );
          }
        }
      }
    }

    revalidatePath("/personal");
    redirect(`/personal/${page.id}`);
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Personal</h1>
          <p className="text-sm text-slate-600">
            Create private or shared pages with a rich text canvas.
          </p>
        </div>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <PersonalTabs active={activeTab} urls={personalTabUrls} />

      <div className="space-y-6">
        {activeTab === "sections" ? (
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
            </div>
            <div className="p-6">
              <form action={createSection} className="flex flex-wrap gap-2">
                <input
                  name="title"
                  placeholder="New section title"
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md btn-primary px-3 py-2 text-xs font-semibold text-white"
                >
                  Add section
                </button>
              </form>

              {sections?.length ? (
                <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Section</th>
                        <th className="px-4 py-3">Access</th>
                        <th className="px-4 py-3">Reorder</th>
                        <th className="px-4 py-3 text-right">Pages</th>
                        <th className="px-4 py-3">Page order</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {sections.map((section) => {
                        const isOwner = section.owner_id === user.id;
                        const sectionPagesForOrder = pagesBySectionId[section.id] || [];
                        return (
                          <tr key={section.id}>
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              {section.title}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {isOwner ? "Owner" : "Shared"}
                            </td>
                            <td className="px-4 py-3">
                              {isOwner ? (
                                <form action={moveSectionOrder} className="flex items-center gap-1">
                                  <input type="hidden" name="section_id" value={section.id} />
                                  <button
                                    type="submit"
                                    name="direction"
                                    value="up"
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="submit"
                                    name="direction"
                                    value="down"
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
                                  >
                                    Down
                                  </button>
                                </form>
                              ) : (
                                <span className="text-xs text-slate-500">View only</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-600">
                              {pageCountBySectionId[section.id] || 0}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {sectionPagesForOrder.length ? (
                                <div className="space-y-1">
                                  {sectionPagesForOrder.map((page) => {
                                    const canReorderPage = page.owner_id === user.id;
                                    return (
                                      <div
                                        key={page.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5"
                                      >
                                        <Link
                                          href={`/personal/${page.id}`}
                                          className="text-xs font-medium text-slate-700 hover:underline"
                                        >
                                          {page.title || "Untitled"}
                                        </Link>
                                        {canReorderPage ? (
                                          <form action={movePageOrder} className="flex items-center gap-1">
                                            <input type="hidden" name="page_id" value={page.id} />
                                            <button
                                              type="submit"
                                              name="direction"
                                              value="up"
                                              className="rounded-md border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700"
                                            >
                                              Up
                                            </button>
                                            <button
                                              type="submit"
                                              name="direction"
                                              value="down"
                                              className="rounded-md border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700"
                                            >
                                              Down
                                            </button>
                                          </form>
                                        ) : (
                                          <span className="text-[11px] text-slate-400">View</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">No pages</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isOwner ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <form action={renameSection} className="flex items-center gap-2">
                                    <input type="hidden" name="section_id" value={section.id} />
                                    <input
                                      name="title"
                                      defaultValue={section.title}
                                      className="w-52 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                                    />
                                    <button
                                      type="submit"
                                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                                    >
                                      Rename
                                    </button>
                                  </form>
                                  <details className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                                    <summary className="cursor-pointer select-none font-semibold">
                                      Delete
                                    </summary>
                                    <div className="mt-2 w-64 space-y-2">
                                      <p>
                                        Pages in this section will remain, but will be moved to
                                        General.
                                      </p>
                                      <form action={deleteSection}>
                                        <input type="hidden" name="section_id" value={section.id} />
                                        <button
                                          type="submit"
                                          className="rounded-md bg-red-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                                        >
                                          Confirm delete
                                        </button>
                                      </form>
                                    </div>
                                  </details>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500">View only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">No sections yet.</p>
              )}
              {pageSortOrderColumnMissing ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Manual page ordering needs `sql/personal_templates_and_page_order.sql`.
                </p>
              ) : null}
              {(pagesBySectionId.__general__ || []).length ? (
                <div className="mt-4 rounded-md border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    General pages order
                  </p>
                  <div className="mt-2 space-y-1">
                    {(pagesBySectionId.__general__ || []).map((page) => {
                      const canReorderPage = page.owner_id === user.id;
                      return (
                        <div
                          key={page.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5"
                        >
                          <Link
                            href={`/personal/${page.id}`}
                            className="text-xs font-medium text-slate-700 hover:underline"
                          >
                            {page.title || "Untitled"}
                          </Link>
                          {canReorderPage ? (
                            <form action={movePageOrder} className="flex items-center gap-1">
                              <input type="hidden" name="page_id" value={page.id} />
                              <button
                                type="submit"
                                name="direction"
                                value="up"
                                className="rounded-md border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700"
                              >
                                Up
                              </button>
                              <button
                                type="submit"
                                name="direction"
                                value="down"
                                className="rounded-md border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700"
                              >
                                Down
                              </button>
                            </form>
                          ) : (
                            <span className="text-[11px] text-slate-400">View</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "pages" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Pages</h2>
          </div>
          <div className="border-b border-slate-200 px-6 py-4">
            <details className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">
                Create page
              </summary>
              <div className="mt-4">
                <form action={createPage} className="grid gap-4 md:grid-cols-2">
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
                  <input
                    name="title"
                    placeholder="Page title"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <select
                    name="section_id"
                    defaultValue={
                      selectedSectionIds.length === 1
                        ? selectedSectionIds[0]
                        : sections?.[0]?.id || ""
                    }
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">General</option>
                    {sections?.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.title}
                      </option>
                    ))}
                  </select>
                  <select
                    name="privacy"
                    defaultValue="private"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="private">Private</option>
                    <option value="shared">Shared</option>
                  </select>
                  <select
                    name="share_scope"
                    defaultValue="page"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="page">Share page</option>
                    <option value="section">Share section</option>
                  </select>
                  <details className="md:col-span-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium text-slate-700">
                      Share with (optional)
                    </summary>
                    <div className="mt-3 space-y-2">
                      {users?.length ? (
                        users.map((member) => (
                          <label
                            key={member.id}
                            className="flex flex-wrap items-center gap-3 text-sm text-slate-600"
                          >
                            <input
                              type="checkbox"
                              name="share_user"
                              value={member.id}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span className="min-w-[160px]">
                              {member.full_name || member.email}
                            </span>
                            <select
                              name={`role_${member.id}`}
                              defaultValue="view"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="view">View</option>
                              <option value="edit">Edit</option>
                            </select>
                          </label>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500">No users found.</p>
                      )}
                    </div>
                  </details>
                  <button
                    type="submit"
                    className="md:col-span-2 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Create page
                  </button>
                </form>
                {pageTemplatesTableMissing ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Page templates need `sql/personal_templates_and_page_order.sql`.
                  </p>
                ) : null}
              </div>
            </details>
          </div>
          <div className="overflow-x-auto">
            <PersonalPagesView
              pages={(pages || []) as unknown as PersonalPageRow[]}
              sections={
                (sections || []).map((section) => ({
                id: section.id,
                title: section.title,
              })) as PersonalSectionOption[]
              }
              initialFilters={{
                section: selectedSectionIds,
                shareMode: selectedShareModes,
                updatedFrom,
                updatedTo,
              }}
            />
          </div>
        </section>
        ) : null}
      </div>
    </div>
  );
}
