"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";

export async function updateClientNoteContent(
  clientId: string,
  noteId: string,
  content: unknown
) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const editorId = authData.user?.id ?? null;
  const now = new Date().toISOString();
  const contentText = extractPlainText(content);

  await supabase
    .from("notes")
    .update({
      content_json: content,
      content: contentText,
      last_edited_at: now,
      last_edited_by_user_id: editorId,
    })
    .eq("id", noteId)
    .eq("client_id", clientId);

  revalidatePath(`/clients/${clientId}/notes/${noteId}`);
  revalidatePath(`/clients/${clientId}/notes`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/notes");
}

