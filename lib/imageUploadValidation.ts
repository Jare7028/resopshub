export const ALLOWED_UPLOAD_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export const ALLOWED_UPLOAD_IMAGE_TYPE_LABEL = "PNG, JPEG, WebP, GIF, or AVIF";
export const ALLOWED_UPLOAD_IMAGE_ACCEPT = Array.from(ALLOWED_UPLOAD_IMAGE_MIME_TYPES).join(",");

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export type ImageUploadValidationResult =
  | {
      ok: true;
      extension: string;
      mimeType: string;
    }
  | {
      ok: false;
      error: string;
    };

export function getAllowedImageExtensionFromMimeType(mimeType: string) {
  return MIME_EXTENSION_MAP[String(mimeType || "").trim().toLowerCase()] || null;
}

export function isAllowedUploadImageMimeType(mimeType: string) {
  return ALLOWED_UPLOAD_IMAGE_MIME_TYPES.has(String(mimeType || "").trim().toLowerCase());
}

export function validateUploadImageFile(
  file: File,
  options: { maxSizeBytes: number }
): ImageUploadValidationResult {
  const mimeType = String(file.type || "").trim().toLowerCase();
  const extension = getAllowedImageExtensionFromMimeType(mimeType);

  if (!extension) {
    return {
      ok: false,
      error: `Unsupported image type. Use ${ALLOWED_UPLOAD_IMAGE_TYPE_LABEL}.`,
    };
  }

  if (file.size > options.maxSizeBytes) {
    const limitMb = Math.floor(options.maxSizeBytes / (1024 * 1024));
    return {
      ok: false,
      error: `Image exceeds ${limitMb}MB limit`,
    };
  }

  return { ok: true, extension, mimeType };
}

export function safeUploadImageFilename(
  name: string,
  extension: string,
  fallbackBaseName = "image"
) {
  const rawName = String(name || "").trim();
  const withoutExtension = rawName.replace(/\.[a-zA-Z0-9]+$/, "");
  const baseName = (withoutExtension || fallbackBaseName)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
  return `${baseName || fallbackBaseName}.${extension}`;
}
