import { buildTiptapDocFromPlainText } from "./outlookTaskImport";

export const BROWSER_CAPTURE_MAX_TEXT_BYTES = 1024 * 1024;
export const BROWSER_CAPTURE_DEFAULT_TITLE = "Captured task";
export const BROWSER_CAPTURE_MAX_TITLE_LENGTH = 240;

export type BrowserTaskCaptureCreateRequest = {
  selectedText: string;
  title?: string | null;
  assigneeUserId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
};

export type BrowserTaskCaptureCreateResponse = {
  taskId: string;
  taskHref: string;
};

type ParsedBrowserTaskCaptureCreateRequest = {
  selectedText: string;
  title: string;
  assigneeUserId: string | null;
  clientId: string | null;
  projectId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
};

export class BrowserTaskCaptureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTaskCaptureValidationError";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNormalizedString(value: unknown, limit = 4000) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit);
}

function normalizeOptionalString(value: unknown, limit = 4000) {
  const normalized = toNormalizedString(value, limit);
  return normalized || null;
}

function assertDate(value: string | null, fieldLabel: string) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BrowserTaskCaptureValidationError(
      `${fieldLabel} must use YYYY-MM-DD format.`
    );
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    throw new BrowserTaskCaptureValidationError(`${fieldLabel} is not a valid date.`);
  }
}

function normalizeDueTime(value: string | null) {
  if (!value) return null;
  const raw = value.trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw new BrowserTaskCaptureValidationError(
      "dueTime must use HH:mm or HH:mm:ss format."
    );
  }
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function normalizeSelectedText(value: unknown) {
  const normalized = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .trim();

  if (!normalized) {
    throw new BrowserTaskCaptureValidationError("selectedText is required.");
  }

  const bytes = new TextEncoder().encode(normalized).length;
  if (bytes > BROWSER_CAPTURE_MAX_TEXT_BYTES) {
    throw new BrowserTaskCaptureValidationError(
      `selectedText is too large. Maximum is ${BROWSER_CAPTURE_MAX_TEXT_BYTES} bytes.`
    );
  }

  return normalized;
}

function normalizeSourceUrl(value: unknown) {
  const normalized = normalizeOptionalString(value, 2048);
  if (!normalized) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BrowserTaskCaptureValidationError("sourceUrl must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BrowserTaskCaptureValidationError("sourceUrl must use http or https.");
  }
  return parsed.toString();
}

function deriveTitleFromSelectedText(selectedText: string) {
  const firstLine = selectedText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const normalized = toNormalizedString(firstLine || "", BROWSER_CAPTURE_MAX_TITLE_LENGTH);
  return normalized || BROWSER_CAPTURE_DEFAULT_TITLE;
}

export function normalizeBrowserCaptureTitle(rawTitle: unknown, selectedText: string) {
  const explicitTitle = toNormalizedString(rawTitle, BROWSER_CAPTURE_MAX_TITLE_LENGTH);
  if (explicitTitle) {
    return explicitTitle;
  }
  return deriveTitleFromSelectedText(selectedText);
}

export function parseBrowserTaskCaptureCreateRequest(
  input: unknown
): ParsedBrowserTaskCaptureCreateRequest {
  if (!isObjectRecord(input)) {
    throw new BrowserTaskCaptureValidationError("Request body must be a JSON object.");
  }

  const selectedText = normalizeSelectedText(input.selectedText);
  const title = normalizeBrowserCaptureTitle(input.title, selectedText);
  const assigneeUserId = normalizeOptionalString(input.assigneeUserId, 120);
  const clientId = normalizeOptionalString(input.clientId, 120);
  const projectId = normalizeOptionalString(input.projectId, 120);
  const dueDate = normalizeOptionalString(input.dueDate, 20);
  const dueTime = normalizeDueTime(normalizeOptionalString(input.dueTime, 20));
  const sourceUrl = normalizeSourceUrl(input.sourceUrl);
  const sourceTitle = normalizeOptionalString(input.sourceTitle, 1000);

  assertDate(dueDate, "dueDate");
  if (dueTime && !dueDate) {
    throw new BrowserTaskCaptureValidationError(
      "dueDate is required when dueTime is provided."
    );
  }

  return {
    selectedText,
    title,
    assigneeUserId,
    clientId,
    projectId,
    dueDate,
    dueTime,
    sourceUrl,
    sourceTitle,
  };
}

export function buildBrowserCaptureNotesText(args: {
  selectedText: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  capturedAtIso: string;
}) {
  const lines: string[] = [];
  lines.push("Source: Browser text capture");
  lines.push(`Captured at: ${args.capturedAtIso}`);

  if (args.sourceTitle) {
    lines.push(`Page title: ${args.sourceTitle}`);
  }
  if (args.sourceUrl) {
    lines.push(`Page URL: ${args.sourceUrl}`);
  }

  lines.push("");
  lines.push("Selected text:");
  lines.push(args.selectedText);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildBrowserCaptureTaskContent(args: {
  selectedText: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  capturedAtIso: string;
}) {
  return buildTiptapDocFromPlainText(buildBrowserCaptureNotesText(args));
}

