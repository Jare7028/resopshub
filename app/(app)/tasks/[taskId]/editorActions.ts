"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";

export async function updateTaskContent(taskId: string, content: unknown) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const editorId = authData.user?.id ?? null;
  const contentText = extractPlainText(content);
  await supabase
    .from("tasks")
    .update({
      content,
      content_text: contentText,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", taskId);
  revalidatePath(`/tasks/${taskId}`);
}
