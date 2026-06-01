import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  safeUploadImageFilename,
  validateUploadImageFile,
} from "@/lib/imageUploadValidation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";

const SOCIAL_POST_IMAGES_BUCKET = "social-post-images";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const validation = validateUploadImageFile(file, { maxSizeBytes: MAX_IMAGE_SIZE_BYTES });
  if (!validation.ok) {
    logWarn("social.image.upload.unsupported_mime_type", {
      request_id: requestId,
      page_id: pageId,
      user_id: user.id,
      mime_type: file.type,
      size_bytes: file.size,
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
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

  const userByAuthIdResult = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (userByAuthIdResult.error) {
    logError("social.image.upload.lookup_by_auth_id_error", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: user.id,
      error: userByAuthIdResult.error,
    });
    return NextResponse.json({ error: "Could not verify user profile" }, { status: 500 });
  }

  const userByEmailResult =
    !userByAuthIdResult.data && user.email
      ? await supabase
          .from("users")
          .select("id")
          .eq("email", user.email)
          .maybeSingle()
      : null;
  if (userByEmailResult?.error) {
    logError("social.image.upload.lookup_by_email_error", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: user.id,
      auth_email: user.email,
      error: userByEmailResult.error,
    });
    return NextResponse.json({ error: "Could not verify user profile" }, { status: 500 });
  }

  const appUserId = String(userByAuthIdResult.data?.id || userByEmailResult?.data?.id || "").trim();
  if (!appUserId) {
    logWarn("social.image.upload.user_profile_missing", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: user.id,
      auth_email: user.email,
    });
    return NextResponse.json({ error: "Missing user profile" }, { status: 404 });
  }

  const timestamp = Date.now();
  const random = randomBytes(5).toString("hex");
  const fileName = safeUploadImageFilename(file.name, validation.extension, `image-${timestamp}`);
  const storagePath = `${pageId}/${appUserId}/${timestamp}-${random}-${fileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(SOCIAL_POST_IMAGES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: validation.mimeType,
      upsert: false,
    });

  if (uploadError) {
    logError("social.image.upload.storage_upload_error", {
      request_id: requestId,
      page_id: pageId,
      user_id: appUserId,
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
      user_id: appUserId,
      storage_path: storagePath,
    });
    return NextResponse.json({ error: "Unable to create image URL" }, { status: 500 });
  }

  logInfo("social.image.upload.success", {
    request_id: requestId,
    page_id: pageId,
    user_id: appUserId,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: file.type,
  });

  return NextResponse.json({
    image: {
      storage_path: storagePath,
      url: publicUrl,
      filename: file.name || fileName,
      mime_type: validation.mimeType,
      size_bytes: file.size,
    },
  });
}
