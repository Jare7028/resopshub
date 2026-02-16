"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { syncMentionAssignmentsFromTextChange } from "@/lib/mentionAssignments";
import { notifyMentionedUsersFromTextChange } from "@/lib/mentionNotifications";
import { extractMentionHandles } from "@/lib/mentions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { extractPlainText } from "@/lib/tiptapText";

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

const CONTEXT_MENU_FAVORITE_ACTION_ID_SET = new Set([
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
    return [] as string[];
  }
  const next = value
    .map((item) => String(item || "").trim())
    .filter((item) => CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has(item));
  return Array.from(new Set(next));
}

export async function updatePersonalPageContent(pageId: string, content: unknown) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const editorId = authData.user?.id ?? null;
  const contentText = extractPlainText(content);
  const mentionHandles = extractMentionHandles(contentText);
  let previousContentText: string | null = null;
  let pageTitle: string | null = null;

  if (mentionHandles.length) {
    const { data: existingPage } = await supabase
      .from("personal_pages")
      .select("content_text,title")
      .eq("id", pageId)
      .maybeSingle();
    previousContentText = String(existingPage?.content_text || "").trim() || null;
    pageTitle = String(existingPage?.title || "").trim() || null;
  }

  const { error: updateError } = await supabase
    .from("personal_pages")
    .update({
      content,
      content_text: contentText,
      updated_at: now,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", pageId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { data: linkedNotesSynced, error: linkedNotesSyncError } = await supabase
    .from("notes")
    .update({
      content_json: content,
      content: contentText,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("source_personal_page_id", pageId)
    .select("id,client_id");

  if (linkedNotesSyncError && !isMissingColumnError(linkedNotesSyncError)) {
    console.error("[personal.updatePersonalPageContent.notes.sync]", linkedNotesSyncError.message);
  }

  if (mentionHandles.length) {
    try {
      await syncMentionAssignmentsFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "personal_page",
        sourceId: pageId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[personal.updatePersonalPageContent.mentions.assign]", message);
    }

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "personal_page",
        sourceId: pageId,
        sourceUrl: `/personal/${pageId}`,
        sourceTitle: pageTitle || "Personal page",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[personal.updatePersonalPageContent.mentions.notify]", message);
    }
  }

  const linkedNotes = (linkedNotesSynced || []) as Array<{
    id: string;
    client_id: string | null;
  }>;
  linkedNotes.forEach((note) => {
    if (note.client_id) {
      revalidatePath(`/clients/${note.client_id}`);
      revalidatePath(`/clients/${note.client_id}/notes`);
      revalidatePath(`/clients/${note.client_id}/notes/${note.id}`);
    }
  });
  if (linkedNotes.length) {
    revalidatePath("/notes");
  }

  revalidatePath(`/personal/${pageId}`);
  revalidatePath("/personal");
}

export async function savePersonalContextMenuFavorites(input: { favorites: string[] }) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;

  if (!userId) {
    throw new Error("Not signed in");
  }

  const favorites = normalizeContextMenuFavorites(input.favorites);

  const { error } = await supabase
    .from("user_note_editor_preferences")
    .upsert(
      {
        user_id: userId,
        personal_context_menu_favorites: favorites,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return;
    }
    throw new Error(error.message);
  }
}

export async function createTaskFromPersonalPage(input: {
  pageId: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  assignToMe: boolean;
}) {
  const formatDbError = (
    context: string,
    error:
      | { message: string; code?: string; details?: string | null; hint?: string | null }
      | null
      | undefined
  ) => {
    if (!error) return context;
    const parts = [`[${context}]`, error.message];
    if (error.code) parts.push(`code=${error.code}`);
    if (error.details) parts.push(`details=${error.details}`);
    if (error.hint) parts.push(`hint=${error.hint}`);
    return parts.join(" | ");
  };

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData.user;

  if (!authUser) {
    throw new Error("Not signed in");
  }

  const title = String(input.title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    throw new Error("Task title is required");
  }

  const dueDate = (input.dueDate || "").trim() || null;
  const dueTime = (input.dueTime || "").trim() || null;

  if (dueTime && !dueDate) {
    throw new Error("Choose a due date if you set a time");
  }

  const { data: page, error: pageError } = await supabase
    .from("personal_pages")
    .select("id,title")
    .eq("id", input.pageId)
    .maybeSingle();

  if (pageError) {
    throw new Error(pageError.message);
  }

  if (!page) {
    throw new Error("Personal page not found");
  }

  let assigneeUserId: string | null = null;
  if (input.assignToMe) {
    const authEmail = authUser.email;
    if (authEmail) {
      const { data: appUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", authEmail)
        .maybeSingle();

      if (userError) {
        throw new Error(userError.message);
      }

      assigneeUserId = appUser?.id || null;
    }
  }

  const sourceUrl = `/personal/${page.id}`;
  const taskContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Source: Personal page - ${page.title}`,
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: sourceUrl,
          },
        ],
      },
      { type: "paragraph" },
    ],
  };

  const contentText = extractPlainText(taskContent);

  const taskId = randomUUID();
  const { error } = await supabase
    .from("tasks")
    .insert({
      id: taskId,
      title,
      status: "to_do",
      priority: "medium",
      due_date: dueDate,
      due_time: dueTime,
      assignee_user_id: assigneeUserId,
      created_by_user_id: authUser.id,
      content: taskContent,
      content_text: contentText,
    });

  if (error) {
    throw new Error(formatDbError("personal.createTaskFromPersonalPage.tasks.insert", error));
  }

  return { taskId };
}
