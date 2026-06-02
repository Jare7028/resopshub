"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { syncMentionAssignmentsFromTextChange } from "@/lib/mentionAssignments";
import { notifyMentionedUsersFromTextChange } from "@/lib/mentionNotifications";
import { extractMentionHandles } from "@/lib/mentions";
import { normalizeAndPersistNoteImages } from "@/lib/noteImagePersistence";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";
import { logError } from "@/lib/vercelLogger";

export async function updateTaskContent(
  taskId: string,
  content: unknown
): Promise<{ content: unknown; warnings: string[] }> {
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "tasks.editor.update.auth");
  if (!authUser) {
    throw new Error("Not signed in");
  }
  const now = new Date().toISOString();
  const editorId = authUser.id;
  const persistedContent = await normalizeAndPersistNoteImages({
    content,
    scope: "task_note",
    entityId: taskId,
    userId: editorId,
    supabase,
  });
  const canonicalContent = persistedContent.content;
  const contentText = extractPlainText(canonicalContent);
  const mentionHandles = extractMentionHandles(contentText);
  let previousContentText: string | null = null;
  let taskTitle: string | null = null;

  if (mentionHandles.length) {
    const { data: existingTask } = await supabase
      .from("tasks")
      .select("content_text,title")
      .eq("id", taskId)
      .maybeSingle();
    previousContentText = String(existingTask?.content_text || "").trim() || null;
    taskTitle = String(existingTask?.title || "").trim() || null;
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      content: canonicalContent,
      content_text: contentText,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", taskId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (mentionHandles.length) {
    try {
      await syncMentionAssignmentsFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "task",
        sourceId: taskId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("tasks.update_content.mentions_assign_failed", { taskId, message });
    }

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: editorId,
        previousText: previousContentText,
        nextText: contentText,
        sourceType: "task",
        sourceId: taskId,
        sourceUrl: `/tasks/${taskId}`,
        sourceTitle: taskTitle || "Task notes",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("tasks.update_content.mentions_notify_failed", { taskId, message });
    }
  }

  revalidatePath(`/tasks/${taskId}`);

  return {
    content: canonicalContent,
    warnings: persistedContent.warnings,
  };
}

export async function createTaskFromTaskNote(input: {
  taskId: string;
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
  const authUser = await getCurrentRequestUser(
    supabase,
    "tasks.editor.create_task.auth"
  );

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

  const { data: sourceTask, error: sourceTaskError } = await supabase
    .from("tasks")
    .select("id,title")
    .eq("id", input.taskId)
    .maybeSingle();

  if (sourceTaskError) {
    throw new Error(sourceTaskError.message);
  }

  if (!sourceTask) {
    throw new Error("Source task not found");
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

  const sourceUrl = `/tasks/${sourceTask.id}`;
  const taskContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Source: Task note - ${sourceTask.title || "Untitled task"}`,
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
    throw new Error(formatDbError("tasks.createTaskFromTaskNote.tasks.insert", error));
  }

  return { taskId };
}
