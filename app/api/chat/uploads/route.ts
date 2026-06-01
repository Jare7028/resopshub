import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSignedChatAttachmentUrl } from "@/lib/chatAttachments";
import {
  safeUploadImageFilename,
  validateUploadImageFile,
} from "@/lib/imageUploadValidation";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxImageSizeBytes = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const conversationId = String(formData.get("conversation_id") || "").trim();
  const file = formData.get("file");
  if (!uuidRegex.test(conversationId) || !(file instanceof File)) {
    return NextResponse.json({ error: "Invalid conversation_id or file" }, { status: 400 });
  }

  const validation = validateUploadImageFile(file, { maxSizeBytes: maxImageSizeBytes });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const fileName = safeUploadImageFilename(file.name, validation.extension, `image-${timestamp}`);
  const storagePath = `${conversationId}/${userId}/${timestamp}-${random}-${fileName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("chat-attachments")
    .upload(storagePath, arrayBuffer, {
      contentType: validation.mimeType,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const signedUrl = await getSignedChatAttachmentUrl(supabase.storage, storagePath);
  if (!signedUrl) {
    return NextResponse.json({ error: "Unable to create image URL" }, { status: 500 });
  }

  return NextResponse.json({
    attachment: {
      storage_path: storagePath,
      filename: file.name || fileName,
      mime_type: validation.mimeType,
      size_bytes: file.size,
      url: signedUrl,
    },
  });
}
