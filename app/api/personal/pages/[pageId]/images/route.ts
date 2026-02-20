import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PERSONAL_NOTE_IMAGES_BUCKET = "personal-note-images";
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

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

async function canEditPersonalPage(
  supabase: SupabaseServerClient,
  page: { id: string; owner_id: string; section_id: string | null; share_mode: string | null },
  userId: string
) {
  if (page.owner_id === userId) {
    return true;
  }

  const { data: pageEditMember, error: pageMemberError } = await supabase
    .from("personal_page_members")
    .select("id")
    .eq("page_id", page.id)
    .eq("user_id", userId)
    .eq("role", "edit")
    .maybeSingle();

  if (pageMemberError) {
    throw new Error(pageMemberError.message);
  }

  if (page.share_mode === "custom") {
    return Boolean(pageEditMember);
  }

  if (page.share_mode === "inherit") {
    if (pageEditMember) {
      return true;
    }
    if (!page.section_id) {
      return false;
    }
    const { data: sectionEditMember, error: sectionMemberError } = await supabase
      .from("personal_section_members")
      .select("id")
      .eq("section_id", page.section_id)
      .eq("user_id", userId)
      .eq("role", "edit")
      .maybeSingle();

    if (sectionMemberError) {
      throw new Error(sectionMemberError.message);
    }

    return Boolean(sectionEditMember);
  }

  return false;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  const params = await context.params;
  const pageId = String(params.pageId || "").trim();
  if (!uuidRegex.test(pageId)) {
    return NextResponse.json({ error: "Invalid page id" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    console.error("[personal.image.debug] upload_missing_file", { pageId, userId: user.id });
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    console.error("[personal.image.debug] upload_invalid_type", {
      pageId,
      userId: user.id,
      type: file.type,
    });
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    console.error("[personal.image.debug] upload_file_too_large", {
      pageId,
      userId: user.id,
      size: file.size,
    });
    return NextResponse.json({ error: "Image exceeds 10MB limit" }, { status: 400 });
  }

  const { data: page, error: pageError } = await supabase
    .from("personal_pages")
    .select("id,owner_id,section_id,share_mode")
    .eq("id", pageId)
    .maybeSingle();

  if (pageError) {
    console.error("[personal.image.debug] upload_page_lookup_error", {
      pageId,
      userId: user.id,
      message: pageError.message,
    });
    return NextResponse.json({ error: pageError.message }, { status: 500 });
  }

  if (!page) {
    console.error("[personal.image.debug] upload_page_not_found", { pageId, userId: user.id });
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  let canEdit = false;
  try {
    canEdit = await canEditPersonalPage(
      supabase,
      {
        id: String(page.id),
        owner_id: String(page.owner_id),
        section_id: page.section_id ? String(page.section_id) : null,
        share_mode: page.share_mode ? String(page.share_mode) : null,
      },
      user.id
    );
  } catch (error) {
    console.error("[personal.image.debug] upload_permission_check_error", {
      pageId,
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to verify page permissions",
      },
      { status: 500 }
    );
  }

  if (!canEdit) {
    console.error("[personal.image.debug] upload_forbidden", { pageId, userId: user.id });
    return NextResponse.json({ error: "You do not have permission to edit this page" }, { status: 403 });
  }

  const extension = getExtension(file);
  const timestamp = Date.now();
  const random = randomBytes(5).toString("hex");
  const fileName = safeFilename(file.name || `image-${timestamp}.${extension}`);
  const storagePath = `${pageId}/${user.id}/${timestamp}-${random}-${fileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(PERSONAL_NOTE_IMAGES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.error("[personal.image.debug] upload_storage_error", {
      pageId,
      userId: user.id,
      storagePath,
      message: uploadError.message,
    });
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage
    .from(PERSONAL_NOTE_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  const publicUrl = String(publicUrlData.publicUrl || "").trim();
  if (!publicUrl) {
    console.error("[personal.image.debug] upload_public_url_missing", {
      pageId,
      userId: user.id,
      storagePath,
    });
    return NextResponse.json({ error: "Unable to create image URL" }, { status: 500 });
  }

  console.error("[personal.image.debug] upload_success", {
    pageId,
    userId: user.id,
    storagePath,
    publicUrl: publicUrl.slice(0, 180),
    sizeBytes: file.size,
    mimeType: file.type,
  });

  return NextResponse.json({
    image: {
      url: publicUrl,
      storagePath,
      filename: file.name || fileName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    },
  });
}
