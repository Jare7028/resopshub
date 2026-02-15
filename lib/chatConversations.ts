export type ChatConversationLike = {
  id: string;
  created_at: string;
};

export type ChatConversationActivityLike = {
  created_at: string;
} | null | undefined;

function toUnixMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortConversationsByRecentActivity<T extends ChatConversationLike>(
  conversations: readonly T[],
  latestByConversationId: Record<string, ChatConversationActivityLike>
) {
  return [...conversations].sort((left, right) => {
    const leftActivityAt =
      latestByConversationId[left.id]?.created_at || left.created_at;
    const rightActivityAt =
      latestByConversationId[right.id]?.created_at || right.created_at;
    return toUnixMs(rightActivityAt) - toUnixMs(leftActivityAt);
  });
}
