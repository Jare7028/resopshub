import { extractPlainText } from "./tiptapText";

export const DEFAULT_TASK_NOTES_PREVIEW_MAX_CHARS = 260;

function normalizeTaskNotesText(value: string | null | undefined) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function truncateWithEllipsis(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return "…";
  }
  const truncated = value.slice(0, maxChars - 1).trimEnd();
  return `${truncated}…`;
}

export function buildTaskNotesPreview(args: {
  contentText?: string | null;
  content?: unknown;
  maxChars?: number;
}) {
  const rawMaxChars = Number(args.maxChars);
  const maxChars =
    Number.isFinite(rawMaxChars) && rawMaxChars > 0
      ? Math.floor(rawMaxChars)
      : DEFAULT_TASK_NOTES_PREVIEW_MAX_CHARS;

  const contentTextPreview = normalizeTaskNotesText(args.contentText);
  const rawPreview = contentTextPreview ?? normalizeTaskNotesText(extractPlainText(args.content));
  if (!rawPreview) {
    return null;
  }
  return truncateWithEllipsis(rawPreview, maxChars);
}
