export type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

export type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type AssignmentGroupOption = {
  id: string;
  name: string;
  memberCount: number;
};

export type ConversationRow = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  created_by: string | null;
  created_at: string;
};

export type ConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  role: "owner" | "member";
  last_read_at: string | null;
  is_pinned: boolean | null;
  is_muted: boolean | null;
};

export type MessageLinkRow = {
  id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
  href: string;
};

export type MessageAttachmentRow = {
  id: string;
  message_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string | null;
};

export type MessageReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type OutgoingMessageLinkInput = {
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
};

export type OutgoingMessageAttachmentInput = {
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url?: string | null;
};

export type PendingMessagePayload = {
  body: string;
  links: OutgoingMessageLinkInput[];
  attachments: OutgoingMessageAttachmentInput[];
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  links: MessageLinkRow[];
  attachments: MessageAttachmentRow[];
  reactions: MessageReactionRow[];
  client_status?: "sending" | "failed";
  client_retry_payload?: PendingMessagePayload | null;
};

export type LatestPreview = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type ComposerDraftInsertRequest = {
  id: string;
  text?: string;
  reply_to_message_id?: string;
  reply_preview?: string;
};

export const CHAT_LINK_TYPE_LABELS: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Suggestion",
  note: "Note",
  client: "Client",
};

export function toMs(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortMessagesAsc(messages: MessageRow[]) {
  return [...messages].sort(
    (left, right) => toMs(left.created_at) - toMs(right.created_at)
  );
}

export function messageSyncCursor(messages: MessageRow[]) {
  let latestValue: string | null = null;
  let latestMs = 0;

  messages.forEach((message) => {
    [message.created_at, message.edited_at, message.deleted_at].forEach((value) => {
      const ms = toMs(value);
      if (ms > latestMs) {
        latestMs = ms;
        latestValue = value || null;
      }
    });
  });

  return latestValue;
}

export function mergeMessages(current: MessageRow[], incoming: MessageRow[]) {
  if (!incoming.length) return current;
  const byId = new Map<string, MessageRow>();
  current.forEach((message) => {
    byId.set(message.id, message);
  });
  incoming.forEach((message) => {
    byId.set(message.id, message);
  });
  return sortMessagesAsc(Array.from(byId.values()));
}

export function normalizeConversationMember(
  row: ConversationMemberRow
): ConversationMemberRow {
  return {
    ...row,
    is_pinned: Boolean(row.is_pinned),
    is_muted: Boolean(row.is_muted),
  };
}

export function getUserDisplayName(user: UserRow | null | undefined) {
  if (!user) return "Unknown user";
  return user.full_name || user.email || "Unknown user";
}

export function getInitials(label: string) {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export function getUserAvatarUrl(user: UserRow | null | undefined) {
  return String(user?.avatar_url || "").trim();
}

export function chatUrl(params: { c?: string }) {
  const sp = new URLSearchParams();
  if (params.c) sp.set("c", params.c);
  const qs = sp.toString();
  return qs ? `/chat?${qs}` : "/chat";
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatConversationTime(value: string | null | undefined) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isSameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  return isSameDay
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function renderPreviewText(message: LatestPreview | null) {
  if (!message) return "No messages yet";
  if (message.deleted_at) return "Message deleted";
  const body = parseReplyBody(String(message.body || "")).cleanBody.trim();
  if (body) return body;
  return "Attachment or link";
}

export function formatMessageDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function isSameCalendarDay(leftValue: string, rightValue: string) {
  const left = new Date(leftValue);
  const right = new Date(rightValue);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function parseReplyBody(rawBody: string): {
  replyToMessageId: string | null;
  cleanBody: string;
} {
  const body = String(rawBody || "");
  const match = body.match(/^\[\[reply:([0-9a-f-]{36})\]\]\s*\n?/i);
  if (!match) {
    return { replyToMessageId: null, cleanBody: body };
  }
  return {
    replyToMessageId: String(match[1] || "").toLowerCase(),
    cleanBody: body.slice(match[0].length),
  };
}

export function toMessageSnippet(message: MessageRow) {
  const compactBody = parseReplyBody(String(message.body || ""))
    .cleanBody.replace(/\s+/g, " ")
    .trim();
  const fallback = message.attachments.length
    ? "sent an attachment"
    : message.links.length
      ? "shared a link"
      : "sent a message";
  const preview = compactBody || fallback;
  return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
}

export function messageLinkHref(entityType: LinkEntityType, entityId: string) {
  if (entityType === "task") return `/tasks/${entityId}`;
  if (entityType === "project") return `/projects/${entityId}`;
  if (entityType === "feature_suggestion") {
    return `/feature-suggestions?open=${encodeURIComponent(entityId)}`;
  }
  if (entityType === "client") return `/clients/${entityId}`;
  return "/notes";
}
