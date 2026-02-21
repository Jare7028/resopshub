import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SOCIAL_POST_IMAGES_BUCKET = "social-post-images";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getExtension(file: File) {
  const fromName = file.name.split(".").pop()?.trim().toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.type === "image/avif") return "avif";
  return "bin";
}

function safeFilename(name: string) {
  const normalized = name.trim() || "image";
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  const params = await context.params;
  const pageId = String(params.pageId || "").trim();

  if (!uuidRegex.test(pageId)) {
    return NextResponse.json({ error: "Invalid social page id" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canEditPageResult = await supabase.rpc("can_edit_page", {
    p_page_key: "social",
  });

  if (!canEditPageResult.error && !canEditPageResult.data) {
    return NextResponse.json({ error: "You have view-only access to Social." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json({ error: "Image exceeds 10MB limit" }, { status: 400 });
  }

  const canAccessPageResult = await supabase.rpc("can_access_social_page", {
    social_page_uuid: pageId,
  });

  if (canAccessPageResult.error) {
    return NextResponse.json({ error: canAccessPageResult.error.message }, { status: 500 });
  }

  if (!canAccessPageResult.data) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const extension = getExtension(file);
  const timestamp = Date.now();
  const random = randomBytes(5).toString("hex");
  const fileName = safeFilename(file.name || `image-${timestamp}.${extension}`);
  const storagePath = `${pageId}/${user.id}/${timestamp}-${random}-${fileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(SOCIAL_POST_IMAGES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage
    .from(SOCIAL_POST_IMAGES_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = String(publicUrlData.publicUrl || "").trim();
  if (!publicUrl) {
    return NextResponse.json({ error: "Unable to create image URL" }, { status: 500 });
  }

  return NextResponse.json({
    image: {
      storage_path: storagePath,
      url: publicUrl,
      filename: file.name || fileName,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    },
  });
}
