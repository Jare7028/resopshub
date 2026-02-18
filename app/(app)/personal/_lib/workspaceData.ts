import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import type {
  PersonalPageUserState,
  PersonalTreePage,
  PersonalTreeSection,
  PersonalWorkspaceTree,
} from "../types";

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => SupabaseSelectBuilder;
  };
};

type SupabaseErrorLike = { message?: string; code?: string } | null;
type SupabaseRow = Record<string, unknown>;

type SupabaseSelectBuilder = PromiseLike<{
  data: SupabaseRow[] | null;
  error: SupabaseErrorLike;
}> & {
  eq: (column: string, value: string) => SupabaseSelectBuilder;
  in: (column: string, values: string[]) => SupabaseSelectBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ) => SupabaseSelectBuilder;
  maybeSingle: () => Promise<{ data: SupabaseRow | null; error: SupabaseErrorLike }>;
};

function toSortOrder(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function comparePages(left: PersonalTreePage, right: PersonalTreePage) {
  if (left.sort_order !== right.sort_order) {
    return (left.sort_order || 0) - (right.sort_order || 0);
  }
  const leftDate = left.updated_at ? new Date(left.updated_at).getTime() : 0;
  const rightDate = right.updated_at ? new Date(right.updated_at).getTime() : 0;
  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }
  return String(left.title || "").localeCompare(String(right.title || ""));
}

export async function loadPersonalWorkspaceTree(
  supabase: SupabaseClientLike
): Promise<PersonalWorkspaceTree> {
  const [{ data: sectionsRaw }, pagesResponse] = await Promise.all([
    supabase
      .from("personal_sections")
      .select("id,title,owner_id,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("personal_pages")
      .select("id,title,section_id,owner_id,share_mode,updated_at,sort_order")
      .order("section_id", { ascending: true, nullsFirst: true })
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false }),
  ]);

  let pageSortOrderColumnMissing = false;
  let pagesRaw = pagesResponse.data || [];
  let pagesError = pagesResponse.error;

  if (pagesError && isSupabaseMissingColumnError(pagesError)) {
    pageSortOrderColumnMissing = true;
    const fallback = await supabase
      .from("personal_pages")
      .select("id,title,section_id,owner_id,share_mode,updated_at")
      .order("section_id", { ascending: true, nullsFirst: true })
      .order("updated_at", { ascending: false });
    pagesRaw = (fallback.data || []).map((row: Record<string, unknown>) => ({
      ...row,
      sort_order: 0,
    }));
    pagesError = fallback.error;
  }

  if (pagesError && !isSupabaseMissingTableError(pagesError)) {
    throw new Error(pagesError.message || "Unable to load personal pages");
  }

  const sections = ((sectionsRaw || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id || ""),
    title: String(row.title || "Untitled section"),
    owner_id: String(row.owner_id || ""),
    sort_order: toSortOrder(row.sort_order),
    created_at: String(row.created_at || ""),
    pages: [] as PersonalTreePage[],
  }));

  const sectionMap = new Map<string, PersonalTreeSection>();
  sections.forEach((section) => {
    sectionMap.set(section.id, section);
  });

  const generalPages: PersonalTreePage[] = [];
  ((pagesRaw || []) as Array<Record<string, unknown>>).forEach((row) => {
    const page: PersonalTreePage = {
      id: String(row.id || ""),
      title: row.title === null ? null : String(row.title || "Untitled"),
      section_id: row.section_id ? String(row.section_id) : null,
      owner_id: String(row.owner_id || ""),
      share_mode: row.share_mode === null ? null : String(row.share_mode || "private"),
      updated_at: row.updated_at === null ? null : String(row.updated_at || ""),
      sort_order: row.sort_order === null || row.sort_order === undefined ? 0 : toSortOrder(row.sort_order),
    };
    if (!page.id) return;
    if (page.section_id && sectionMap.has(page.section_id)) {
      sectionMap.get(page.section_id)!.pages.push(page);
    } else {
      generalPages.push(page);
    }
  });

  sections.forEach((section) => {
    section.pages.sort(comparePages);
  });
  generalPages.sort(comparePages);

  return {
    sections,
    generalPages,
    pageSortOrderColumnMissing,
  };
}

export async function loadPersonalPageUserStateMap(
  supabase: SupabaseClientLike
): Promise<{
  map: Record<string, PersonalPageUserState>;
  missingTable: boolean;
}> {
  const { data, error } = await supabase
    .from("personal_page_user_state")
    .select(
      "page_id,is_favorite,last_opened_at,zoom_percent,last_ribbon_tab,sidebar_collapsed,focus_mode,updated_at"
    );

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return {
        map: {},
        missingTable: true,
      };
    }
    throw new Error(error.message || "Unable to load personal workspace state");
  }

  const map: Record<string, PersonalPageUserState> = {};
  ((data || []) as Array<Record<string, unknown>>).forEach((row) => {
    const pageId = String(row.page_id || "").trim();
    if (!pageId) return;
    map[pageId] = {
      page_id: pageId,
      is_favorite: Boolean(row.is_favorite),
      last_opened_at: row.last_opened_at ? String(row.last_opened_at) : null,
      zoom_percent:
        row.zoom_percent === null || row.zoom_percent === undefined
          ? null
          : Number(row.zoom_percent),
      last_ribbon_tab: row.last_ribbon_tab
        ? (String(row.last_ribbon_tab) as PersonalPageUserState["last_ribbon_tab"])
        : null,
      sidebar_collapsed:
        row.sidebar_collapsed === null || row.sidebar_collapsed === undefined
          ? null
          : Boolean(row.sidebar_collapsed),
      focus_mode:
        row.focus_mode === null || row.focus_mode === undefined
          ? null
          : Boolean(row.focus_mode),
      updated_at: row.updated_at ? String(row.updated_at) : null,
    };
  });

  return {
    map,
    missingTable: false,
  };
}

export async function loadPersonalSinglePageUserState(
  supabase: SupabaseClientLike,
  pageId: string
): Promise<{ state: PersonalPageUserState | null; missingTable: boolean }> {
  const { data, error } = await supabase
    .from("personal_page_user_state")
    .select(
      "page_id,is_favorite,last_opened_at,zoom_percent,last_ribbon_tab,sidebar_collapsed,focus_mode,updated_at"
    )
    .eq("page_id", pageId)
    .maybeSingle();

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return { state: null, missingTable: true };
    }
    throw new Error(error.message || "Unable to load personal workspace state");
  }

  if (!data) {
    return { state: null, missingTable: false };
  }

  return {
    state: {
      page_id: String(data.page_id),
      is_favorite: Boolean(data.is_favorite),
      last_opened_at: data.last_opened_at ? String(data.last_opened_at) : null,
      zoom_percent:
        data.zoom_percent === null || data.zoom_percent === undefined
          ? null
          : Number(data.zoom_percent),
      last_ribbon_tab: data.last_ribbon_tab
        ? (String(data.last_ribbon_tab) as PersonalPageUserState["last_ribbon_tab"])
        : null,
      sidebar_collapsed:
        data.sidebar_collapsed === null || data.sidebar_collapsed === undefined
          ? null
          : Boolean(data.sidebar_collapsed),
      focus_mode:
        data.focus_mode === null || data.focus_mode === undefined
          ? null
          : Boolean(data.focus_mode),
      updated_at: data.updated_at ? String(data.updated_at) : null,
    },
    missingTable: false,
  };
}
