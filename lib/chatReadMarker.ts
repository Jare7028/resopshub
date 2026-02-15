export function resolveConversationReadAt(
  latestMessageCreatedAt: string | null | undefined,
  now: Date = new Date()
) {
  const latest = String(latestMessageCreatedAt || "").trim();
  if (latest) {
    const latestMs = Date.parse(latest);
    if (Number.isFinite(latestMs)) {
      return latest;
    }
  }

  if (Number.isFinite(now.getTime())) {
    return now.toISOString();
  }

  return new Date().toISOString();
}
