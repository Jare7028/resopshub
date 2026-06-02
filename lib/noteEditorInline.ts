export function parseTimestampMs(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePastedLink(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/[^\s]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function normalizeMentionHandle(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._@-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized.length >= 2 ? normalized : "";
}

export function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeTaskStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "To Do";
  }
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function extractTaskIdFromHref(href: string) {
  const match = href.match(/^\/tasks\/([a-z0-9-]+)/i);
  return match?.[1] || null;
}
