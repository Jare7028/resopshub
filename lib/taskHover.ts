export function getTaskHoverFetchUrl(taskId: string) {
  return `/api/tasks/${encodeURIComponent(String(taskId || "").trim())}/hover`;
}

export function normalizeTaskHoverNotesPreview(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}
