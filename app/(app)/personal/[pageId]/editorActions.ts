"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";

export async function updatePersonalPageContent(pageId: string, content: unknown) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const editorId = authData.user?.id ?? null;
  const contentText = extractPlainText(content);
  await supabase
    .from("personal_pages")
    .update({
      content,
      content_text: contentText,
      updated_at: now,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", pageId);

  revalidatePath(`/personal/${pageId}`);
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
