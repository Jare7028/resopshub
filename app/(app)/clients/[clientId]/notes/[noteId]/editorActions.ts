"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { syncMentionAssignmentsFromTextChange } from "@/lib/mentionAssignments";
import { notifyMentionedUsersFromTextChange } from "@/lib/mentionNotifications";
import { extractMentionHandles } from "@/lib/mentions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

export async function updateClientNoteContent(
  clientId: string,
  noteId: string,
  content: unknown,
  sourcePersonalPageId: string | null = null
) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const editorId = authData.user?.id ?? null;
  const now = new Date().toISOString();
  const contentText = extractPlainText(content);
  const mentionHandles = extractMentionHandles(contentText);
  let previousContentText: string | null = null;
  let noteTitle: string | null = null;

  if (mentionHandles.length) {
    const { data: existingNote } = await supabase
      .from("notes")
      .select("content,title")
      .eq("id", noteId)
      .eq("client_id", clientId)
      .maybeSingle();
    previousContentText = String(existingNote?.content || "").trim() || null;
    noteTitle = String(existingNote?.title || "").trim() || null;
  }

  const { error: updateError } = await supabase
    .from("notes")
    .update({
      content_json: content,
      content: contentText,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", noteId)
    .eq("client_id", clientId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (sourcePersonalPageId) {
    const { error: linkedPageSyncError } = await supabase
      .from("personal_pages")
      .update({
        content,
        content_text: contentText,
        updated_at: now,
        last_edited_at: now,
        last_edited_by_user_id: editorId,
      })
      .eq("id", sourcePersonalPageId);
    if (linkedPageSyncError && !isMissingColumnError(linkedPageSyncError)) {
      console.error(
        "[clientNotes.updateClientNoteContent.personal.sync]",
        linkedPageSyncError.message
      );
    }
  }

  if (mentionHandles.length) {
    try {
      await syncMentionAssignmentsFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "client_note",
        sourceId: noteId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[clientNotes.updateClientNoteContent.mentions.assign]", message);
    }

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "client_note",
        sourceId: noteId,
        sourceUrl: `/clients/${clientId}/notes/${noteId}`,
        sourceTitle: noteTitle || "Client note",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[clientNotes.updateClientNoteContent.mentions.notify]", message);
    }
  }

  revalidatePath(`/clients/${clientId}/notes/${noteId}`);
  revalidatePath(`/clients/${clientId}/notes`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/notes");
  if (sourcePersonalPageId) {
    revalidatePath(`/personal/${sourcePersonalPageId}`);
  }
  revalidatePath("/personal");
}

export async function createTaskFromClientNote(input: {
  clientId: string;
  noteId: string;
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

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("id,title,client_id")
    .eq("id", input.noteId)
    .eq("client_id", input.clientId)
    .maybeSingle();

  if (noteError) {
    throw new Error(noteError.message);
  }

  if (!note) {
    throw new Error("Client note not found");
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

  const sourceUrl = `/clients/${input.clientId}/notes/${input.noteId}`;
  const taskContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Source: Client note - ${note.title || "Untitled"}`,
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
      client_id: note.client_id || null,
      content: taskContent,
      content_text: contentText,
    });

  if (error) {
    throw new Error(formatDbError("clientNotes.createTaskFromClientNote.tasks.insert", error));
  }

  return { taskId };
}
