import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";

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
  const requestId = randomUUID();
  const params = await context.params;
  const pageId = String(params.pageId || "").trim();

  logInfo("social.image.upload.start", {
    request_id: requestId,
    page_id: pageId,
  });

  if (!uuidRegex.test(pageId)) {
    logWarn("social.image.upload.invalid_page_id", {
      request_id: requestId,
      page_id: pageId,
    });
    return NextResponse.json({ error: "Invalid social page id" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    logWarn("social.image.upload.unauthorized", {
      request_id: requestId,
      page_id: pageId,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canEditPageResult = await supabase.rpc("can_edit_page", {
    p_page_key: "social",
  });

  if (canEditPageResult.error) {
    logError("social.image.upload.page_permission_check_error", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      error: canEditPageResult.error,
    });
    return NextResponse.json({ error: "Could not verify Social edit access." }, { status: 500 });
  }

  if (!canEditPageResult.error && !canEditPageResult.data) {
    logWarn("social.image.upload.page_permission_denied", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
    });
    return NextResponse.json({ error: "You have view-only access to Social." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    logWarn("social.image.upload.invalid_form_data", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
    });
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    logWarn("social.image.upload.missing_file", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
    });
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    logWarn("social.image.upload.invalid_mime_type", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      mime_type: file.type,
    });
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    logWarn("social.image.upload.file_too_large", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      size_bytes: file.size,
    });
    return NextResponse.json({ error: "Image exceeds 10MB limit" }, { status: 400 });
  }

  const canAccessPageResult = await supabase.rpc("can_access_social_page", {
    social_page_uuid: pageId,
  });

  if (canAccessPageResult.error) {
    logError("social.image.upload.social_page_access_check_error", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      error: canAccessPageResult.error,
    });
    return NextResponse.json({ error: canAccessPageResult.error.message }, { status: 500 });
  }

  if (!canAccessPageResult.data) {
    logWarn("social.image.upload.social_page_access_denied", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
    });
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
    logError("social.image.upload.storage_upload_error", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      storage_path: storagePath,
      error: uploadError,
    });
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage
    .from(SOCIAL_POST_IMAGES_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = String(publicUrlData.publicUrl || "").trim();
  if (!publicUrl) {
    logError("social.image.upload.public_url_missing", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      storage_path: storagePath,
    });
    return NextResponse.json({ error: "Unable to create image URL" }, { status: 500 });
  }

  logInfo("social.image.upload.success", {
    request_id: requestId,
    page_id: pageId,
    user_id: user.id,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: file.type,
  });

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
