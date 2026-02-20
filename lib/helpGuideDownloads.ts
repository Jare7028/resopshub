const LEGACY_HELP_DOWNLOADS_PREFIX = "/downloads/";
export const HELP_GUIDE_DOWNLOADS_API_PREFIX = "/api/help/downloads/";
export const HELP_GUIDE_DOWNLOADS_BUCKET = "help-guide-downloads";

const HELP_DOWNLOAD_CONTENT_TYPES: Record<string, string> = {
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePathSegment(value: string) {
  const normalized = safeDecode(String(value || "")).trim();
  if (!normalized || normalized === "." || normalized === "..") {
    return "";
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    return "";
  }
  return normalized;
}

function splitPath(value: string) {
  const pathOnly = String(value || "").split(/[?#]/, 1)[0] || "";
  return pathOnly
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function extractDownloadPathFromHref(href: string) {
  const normalized = String(href || "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith(LEGACY_HELP_DOWNLOADS_PREFIX)) {
    return normalized.slice(LEGACY_HELP_DOWNLOADS_PREFIX.length);
  }
  if (normalized.startsWith(HELP_GUIDE_DOWNLOADS_API_PREFIX)) {
    return normalized.slice(HELP_GUIDE_DOWNLOADS_API_PREFIX.length);
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith(LEGACY_HELP_DOWNLOADS_PREFIX)) {
      return parsed.pathname.slice(LEGACY_HELP_DOWNLOADS_PREFIX.length);
    }
    if (parsed.pathname.startsWith(HELP_GUIDE_DOWNLOADS_API_PREFIX)) {
      return parsed.pathname.slice(HELP_GUIDE_DOWNLOADS_API_PREFIX.length);
    }
  } catch {
    return "";
  }

  return "";
}

export function normalizeHelpDownloadPathFromSegments(segments: readonly string[]) {
  if (!segments.length) {
    return "";
  }
  const cleaned = segments
    .map((segment) => normalizePathSegment(segment))
    .filter(Boolean);
  if (!cleaned.length || cleaned.length !== segments.length) {
    return "";
  }
  return cleaned.join("/");
}

export function normalizeHelpDownloadPath(value: string) {
  return normalizeHelpDownloadPathFromSegments(splitPath(value));
}

export function buildHelpDownloadApiHref(storagePath: string) {
  const normalized = normalizeHelpDownloadPath(storagePath);
  if (!normalized) {
    return HELP_GUIDE_DOWNLOADS_API_PREFIX;
  }
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${HELP_GUIDE_DOWNLOADS_API_PREFIX}${encoded}`;
}

export function normalizeHelpGuideDownloadHref(href: string) {
  const normalizedHref = String(href || "").trim();
  if (!normalizedHref) {
    return "";
  }
  const downloadPath = extractDownloadPathFromHref(normalizedHref);
  if (!downloadPath) {
    return normalizedHref;
  }
  const normalizedPath = normalizeHelpDownloadPath(downloadPath);
  if (!normalizedPath) {
    return normalizedHref;
  }
  return buildHelpDownloadApiHref(normalizedPath);
}

export function guessHelpDownloadContentType(filename: string) {
  const normalized = String(filename || "").toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  const extension = dotIndex >= 0 ? normalized.slice(dotIndex) : "";
  return HELP_DOWNLOAD_CONTENT_TYPES[extension] || "application/octet-stream";
}

function encodeContentDispositionSegment(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildAttachmentContentDisposition(filename: string) {
  const fallback = "download";
  const normalized = String(filename || "").trim() || fallback;
  const asciiSafe = normalized.replace(/["\\]/g, "_") || fallback;
  const utf8Encoded = encodeContentDispositionSegment(normalized);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8Encoded}`;
}
