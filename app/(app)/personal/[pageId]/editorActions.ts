"use server";

import { revalidatePath } from "next/cache";
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
