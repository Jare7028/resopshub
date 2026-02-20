import { randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NOTE_IMAGES_BUCKET = "note-images";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_UPLOAD_TIMEOUT_MS = 2500;

export type NoteImagePersistenceScope =
  | "client_note"
  | "task_note"
  | "help_guide";

export type NormalizeAndPersistNoteImagesInput = {
  content: unknown;
  scope: NoteImagePersistenceScope;
  entityId: string;
  userId: string | null | undefined;
  supabase: ReturnType<typeof createSupabaseServerClient>;
};

export type NormalizeAndPersistNoteImagesResult = {
  content: unknown;
  warnings: string[];
};

type ParsedDataImage = {
  mimeType: string;
  bytes: Uint8Array;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasImagesRequiringNormalization(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasImagesRequiringNormalization(item));
  }

  if (!isObjectRecord(value)) {
    return false;
  }

  const nodeType = String(value.type || "")
    .trim()
    .toLowerCase();
  if (nodeType.includes("image") && isObjectRecord(value.attrs)) {
    const src = normalizeText((value.attrs as Record<string, unknown>).src);
    if (!src) {
      return true;
    }
    if (isHttpUrl(src) || isRelativeUrl(src) || isNoteImagesStorageUrl(src)) {
      return false;
    }
    return true;
  }

  return Object.values(value).some((entry) => hasImagesRequiringNormalization(entry));
}

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeText(value: unknown, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function sanitizePathSegment(value: unknown, fallback: string, maxLength = 120) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, maxLength);
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isRelativeUrl(value: string) {
  return /^\//.test(value);
}

function isNoteImagesStorageUrl(value: string) {
  return /\/storage\/v1\/object\/(?:public|sign)\/note-images\//i.test(value);
}

function mimeToExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "image/tiff") return "tiff";
  if (normalized === "image/svg+xml") return "svg";
  return "bin";
}

function parseDataImage(src: string): ParsedDataImage | null {
  const match = src.match(/^data:([^;,]+)(;[^,]*)?,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const mimeType = String(match[1] || "").trim().toLowerCase();
  const metadata = String(match[2] || "").toLowerCase();
  const payload = String(match[3] || "");
  if (!mimeType.startsWith("image/")) {
    return null;
  }

  try {
    if (metadata.includes(";base64")) {
      const base64Payload = payload.replace(/\s+/g, "");
      const bytes = Buffer.from(base64Payload, "base64");
      if (!bytes.length) return null;
      return { mimeType, bytes };
    }

    const decoded = decodeURIComponent(payload);
    const bytes = Buffer.from(decoded, "binary");
    if (!bytes.length) return null;
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

async function uploadImageBytes(input: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
  scope: NoteImagePersistenceScope;
  entityId: string;
  bytes: Uint8Array;
  mimeType: string;
}) {
  const extension = mimeToExtension(input.mimeType);
  const timestamp = Date.now();
  const random = randomBytes(6).toString("hex");
  const storagePath = [
    sanitizePathSegment(input.userId, "user", 80),
    sanitizePathSegment(input.scope, "scope", 40),
    sanitizePathSegment(input.entityId, "entity", 140),
    `${timestamp}-${random}.${extension}`,
  ].join("/");

  const { error: uploadError } = await input.supabase.storage
    .from(NOTE_IMAGES_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return { url: "", error: uploadError.message };
  }

  const { data } = input.supabase.storage.from(NOTE_IMAGES_BUCKET).getPublicUrl(storagePath);
  const url = String(data.publicUrl || "").trim();
  if (!url) {
    return { url: "", error: "Upload succeeded but no public URL was generated." };
  }

  return { url, error: "" };
}

async function uploadImageBytesWithTimeout(input: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
  scope: NoteImagePersistenceScope;
  entityId: string;
  bytes: Uint8Array;
  mimeType: string;
}) {
  const uploadPromise = uploadImageBytes(input);
  const timeoutPromise = new Promise<{ url: string; error: string }>((resolve) => {
    setTimeout(() => {
      resolve({ url: "", error: "upload timeout" });
    }, IMAGE_UPLOAD_TIMEOUT_MS);
  });
  return Promise.race([uploadPromise, timeoutPromise]);
}

export async function normalizeAndPersistNoteImages(
  input: NormalizeAndPersistNoteImagesInput
): Promise<NormalizeAndPersistNoteImagesResult> {
  if (!hasImagesRequiringNormalization(input.content)) {
    return {
      content: input.content,
      warnings: [],
    };
  }

  const warnings = new Set<string>();
  const uploadCache = new Map<string, string>();
  const normalizedContent = cloneJson(input.content);
  const normalizedUserId = normalizeText(input.userId);

  const addWarning = (message: string) => {
    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage) return;
    warnings.add(normalizedMessage);
  };

  const processImageSrc = async (srcValue: unknown) => {
    const src = normalizeText(srcValue);
    if (!src) {
      addWarning("One image has an empty source and was saved unchanged.");
      return srcValue;
    }

    if (uploadCache.has(src)) {
      return uploadCache.get(src) || src;
    }

    if (isHttpUrl(src) || isRelativeUrl(src) || isNoteImagesStorageUrl(src)) {
      uploadCache.set(src, src);
      return src;
    }

    if (src.startsWith("blob:")) {
      addWarning("One image could not be persisted from a blob URL and was kept as-is.");
      uploadCache.set(src, src);
      return src;
    }

    if (!src.startsWith("data:")) {
      addWarning("One image has an unsupported source URL and was kept unchanged.");
      uploadCache.set(src, src);
      return src;
    }

    const parsed = parseDataImage(src);
    if (!parsed) {
      addWarning("One embedded image could not be decoded and was saved unchanged.");
      uploadCache.set(src, src);
      return src;
    }

    if (!normalizedUserId) {
      addWarning("Image upload requires a signed-in user. Embedded image was saved unchanged.");
      uploadCache.set(src, src);
      return src;
    }

    if (parsed.bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
      addWarning("One image exceeded 10MB and was saved unchanged.");
      uploadCache.set(src, src);
      return src;
    }

    const upload = await uploadImageBytesWithTimeout({
      supabase: input.supabase,
      userId: normalizedUserId,
      scope: input.scope,
      entityId: input.entityId,
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
    });

    if (upload.error || !upload.url) {
      addWarning(`Image upload failed (${upload.error || "unknown error"}). Embedded image was kept.`);
      uploadCache.set(src, src);
      return src;
    }

    uploadCache.set(src, upload.url);
    return upload.url;
  };

  const traverse = async (value: unknown): Promise<void> => {
    if (Array.isArray(value)) {
      for (const item of value) {
        await traverse(item);
      }
      return;
    }

    if (!isObjectRecord(value)) {
      return;
    }

    const nodeType = String(value.type || "")
      .trim()
      .toLowerCase();
    if (nodeType.includes("image") && isObjectRecord(value.attrs)) {
      const attrs = value.attrs as Record<string, unknown>;
      attrs.src = await processImageSrc(attrs.src);
    }

    const entries = Object.values(value);
    for (const entry of entries) {
      await traverse(entry);
    }
  };

  await traverse(normalizedContent);

  return {
    content: normalizedContent,
    warnings: Array.from(warnings),
  };
}
