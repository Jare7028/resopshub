"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import type { PersonalWorkspaceRibbonTab } from "./types";

function normalizeRibbonTab(value: unknown): PersonalWorkspaceRibbonTab {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "home" ||
    normalized === "insert" ||
    normalized === "layout" ||
    normalized === "review" ||
    normalized === "view"
  ) {
    return normalized;
  }
  return "home";
}

function normalizeZoomPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(1000, Math.max(20, Math.round(numeric)));
}

async function requireAuthUser() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    throw new Error("Not signed in");
  }
  return { supabase, userId };
}

async function readPageState(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  pageId: string
) {
  const { data, error } = await supabase
    .from("personal_page_user_state")
    .select(
      "page_id,is_favorite,last_opened_at,zoom_percent,last_ribbon_tab,sidebar_collapsed,focus_mode"
    )
    .eq("page_id", pageId)
    .maybeSingle();

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return null;
    }
    throw new Error(error.message);
  }

  return data || null;
}

export async function upsertPersonalPageUserState(input: {
  pageId: string;
  isFavorite?: boolean;
  zoomPercent?: number;
  ribbonTab?: string;
  sidebarCollapsed?: boolean;
  focusMode?: boolean;
  touchOpenedAt?: boolean;
}) {
  const pageId = String(input.pageId || "").trim();
  if (!pageId) {
    return { ok: false as const, error: "Missing page id" };
  }

  const { supabase, userId } = await requireAuthUser();
  const existing = await readPageState(supabase, pageId);

  const payload: Record<string, unknown> = {
    user_id: userId,
    page_id: pageId,
  };

  if (typeof input.isFavorite === "boolean") {
    payload.is_favorite = input.isFavorite;
  } else if (existing?.is_favorite !== undefined) {
    payload.is_favorite = existing.is_favorite;
  } else {
    payload.is_favorite = false;
  }

  if (typeof input.zoomPercent === "number") {
    payload.zoom_percent = normalizeZoomPercent(input.zoomPercent);
  } else if (existing?.zoom_percent !== undefined) {
    payload.zoom_percent = existing.zoom_percent;
  } else {
    payload.zoom_percent = 100;
  }

  if (input.ribbonTab !== undefined) {
    payload.last_ribbon_tab = normalizeRibbonTab(input.ribbonTab);
  } else if (existing?.last_ribbon_tab !== undefined) {
    payload.last_ribbon_tab = normalizeRibbonTab(existing.last_ribbon_tab);
  } else {
    payload.last_ribbon_tab = "home";
  }

  if (typeof input.sidebarCollapsed === "boolean") {
    payload.sidebar_collapsed = input.sidebarCollapsed;
  } else if (existing?.sidebar_collapsed !== undefined) {
    payload.sidebar_collapsed = existing.sidebar_collapsed;
  } else {
    payload.sidebar_collapsed = false;
  }

  if (typeof input.focusMode === "boolean") {
    payload.focus_mode = input.focusMode;
  } else if (existing?.focus_mode !== undefined) {
    payload.focus_mode = existing.focus_mode;
  } else {
    payload.focus_mode = false;
  }

  if (input.touchOpenedAt) {
    payload.last_opened_at = new Date().toISOString();
  } else if (existing?.last_opened_at !== undefined) {
    payload.last_opened_at = existing.last_opened_at;
  } else {
    payload.last_opened_at = null;
  }

  const { error } = await supabase
    .from("personal_page_user_state")
    .upsert(payload, { onConflict: "user_id,page_id" });

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return { ok: false as const, missingTable: true as const };
    }
    return { ok: false as const, error: error.message };
  }

  revalidatePath("/personal");
  revalidatePath(`/personal/${pageId}`);
  return { ok: true as const };
}

export async function togglePersonalPageFavorite(input: {
  pageId: string;
  nextFavorite?: boolean;
}) {
  const pageId = String(input.pageId || "").trim();
  if (!pageId) {
    return { ok: false as const, error: "Missing page id" };
  }
  const { supabase } = await requireAuthUser();
  const existing = await readPageState(supabase, pageId);
  const nextFavorite =
    typeof input.nextFavorite === "boolean"
      ? input.nextFavorite
      : !Boolean(existing?.is_favorite);

  return upsertPersonalPageUserState({
    pageId,
    isFavorite: nextFavorite,
  });
}

export async function recordPersonalPageOpened(input: { pageId: string }) {
  return upsertPersonalPageUserState({
    pageId: input.pageId,
    touchOpenedAt: true,
  });
}

export async function reorderPersonalTreeNode(input: {
  kind: "section" | "page";
  sectionId?: string | null;
  orderedIds: string[];
}) {
  const orderedIds = Array.from(
    new Set(
      (input.orderedIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  if (!orderedIds.length) {
    return { ok: false as const, error: "Missing ordered ids" };
  }

  const { supabase, userId } = await requireAuthUser();

  if (input.kind === "section") {
    const { data: sections, error } = await supabase
      .from("personal_sections")
      .select("id,owner_id")
      .in("id", orderedIds);

    if (error) {
      return { ok: false as const, error: error.message };
    }

    const rows = sections || [];
    if (rows.length !== orderedIds.length) {
      return { ok: false as const, error: "Some sections are not available" };
    }
    if (rows.some((row) => row.owner_id !== userId)) {
      return { ok: false as const, error: "Only section owners can reorder sections" };
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      const sectionId = orderedIds[index];
      const { error: updateError } = await supabase
        .from("personal_sections")
        .update({ sort_order: index + 1 })
        .eq("id", sectionId);
      if (updateError) {
        return { ok: false as const, error: updateError.message };
      }
    }
  } else {
    const sectionId = input.sectionId ? String(input.sectionId) : null;
    const { data: pages, error } = await supabase
      .from("personal_pages")
      .select("id,owner_id,section_id")
      .in("id", orderedIds);

    if (error) {
      if (isSupabaseMissingColumnError(error)) {
        return {
          ok: false as const,
          error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
        };
      }
      return { ok: false as const, error: error.message };
    }

    const rows = pages || [];
    if (rows.length !== orderedIds.length) {
      return { ok: false as const, error: "Some pages are not available" };
    }
    if (rows.some((row) => row.owner_id !== userId)) {
      return { ok: false as const, error: "Only page owners can reorder pages" };
    }
    if (
      rows.some((row) =>
        sectionId ? row.section_id !== sectionId : row.section_id !== null
      )
    ) {
      return { ok: false as const, error: "Pages must stay in the same section" };
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      const pageId = orderedIds[index];
      const { error: updateError } = await supabase
        .from("personal_pages")
        .update({ sort_order: index + 1 })
        .eq("id", pageId);
      if (updateError) {
        if (isSupabaseMissingColumnError(updateError)) {
          return {
            ok: false as const,
            error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
          };
        }
        return { ok: false as const, error: updateError.message };
      }
    }
  }

  revalidatePath("/personal");
  return { ok: true as const };
}

export async function createPersonalSection(input: { title: string }) {
  const title = String(input.title || "").trim();
  if (!title) {
    return { ok: false as const, error: "Section title is required" };
  }

  const { supabase, userId } = await requireAuthUser();
  const { data: lastSection } = await supabase
    .from("personal_sections")
    .select("sort_order")
    .eq("owner_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSort = Number(lastSection?.sort_order || 0) + 1;
  const { error } = await supabase.from("personal_sections").insert({
    title,
    owner_id: userId,
    sort_order: nextSort,
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath("/personal");
  return { ok: true as const };
}

export async function renamePersonalSection(input: { sectionId: string; title: string }) {
  const sectionId = String(input.sectionId || "").trim();
  const title = String(input.title || "").trim();
  if (!sectionId || !title) {
    return { ok: false as const, error: "Section title is required" };
  }
  const { supabase } = await requireAuthUser();
  const { error } = await supabase
    .from("personal_sections")
    .update({ title })
    .eq("id", sectionId);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/personal");
  return { ok: true as const };
}

export async function deletePersonalSection(input: { sectionId: string }) {
  const sectionId = String(input.sectionId || "").trim();
  if (!sectionId) {
    return { ok: false as const, error: "Missing section id" };
  }
  const { supabase, userId } = await requireAuthUser();
  const { data: section, error: sectionError } = await supabase
    .from("personal_sections")
    .select("id,owner_id")
    .eq("id", sectionId)
    .maybeSingle();
  if (sectionError) {
    return { ok: false as const, error: sectionError.message };
  }
  if (!section) {
    return { ok: false as const, error: "Section not found" };
  }
  if (section.owner_id !== userId) {
    return { ok: false as const, error: "Only the section owner can delete it" };
  }
  const { error } = await supabase.from("personal_sections").delete().eq("id", sectionId);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/personal");
  return { ok: true as const };
}

export async function createPersonalPage(input: {
  title: string;
  sectionId?: string | null;
}) {
  const title = String(input.title || "").trim();
  const sectionId = input.sectionId ? String(input.sectionId).trim() : null;
  if (!title) {
    return { ok: false as const, error: "Page title is required" };
  }

  const { supabase, userId } = await requireAuthUser();

  let nextSort = 1;
  let canUseSortOrder = true;
  let sortQuery = supabase
    .from("personal_pages")
    .select("sort_order")
    .eq("owner_id", userId)
    .limit(1)
    .order("sort_order", { ascending: false });
  if (sectionId) {
    sortQuery = sortQuery.eq("section_id", sectionId);
  } else {
    sortQuery = sortQuery.is("section_id", null);
  }
  const { data: lastSort, error: sortError } = await sortQuery.maybeSingle();
  if (sortError && isSupabaseMissingColumnError(sortError)) {
    canUseSortOrder = false;
  } else {
    nextSort = Number(lastSort?.sort_order || 0) + 1;
  }

  const payload: Record<string, unknown> = {
    owner_id: userId,
    title,
    section_id: sectionId || null,
    share_mode: "private",
    content: DEFAULT_EDITOR_CONTENT,
    content_text: extractPlainText(DEFAULT_EDITOR_CONTENT),
    updated_at: new Date().toISOString(),
    last_edited_at: new Date().toISOString(),
    last_edited_by_user_id: userId,
  };
  if (canUseSortOrder) {
    payload.sort_order = nextSort;
  }

  let insertResult = await supabase
    .from("personal_pages")
    .insert(payload)
    .select("id")
    .single();

  while (insertResult.error && isSupabaseMissingColumnError(insertResult.error)) {
    const message = insertResult.error.message || "";
    if (message.includes("sort_order")) {
      delete payload.sort_order;
    } else if (message.includes("content_text")) {
      delete payload.content_text;
    } else if (message.includes("last_edited_at")) {
      delete payload.last_edited_at;
    } else if (message.includes("last_edited_by_user_id")) {
      delete payload.last_edited_by_user_id;
    } else {
      break;
    }
    insertResult = await supabase
      .from("personal_pages")
      .insert(payload)
      .select("id")
      .single();
  }

  if (insertResult.error || !insertResult.data?.id) {
    return {
      ok: false as const,
      error: insertResult.error?.message || "Unable to create page",
    };
  }

  const pageId = String(insertResult.data.id);
  revalidatePath("/personal");
  revalidatePath(`/personal/${pageId}`);
  return { ok: true as const, pageId };
}

export async function renamePersonalPage(input: { pageId: string; title: string }) {
  const pageId = String(input.pageId || "").trim();
  const title = String(input.title || "").trim();
  if (!pageId || !title) {
    return { ok: false as const, error: "Page title is required" };
  }
  const { supabase } = await requireAuthUser();
  const { error } = await supabase
    .from("personal_pages")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/personal");
  revalidatePath(`/personal/${pageId}`);
  return { ok: true as const };
}

export async function deletePersonalPageInline(input: { pageId: string }) {
  const pageId = String(input.pageId || "").trim();
  if (!pageId) {
    return { ok: false as const, error: "Missing page id" };
  }
  const { supabase } = await requireAuthUser();
  const { error } = await supabase.from("personal_pages").delete().eq("id", pageId);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/personal");
  return { ok: true as const };
}
