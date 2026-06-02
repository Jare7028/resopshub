import {
  ALLOWED_UPLOAD_IMAGE_TYPE_LABEL,
  getAllowedImageExtensionFromMimeType,
  isAllowedUploadImageMimeType,
} from "./imageUploadValidation";
import { normalizePastedLink } from "./noteEditorInline";

export const MAX_INLINE_IMAGE_BYTES = 1_800_000;
export const MAX_INLINE_IMAGE_DATA_URL_BYTES = 2_600_000;
export const MAX_INLINE_IMAGE_DIMENSION = 1800;
export const MIN_INLINE_IMAGE_DIMENSION = 640;
export const IMAGE_COMPRESSION_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58] as const;

function getDomParser() {
  if (typeof window !== "undefined" && window.DOMParser) {
    return window.DOMParser;
  }
  if (typeof DOMParser !== "undefined") {
    return DOMParser;
  }
  return null;
}

export function getImageExtensionFromMimeType(mimeType: string) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  return getAllowedImageExtensionFromMimeType(normalized) || "png";
}

export function createImageFileFromBlob(blob: Blob, baseName = "pasted-image") {
  const normalizedMimeType = String(blob.type || "").toLowerCase();
  if (!isAllowedUploadImageMimeType(normalizedMimeType)) {
    throw new Error(`Unsupported image type. Use ${ALLOWED_UPLOAD_IMAGE_TYPE_LABEL}.`);
  }
  const extension = getImageExtensionFromMimeType(normalizedMimeType);
  return new File([blob], `${baseName}.${extension}`, {
    type: normalizedMimeType,
    lastModified: Date.now(),
  });
}

export function extractImageSourcesFromHtml(htmlValue: string) {
  const html = String(htmlValue || "").trim();
  const Parser = getDomParser();
  if (!html || !Parser) {
    return [] as string[];
  }
  try {
    const document = new Parser().parseFromString(html, "text/html");
    const sources = Array.from(document.querySelectorAll("img[src]"))
      .map((node) => String(node.getAttribute("src") || "").trim())
      .filter(Boolean);
    return Array.from(new Set(sources));
  } catch {
    return [] as string[];
  }
}

export function extractSingleLinkFromHtml(htmlValue: string) {
  const html = String(htmlValue || "").trim();
  const Parser = getDomParser();
  if (!html || !Parser) {
    return null;
  }
  try {
    const document = new Parser().parseFromString(html, "text/html");
    const links = Array.from(document.querySelectorAll("a[href]"));
    if (links.length !== 1) {
      return null;
    }
    const link = links[0];
    const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
    const bodyText = normalizeText(document.body.textContent || "");
    const linkText = normalizeText(link.textContent || "");
    if (bodyText && linkText && bodyText !== linkText) {
      return null;
    }
    return normalizePastedLink(String(link.getAttribute("href") || "").trim());
  } catch {
    return null;
  }
}

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Unable to read image data"));
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read image data"));
    reader.readAsDataURL(blob);
  });
}

export function assertDataUrlSize(dataUrl: string, maxBytes: number) {
  const normalized = String(dataUrl || "");
  if (!normalized) {
    throw new Error("Unable to read image data");
  }
  const byteSize = new Blob([normalized]).size;
  if (byteSize > maxBytes) {
    throw new Error("Image is too large. Try a smaller image.");
  }
}

export function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image"));
    image.src = src;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      type,
      typeof quality === "number" ? quality : undefined
    );
  });
}
