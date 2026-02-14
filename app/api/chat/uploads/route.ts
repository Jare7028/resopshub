import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSignedChatAttachmentUrl } from "@/lib/chatAttachments";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxImageSizeBytes = 10 * 1024 * 1024;

function getExtension(file: File) {
  const fromName = file.name.split(".").pop()?.trim().toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "bin";
}

function safeFilename(name: string) {
  const normalized = name.trim() || "image";
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

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

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  if (file.size > maxImageSizeBytes) {
    return NextResponse.json({ error: "Image exceeds 10MB limit" }, { status: 400 });
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

  const ext = getExtension(file);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const fileName = safeFilename(file.name || `image-${timestamp}.${ext}`);
  const storagePath = `${conversationId}/${userId}/${timestamp}-${random}-${fileName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("chat-attachments")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
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
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      url: signedUrl,
    },
  });
}
