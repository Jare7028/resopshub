import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { summarizeImageNodes } from "@/lib/imageNodeIntegrity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import PersonalPageEditorClient from "./PersonalPageEditorClient";
import type { ContextMenuFavoriteActionId } from "../../_components/NoteEditorClient";
import ConfirmDelete from "../../_components/ConfirmDelete";
import { extractPlainText } from "@/lib/tiptapText";
import PersonalSidebarTree from "../_components/PersonalSidebarTree";
import {
  loadPersonalPageUserStateMap,
  loadPersonalSinglePageUserState,
  loadPersonalWorkspaceTree,
} from "../_lib/workspaceData";
import { togglePersonalPageFavorite } from "../workspaceActions";

export const dynamic = "force-dynamic";

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

type PersonalPageShareLinkRow = {
  id: string;
  token: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

function normalizeAppBaseUrl(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (
    withoutTrailingSlash.startsWith("http://") ||
    withoutTrailingSlash.startsWith("https://")
  ) {
    return withoutTrailingSlash;
  }
  return `https://${withoutTrailingSlash}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US");
}

function buildSharePanelUrl(
  pageId: string,
  focusFromQuery: boolean,
  extra?: { error?: string; success?: string }
) {
  const sp = new URLSearchParams();
  sp.set("panel", "share");
  if (focusFromQuery) sp.set("focus", "1");
  if (extra?.error) sp.set("error", extra.error);
  if (extra?.success) sp.set("success", extra.success);
  return `/personal/${pageId}?${sp.toString()}`;
}

async function syncPageShareMode(
  supabase: SupabaseServerClient,
  pageId: string,
  sectionId: string | null
) {
  if (sectionId) {
    const { count: sectionCount, error: sectionCountError } = await supabase
      .from("personal_section_members")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId);
    if (sectionCountError) {
      throw new Error(sectionCountError.message);
    }

    if ((sectionCount || 0) > 0) {
      const { error: inheritError } = await supabase
        .from("personal_pages")
        .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (inheritError) {
        throw new Error(inheritError.message);
      }
      return;
    }
  }

  const { count: pageCount, error: pageCountError } = await supabase
    .from("personal_page_members")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId);
  if (pageCountError) {
    throw new Error(pageCountError.message);
  }

  const shareMode = (pageCount || 0) > 0 ? "custom" : "private";
  const { error: pageModeError } = await supabase
    .from("personal_pages")
    .update({ share_mode: shareMode, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  if (pageModeError) {
    throw new Error(pageModeError.message);
  }
}

async function syncSectionShareMode(supabase: SupabaseServerClient, sectionId: string | null) {
  if (!sectionId) {
    return;
  }

  const { count: sectionCount, error: sectionCountError } = await supabase
    .from("personal_section_members")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);
  if (sectionCountError) {
    throw new Error(sectionCountError.message);
  }

  if ((sectionCount || 0) > 0) {
    const { error: inheritError } = await supabase
      .from("personal_pages")
      .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
      .eq("section_id", sectionId);
    if (inheritError) {
      throw new Error(inheritError.message);
    }
    return;
  }

  const { data: pagesInSection, error: pagesInSectionError } = await supabase
    .from("personal_pages")
    .select("id")
    .eq("section_id", sectionId);
  if (pagesInSectionError) {
    throw new Error(pagesInSectionError.message);
  }

  const pageIds = (pagesInSection || []).map((row) => row.id);
  if (!pageIds.length) {
    return;
  }

  const { error: privateError } = await supabase
    .from("personal_pages")
    .update({ share_mode: "private", updated_at: new Date().toISOString() })
    .in("id", pageIds);
  if (privateError) {
    throw new Error(privateError.message);
  }

  const { data: pageMemberRows, error: pageMemberRowsError } = await supabase
    .from("personal_page_members")
    .select("page_id")
    .in("page_id", pageIds);
  if (pageMemberRowsError) {
    throw new Error(pageMemberRowsError.message);
  }

  const pageIdsWithMembers = Array.from(
    new Set((pageMemberRows || []).map((row) => row.page_id))
  );

  if (pageIdsWithMembers.length) {
    const { error: customError } = await supabase
      .from("personal_pages")
      .update({ share_mode: "custom", updated_at: new Date().toISOString() })
      .in("id", pageIdsWithMembers);
    if (customError) {
      throw new Error(customError.message);
    }
  }
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

const CONTEXT_MENU_FAVORITE_ACTION_ID_SET = new Set<ContextMenuFavoriteActionId>([
  "paragraph",
  "heading1",
  "heading2",
  "bulletList",
  "orderedList",
  "checklist",
  "quote",
  "insertShape",
  "insertTextBox",
  "insertTable",
  "divider",
  "addRowBefore",
  "addRowAfter",
  "addColumnBefore",
  "addColumnAfter",
  "deleteRow",
  "deleteColumn",
  "deleteTable",
]);

function normalizeContextMenuFavorites(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as ContextMenuFavoriteActionId[];
  }
  const next = value
    .map((item) => String(item || "").trim())
    .filter((item): item is ContextMenuFavoriteActionId =>
      CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has(item as ContextMenuFavoriteActionId)
    );
  return Array.from(new Set(next));
}

type PersonalPageTabKey = "notes" | "section_members" | "page_members";

function normalizePersonalPageTabKey(value: string | null | undefined): PersonalPageTabKey {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "section_members") return "section_members";
  if (normalized === "page_members") return "page_members";
  return "notes";
}

export default async function PersonalPage(props: {
  params: Promise<{ pageId: string }>;
  searchParams?: Promise<{
    tab?: string;
    panel?: string;
    focus?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const { data: page } = await supabase
    .from("personal_pages")
    .select(
      "id,title,section_id,owner_id,share_mode,updated_at,content,last_edited_at,last_edited_by_user_id,personal_sections(id,title)"
    )
    .eq("id", params.pageId)
    .single();

  if (!page) {
    notFound();
  }

  const pageId = page.id;
  const pageTitle = page.title || "Personal page";
  const pageContent = page.content ?? null;
  const imageSummary = summarizeImageNodes(pageContent);
  console.error("[personal.image.debug] page_load_content", {
    pageId,
    imageSummary,
  });
  const activeTab = normalizePersonalPageTabKey(searchParams?.tab);
  const panelParam = String(searchParams?.panel || "")
    .trim()
    .toLowerCase();
  const activePanel: "none" | "share" | "history" | "templates" =
    panelParam === "share" ||
    panelParam === "history" ||
    panelParam === "templates" ||
    panelParam === "none"
      ? (panelParam as "none" | "share" | "history" | "templates")
      : activeTab === "section_members" || activeTab === "page_members"
      ? "share"
      : "none";
  const focusFromQuery = String(searchParams?.focus || "0") === "1";
  const sectionId = page.section_id;
  const pageOwnerId = page.owner_id;
  const isOwner = pageOwnerId === user.id;

  const [
    { data: sections },
    { data: users },
    { data: clients },
    { data: pageTemplatesRaw, error: pageTemplatesError },
    sidebarTree,
    { map: pageUserStateById, missingTable: pageUserStateTableMissing },
    { state: pageUserState, missingTable: singlePageStateTableMissing },
  ] = await Promise.all([
    supabase.from("personal_sections").select("id,title").order("sort_order", { ascending: true }),
    supabase.from("users").select("id,full_name,email").order("full_name", { ascending: true }),
    supabase.from("clients").select("id,name").order("name", { ascending: true }),
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
    loadPersonalSinglePageUserState(
      supabase as unknown as Parameters<typeof loadPersonalSinglePageUserState>[0],
      pageId
    ),
  ]);
  const pageTemplatesTableMissing = Boolean(
    pageTemplatesError && isSupabaseMissingTableError(pageTemplatesError)
  );
  const pageTemplates = ((pageTemplatesError ? [] : pageTemplatesRaw) || []) as Array<{
    id: string;
    name: string;
  }>;

  const lastEditedAtLabel = page.last_edited_at
    ? new Date(page.last_edited_at).toLocaleString("en-US")
    : null;
  const lastEditedByUser = users?.find(
    (member) => member.id === page.last_edited_by_user_id
  );
  const lastEditedByLabel = lastEditedByUser
    ? lastEditedByUser.full_name || lastEditedByUser.email
    : null;

  let initialContextMenuFavorites: ContextMenuFavoriteActionId[] = [];
  let persistContextMenuFavorites = true;
  let defaultZoomPercentPreference = 100;
  let defaultRibbonTabPreference: "home" | "insert" | "layout" | "review" | "view" = "home";
  const { data: noteEditorPreferencesRaw, error: noteEditorPreferencesError } = await supabase
    .from("user_note_editor_preferences")
    .select("personal_context_menu_favorites,default_zoom_percent,default_ribbon_tab")
    .eq("user_id", user.id)
    .maybeSingle();

  if (noteEditorPreferencesError) {
    if (isSupabaseMissingTableError(noteEditorPreferencesError)) {
      persistContextMenuFavorites = false;
    } else {
      console.error(
        "[personal.noteEditorPreferences.select]",
        noteEditorPreferencesError.message
      );
    }
  } else {
    initialContextMenuFavorites = normalizeContextMenuFavorites(
      noteEditorPreferencesRaw?.personal_context_menu_favorites
    );
    const zoomFromPreferences = Number(noteEditorPreferencesRaw?.default_zoom_percent);
    if (Number.isFinite(zoomFromPreferences)) {
      defaultZoomPercentPreference = Math.max(20, Math.min(1000, Math.round(zoomFromPreferences)));
    }
    const ribbonFromPreferences = String(noteEditorPreferencesRaw?.default_ribbon_tab || "")
      .trim()
      .toLowerCase();
    if (
      ribbonFromPreferences === "home" ||
      ribbonFromPreferences === "insert" ||
      ribbonFromPreferences === "layout" ||
      ribbonFromPreferences === "review" ||
      ribbonFromPreferences === "view"
    ) {
      defaultRibbonTabPreference = ribbonFromPreferences;
    }
  }

  const { data: sectionMembersRaw } = await supabase
    .from("personal_section_members")
    .select("id,user_id,role,created_at")
    .eq("section_id", sectionId)
    .order("created_at", { ascending: true });

  const { data: pageMembersRaw } = await supabase
    .from("personal_page_members")
    .select("id,user_id,role,created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });

  const userLabelById = (users || []).reduce<Record<string, string>>((acc, member) => {
    acc[member.id] = member.full_name || member.email || "Unknown user";
    return acc;
  }, {});
  const sectionMembers = (sectionMembersRaw || []) as Array<{
    id: string;
    user_id: string;
    role: string;
  }>;
  const pageMembers = (pageMembersRaw || []) as Array<{
    id: string;
    user_id: string;
    role: string;
  }>;

  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host");
  const forwardedProto = headerList.get("x-forwarded-proto");
  const host = forwardedHost || headerList.get("host");
  const appBaseUrlFromHeaders = host
    ? `${forwardedProto || "https"}://${host}`
    : "";
  const appBaseUrl = normalizeAppBaseUrl(
    process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      appBaseUrlFromHeaders
  );

  const {
    data: personalPageShareLinksRaw,
    error: personalPageShareLinksError,
  } = await supabase
    .from("personal_page_share_links")
    .select("id,token,is_active,created_at,last_used_at,expires_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false });

  const personalPageShareLinksSchemaMissing = isSupabaseMissingTableError(
    personalPageShareLinksError
  );
  const personalPageShareLinksLoadErrorMessage =
    personalPageShareLinksError && !personalPageShareLinksSchemaMissing
      ? `Could not load external share links (${personalPageShareLinksError.message}).`
      : null;
  const personalPageShareLinks = (
    personalPageShareLinksSchemaMissing ? [] : personalPageShareLinksRaw || []
  )
    .map((row) => ({
      id: String((row as { id?: string | null }).id || "").trim(),
      token: String((row as { token?: string | null }).token || "").trim(),
      is_active: Boolean((row as { is_active?: boolean | null }).is_active !== false),
      created_at: String((row as { created_at?: string | null }).created_at || ""),
      last_used_at:
        ((row as { last_used_at?: string | null }).last_used_at as string | null) || null,
      expires_at:
        ((row as { expires_at?: string | null }).expires_at as string | null) || null,
    }))
    .filter((row) => row.id && row.token) as PersonalPageShareLinkRow[];

  const buildExternalShareUrl = (token: string) => {
    const path = `/personal/share/${encodeURIComponent(token)}`;
    return appBaseUrl ? `${appBaseUrl}${path}` : path;
  };

  const pageIsFavorite = Boolean(pageUserState?.is_favorite);
  const initialRibbonTab = pageUserState?.last_ribbon_tab || defaultRibbonTabPreference;
  const initialZoomPercent =
    pageUserState?.zoom_percent && Number.isFinite(pageUserState.zoom_percent)
      ? Number(pageUserState.zoom_percent)
      : defaultZoomPercentPreference;
  const initialFocusMode = focusFromQuery ? true : Boolean(pageUserState?.focus_mode);
  const sidebarInitiallyCollapsed = Boolean(pageUserState?.sidebar_collapsed);
  const workspaceStateTableMissing = pageUserStateTableMissing || singlePageStateTableMissing;

  async function updatePageDetails(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const editorId = authData.user?.id ?? null;
    const title = String(formData.get("title") || "").trim();
    const sectionId = String(formData.get("section_id") || "").trim();
    const now = new Date().toISOString();

    if (!title) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Title is required");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_pages")
      .update({
        title,
        section_id: sectionId || null,
        updated_at: now,
      })
      .eq("id", pageId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { data: linkedTitleSyncedNotes, error: linkedTitleSyncError } = await supabase
      .from("notes")
      .update({
        title,
        last_edited_at: now,
        last_edited_by_user_id: editorId,
      })
      .eq("source_personal_page_id", pageId)
      .select("id,client_id");

    if (linkedTitleSyncError && !isMissingColumnError(linkedTitleSyncError)) {
      console.error("[personal.updatePageDetails.notes.syncTitle]", linkedTitleSyncError.message);
    }

    const linkedNotes = (linkedTitleSyncedNotes || []) as Array<{
      id: string;
      client_id: string | null;
    }>;
    linkedNotes.forEach((linkedNote) => {
      if (linkedNote.client_id) {
        revalidatePath(`/clients/${linkedNote.client_id}`);
        revalidatePath(`/clients/${linkedNote.client_id}/notes`);
        revalidatePath(`/clients/${linkedNote.client_id}/notes/${linkedNote.id}`);
      }
    });
    if (linkedNotes.length) {
      revalidatePath("/notes");
    }

    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
  }

  async function deletePersonalPage() {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    if (pageOwnerId !== user.id) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Only the page owner can delete it");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase.from("personal_pages").delete().eq("id", pageId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath("/personal");
    redirect("/personal");
  }

  async function savePageAsTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) {
      redirect("/login");
    }

    const name = String(formData.get("name") || "").trim();
    if (!name) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Template name is required");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase.from("personal_page_templates").upsert(
      {
        owner_id: currentUser.id,
        name,
        content: pageContent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,name" }
    );

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      if (isSupabaseMissingTableError(error)) {
        sp.set("error", "Page templates need sql/personal_templates_and_page_order.sql");
      } else {
        sp.set("error", error.message);
      }
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath("/personal");
    revalidatePath(`/personal/${pageId}`);
    const sp = new URLSearchParams();
    if (activeTab !== "notes") sp.set("tab", activeTab);
    sp.set("success", "Template saved");
    redirect(`/personal/${pageId}?${sp.toString()}`);
  }

  async function applyTemplateToPage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) {
      redirect("/login");
    }

    const templateId = String(formData.get("template_id") || "").trim();
    if (!templateId) {
      const sp = new URLSearchParams();
      sp.set("panel", "templates");
      sp.set("error", "Choose a template");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { data: template, error: templateError } = await supabase
      .from("personal_page_templates")
      .select("content")
      .eq("owner_id", currentUser.id)
      .eq("id", templateId)
      .maybeSingle();

    if (templateError) {
      const sp = new URLSearchParams();
      sp.set("panel", "templates");
      if (isSupabaseMissingTableError(templateError)) {
        sp.set("error", "Page templates need sql/personal_templates_and_page_order.sql");
      } else {
        sp.set("error", templateError.message);
      }
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    if (!template?.content || typeof template.content !== "object") {
      const sp = new URLSearchParams();
      sp.set("panel", "templates");
      sp.set("error", "Template has no content");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      content: template.content,
      updated_at: now,
      content_text: extractPlainText(template.content),
      last_edited_at: now,
      last_edited_by_user_id: currentUser.id,
    };

    let update = await supabase.from("personal_pages").update(updatePayload).eq("id", pageId);
    while (update.error && isMissingColumnError(update.error)) {
      const message = update.error.message || "";
      if (message.includes("content_text")) {
        delete updatePayload.content_text;
      } else if (message.includes("last_edited_at")) {
        delete updatePayload.last_edited_at;
      } else if (message.includes("last_edited_by_user_id")) {
        delete updatePayload.last_edited_by_user_id;
      } else {
        break;
      }
      update = await supabase.from("personal_pages").update(updatePayload).eq("id", pageId);
    }

    if (update.error) {
      const sp = new URLSearchParams();
      sp.set("panel", "templates");
      sp.set("error", update.error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath(`/personal/${pageId}`);
    const sp = new URLSearchParams();
    sp.set("panel", "templates");
    sp.set("success", "Template applied");
    redirect(`/personal/${pageId}?${sp.toString()}`);
  }

  async function addSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Select a user to share with",
        })
      );
    }

    if (!sectionId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "This page is in General. Use Page members or move it into a section.",
        })
      );
    }

    const { error } = await supabase.from("personal_section_members").upsert(
      {
        section_id: sectionId,
        user_id: userId,
        role,
      },
      { onConflict: "section_id,user_id" }
    );

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    try {
      await syncSectionShareMode(supabase, sectionId);
    } catch (e) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: e instanceof Error ? e.message : "Unable to apply section sharing",
        })
      );
    }
    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Section member added",
      })
    );
  }

  async function updateSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Missing member id",
        })
      );
    }

    const { error } = await supabase
      .from("personal_section_members")
      .update({ role })
      .eq("id", memberId);

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    revalidatePath(`/personal/${pageId}`);
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Section member updated",
      })
    );
  }

  async function removeSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Missing member id",
        })
      );
    }

    const { error } = await supabase
      .from("personal_section_members")
      .delete()
      .eq("id", memberId);

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    try {
      await syncSectionShareMode(supabase, sectionId);
    } catch (e) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: e instanceof Error ? e.message : "Unable to apply section sharing",
        })
      );
    }
    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Section member removed",
      })
    );
  }

  async function addPageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Select a user to share with",
        })
      );
    }

    const { error } = await supabase.from("personal_page_members").upsert(
      {
        page_id: pageId,
        user_id: userId,
        role,
      },
      { onConflict: "page_id,user_id" }
    );

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: e instanceof Error ? e.message : "Unable to apply page sharing",
        })
      );
    }
    revalidatePath(`/personal/${pageId}`);
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Page member added",
      })
    );
  }

  async function updatePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Missing member id",
        })
      );
    }

    const { error } = await supabase
      .from("personal_page_members")
      .update({ role })
      .eq("id", memberId);

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: e instanceof Error ? e.message : "Unable to apply page sharing",
        })
      );
    }
    revalidatePath(`/personal/${pageId}`);
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Page member updated",
      })
    );
  }

  async function removePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Missing member id",
        })
      );
    }

    const { error } = await supabase
      .from("personal_page_members")
      .delete()
      .eq("id", memberId);

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: e instanceof Error ? e.message : "Unable to apply page sharing",
        })
      );
    }
    revalidatePath(`/personal/${pageId}`);
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: "Page member removed",
      })
    );
  }

  async function linkPageToClientNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const clientId = String(formData.get("client_id") || "").trim();
    const visibility = String(formData.get("visibility") || "internal").trim() || "internal";
    const titlePrefix = pageTitle.trim() || "Personal page";
    const sourceContent =
      pageContent && typeof pageContent === "object" ? pageContent : null;
    const contentText = sourceContent
      ? extractPlainText(sourceContent)
      : String(pageContent || "").trim();
    const now = new Date().toISOString();

    if (!clientId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Select a client",
        })
      );
    }

    const noteInsert = {
      client_id: clientId,
      project_id: null,
      title: titlePrefix,
      visibility,
      content: contentText,
      content_json: sourceContent,
      source_personal_page_id: pageId,
      user_id: user.id,
      last_edited_at: now,
      last_edited_by_user_id: user.id,
    };

    const { data: note, error } = await supabase
      .from("notes")
      .insert(noteInsert)
      .select("id")
      .single();

    if (error && isMissingColumnError(error)) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Linked notes require sql/client_notes_linked_personal_pages.sql in Supabase.",
        })
      );
    }

    if (error || !note) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error?.message || "Unable to create client note",
        })
      );
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}/notes/${note.id}`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/personal/${pageId}`);
    redirect(`/clients/${clientId}/notes/${note.id}`);
  }

  async function toggleFavorite() {
    "use server";
    await togglePersonalPageFavorite({
      pageId,
      nextFavorite: !pageIsFavorite,
    });
    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
  }

  async function createExternalShareLink() {
    "use server";
    const supabase = createSupabaseServerClient();
    if (personalPageShareLinksSchemaMissing) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "External share links need sql/personal_page_share_links.sql in Supabase.",
        })
      );
    }

    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) {
      redirect("/login");
    }
    if (pageOwnerId !== currentUser.id) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Only the page owner can create external links.",
        })
      );
    }

    let lastErrorMessage = "Failed to create external share link.";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(24).toString("hex");
      const { error } = await supabase.from("personal_page_share_links").insert({
        page_id: pageId,
        token,
        is_active: true,
        created_by_user_id: currentUser.id,
      });
      if (!error) {
        revalidatePath(`/personal/${pageId}`);
        redirect(
          buildSharePanelUrl(pageId, focusFromQuery, {
            success: "External share link created.",
          })
        );
      }
      if (error.code !== "23505") {
        lastErrorMessage = error.message;
        break;
      }
      lastErrorMessage = error.message;
    }

    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        error: lastErrorMessage,
      })
    );
  }

  async function toggleExternalShareLink(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    if (personalPageShareLinksSchemaMissing) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "External share links need sql/personal_page_share_links.sql in Supabase.",
        })
      );
    }

    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData.user;
    if (!currentUser) {
      redirect("/login");
    }
    if (pageOwnerId !== currentUser.id) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Only the page owner can manage external links.",
        })
      );
    }

    const linkId = String(formData.get("link_id") || "").trim();
    const nextIsActive = String(formData.get("next_is_active") || "").trim() === "true";
    if (!linkId) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: "Missing external share link id.",
        })
      );
    }

    const { error } = await supabase
      .from("personal_page_share_links")
      .update({ is_active: nextIsActive })
      .eq("id", linkId)
      .eq("page_id", pageId);

    if (error) {
      redirect(
        buildSharePanelUrl(pageId, focusFromQuery, {
          error: error.message,
        })
      );
    }

    revalidatePath(`/personal/${pageId}`);
    redirect(
      buildSharePanelUrl(pageId, focusFromQuery, {
        success: nextIsActive ? "External share link activated." : "External share link deactivated.",
      })
    );
  }

  const pagePlainText =
    pageContent && typeof pageContent === "object"
      ? extractPlainText(pageContent)
      : String(pageContent || "");
  const pageWordCount = pagePlainText.trim()
    ? pagePlainText
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    : 0;
  const pageReadingMinutes = pageWordCount ? Math.max(1, Math.ceil(pageWordCount / 220)) : 0;
  const sectionRelation = page.personal_sections as
    | { title?: string | null }
    | Array<{ title?: string | null }>
    | null
    | undefined;
  const sectionTitle = Array.isArray(sectionRelation)
    ? sectionRelation[0]?.title || null
    : sectionRelation?.title || null;
  const sharePanelContent = (
    <div className="space-y-4">
      {isOwner ? (
        <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">External share links</h3>
            <p className="mt-1 text-xs text-slate-600">
              Share this page outside the app. Shared pages show only the note content.
            </p>
          </div>
          {personalPageShareLinksSchemaMissing ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              External sharing needs
              <span className="font-mono"> sql/personal_page_share_links.sql</span>.
            </p>
          ) : null}
          {personalPageShareLinksLoadErrorMessage ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {personalPageShareLinksLoadErrorMessage}
            </p>
          ) : null}
          <form action={createExternalShareLink}>
            <button
              type="submit"
              disabled={personalPageShareLinksSchemaMissing}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create external link
            </button>
          </form>
          {personalPageShareLinks.length ? (
            <div className="space-y-2">
              {personalPageShareLinks.map((link) => {
                const shareUrl = buildExternalShareUrl(link.token);
                return (
                  <div
                    key={link.id}
                    className="space-y-2 rounded-md border border-slate-200 bg-white px-2 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          link.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {link.is_active ? "Active" : "Inactive"}
                      </span>
                      <form action={toggleExternalShareLink}>
                        <input type="hidden" name="link_id" value={link.id} />
                        <input
                          type="hidden"
                          name="next_is_active"
                          value={link.is_active ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                        >
                          {link.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                    </div>
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-xs text-blue-700 underline underline-offset-2 hover:text-blue-800"
                    >
                      {shareUrl}
                    </a>
                    <p className="text-[11px] text-slate-500">
                      Created: {formatDateTime(link.created_at)} | Last used:{" "}
                      {formatDateTime(link.last_used_at)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              No external links yet.
            </p>
          )}
        </section>
      ) : null}
      {isOwner ? (
        <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Link client note
          </summary>
          <form action={linkPageToClientNote} className="mt-2 grid gap-2">
            <select
              name="client_id"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select client
              </option>
              {(clients || []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select
              name="visibility"
              defaultValue="internal"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="internal">internal</option>
              <option value="client_shared">client shared</option>
            </select>
            <button
              type="submit"
              className="rounded-md btn-primary px-3 py-2 text-sm font-semibold text-white"
            >
              Create linked note
            </button>
          </form>
        </details>
      ) : null}

      {sectionId ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">Section members</h3>
          <form action={addSectionMember} className="grid gap-2">
            <select
              name="user_id"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select user</option>
              {users?.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name || member.email}
                </option>
              ))}
            </select>
            <select
              name="role"
              defaultValue="view"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="view">View</option>
              <option value="edit">Edit</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              Add section member
            </button>
          </form>
          <div className="space-y-2">
            {sectionMembers?.length ? (
              sectionMembers.map((member) => (
                <div
                  key={member.id}
                  className="rounded-md border border-slate-200 px-2 py-2 text-xs"
                >
                  <p className="truncate text-slate-700">
                    {userLabelById[member.user_id] || "Unknown user"}
                  </p>
                  <form className="mt-1 flex items-center gap-1" action={updateSectionMember}>
                    <input type="hidden" name="member_id" value={member.id} />
                    <select
                      name="role"
                      defaultValue={member.role}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    >
                      Save
                    </button>
                    <button
                      type="submit"
                      formAction={removeSectionMember}
                      className="text-xs font-semibold text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">No section members yet.</p>
            )}
          </div>
        </section>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
          This page is in General. Section member sharing is unavailable.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Page members</h3>
        <form action={addPageMember} className="grid gap-2">
          <select
            name="user_id"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select user</option>
            {users?.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name || member.email}
              </option>
            ))}
          </select>
          <select
            name="role"
            defaultValue="view"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="view">View</option>
            <option value="edit">Edit</option>
          </select>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-400"
          >
            Add page member
          </button>
        </form>
        <div className="space-y-2">
          {pageMembers?.length ? (
            pageMembers.map((member) => (
              <div
                key={member.id}
                className="rounded-md border border-slate-200 px-2 py-2 text-xs"
              >
                <p className="truncate text-slate-700">
                  {userLabelById[member.user_id] || "Unknown user"}
                </p>
                <form className="mt-1 flex items-center gap-1" action={updatePageMember}>
                  <input type="hidden" name="member_id" value={member.id} />
                  <select
                    name="role"
                    defaultValue={member.role}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  >
                    Save
                  </button>
                  <button
                    type="submit"
                    formAction={removePageMember}
                    className="text-xs font-semibold text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </form>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500">No page-specific members yet.</p>
          )}
        </div>
      </section>
    </div>
  );
  const historyPanelContent = (
    <div className="space-y-3 text-sm text-slate-700">
      <p>
        <span className="font-semibold text-slate-900">Last edited:</span>{" "}
        {lastEditedAtLabel || "Not available"}
      </p>
      <p>
        <span className="font-semibold text-slate-900">Edited by:</span>{" "}
        {lastEditedByLabel || "Unknown"}
      </p>
      <p>
        <span className="font-semibold text-slate-900">Word count:</span>{" "}
        {pageWordCount.toLocaleString()}
      </p>
      <p>
        <span className="font-semibold text-slate-900">Reading time:</span>{" "}
        {pageReadingMinutes ? `${pageReadingMinutes} min` : "0 min"}
      </p>
      <p>
        <span className="font-semibold text-slate-900">Share mode:</span>{" "}
        {page.share_mode || "private"}
      </p>
    </div>
  );
  const templatesPanelContent = (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Save as template</h3>
        <form action={savePageAsTemplate} className="grid gap-2">
          <input
            name="name"
            defaultValue={pageTitle}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
          >
            Save template
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Apply template</h3>
        <form action={applyTemplateToPage} className="grid gap-2">
          <select
            name="template_id"
            defaultValue=""
            disabled={pageTemplatesTableMissing}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="">Select template</option>
            {pageTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
            disabled={pageTemplatesTableMissing}
          >
            Apply to this page
          </button>
        </form>
        <p className="text-xs text-slate-500">
          {pageTemplatesTableMissing
            ? "Templates require sql/personal_templates_and_page_order.sql."
            : `${pageTemplates.length} template${pageTemplates.length === 1 ? "" : "s"} available.`}
        </p>
      </section>
    </div>
  );
  return (
    <div className="space-y-4 xl:grid xl:h-[calc(100vh-8.5rem)] xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start xl:gap-4 xl:space-y-0 xl:overflow-hidden">
      <PersonalSidebarTree
        sections={sidebarTree.sections}
        generalPages={sidebarTree.generalPages}
        currentPageId={pageId}
        persistPageId={pageId}
        initialCollapsed={sidebarInitiallyCollapsed}
        pageStateByPageId={pageUserStateById}
      />

      <div className="space-y-4 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1">
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

        {workspaceStateTableMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Favorites and per-page workspace state need
            <span className="font-mono"> sql/personal_workspace_user_state.sql</span>.
          </p>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Link href="/personal" className="hover:text-slate-700">
                  Personal
                </Link>
                {" / "}
                {sectionTitle || "General"}
                {" / "}
                {pageTitle}
              </p>
              <form action={updatePageDetails} className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  name="title"
                  defaultValue={page.title}
                  aria-label="Page title"
                  className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <select
                  name="section_id"
                  defaultValue={page.section_id || ""}
                  aria-label="Section"
                  className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="">General</option>
                  {sections?.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-1.5 text-sm font-semibold text-white"
                >
                  Save title
                </button>
              </form>
              <p className="mt-2 text-xs text-slate-500">
                {lastEditedAtLabel ? `Last edited ${lastEditedAtLabel}` : "No edit history yet"}
                {lastEditedByLabel ? ` by ${lastEditedByLabel}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <form action={toggleFavorite}>
                <button
                  type="submit"
                  className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                    pageIsFavorite
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {pageIsFavorite ? "Favorited" : "Favorite"}
                </button>
              </form>

              <details className="relative" open={activePanel === "share"}>
                <summary
                  className={`list-none cursor-pointer rounded-md border px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
                    activePanel === "share"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  Share
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="max-h-[70vh] overflow-auto p-3">{sharePanelContent}</div>
                </div>
              </details>

              <details className="relative" open={activePanel === "history"}>
                <summary
                  className={`list-none cursor-pointer rounded-md border px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
                    activePanel === "history"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  History
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="max-h-[70vh] overflow-auto p-3">{historyPanelContent}</div>
                </div>
              </details>

              <details className="relative" open={activePanel === "templates"}>
                <summary
                  className={`list-none cursor-pointer rounded-md border px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
                    activePanel === "templates"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  Templates
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="max-h-[70vh] overflow-auto p-3">{templatesPanelContent}</div>
                </div>
              </details>

              {isOwner ? (
                <form action={deletePersonalPage}>
                  <ConfirmDelete
                    name={pageTitle}
                    itemType="Personal page"
                    triggerLabel={
                      <span className="inline-flex rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700">
                        Delete
                      </span>
                    }
                    confirmLabel="Confirm delete page"
                    pendingRedirectHref="/personal"
                  />
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <div className="space-y-3">
          <PersonalPageEditorClient
            pageId={page.id}
            initialContent={page.content ?? null}
            lastEditedAtLabel={lastEditedAtLabel}
            lastEditedByLabel={lastEditedByLabel}
            initialContextMenuFavorites={initialContextMenuFavorites}
            persistContextMenuFavorites={persistContextMenuFavorites}
            initialUpdatedAt={page.updated_at || null}
            initialRibbonTab={initialRibbonTab}
            initialZoomPercent={initialZoomPercent}
            initialFocusMode={initialFocusMode}
          />
        </div>
      </div>

    </div>
  );
}

