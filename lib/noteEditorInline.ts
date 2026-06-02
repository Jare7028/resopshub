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

export function getTaskHoverPosition(
  anchorRect: { left: number; bottom: number },
  viewport: { width: number; height: number },
  options: {
    margin?: number;
    offsetY?: number;
    popoverWidth?: number;
    estimatedPopoverHeight?: number;
  } = {}
) {
  const margin = options.margin ?? 12;
  const offsetY = options.offsetY ?? 8;
  const popoverWidth = options.popoverWidth ?? 300;
  const estimatedPopoverHeight = options.estimatedPopoverHeight ?? 170;
  const maxX = viewport.width - popoverWidth - margin;
  const maxY = viewport.height - estimatedPopoverHeight;

  return {
    x: Math.max(margin, Math.min(maxX, anchorRect.left)),
    y: Math.max(margin, Math.min(maxY, anchorRect.bottom + offsetY)),
  };
}
