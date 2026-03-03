"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmojiPickerButton from "@/app/(app)/_components/EmojiPickerButton";
import MentionTextarea from "@/app/(app)/_components/MentionTextarea";
import { sortConversationsByRecentActivity } from "@/lib/chatConversations";
import { encodeAssignmentTarget } from "@/lib/assignmentTargets";
import ChatComposer from "./ChatComposer";

type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type AssignmentGroupOption = {
  id: string;
  name: string;
  memberCount: number;
};

type ConversationRow = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  created_by: string | null;
  created_at: string;
};

type ConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  role: "owner" | "member";
  last_read_at: string | null;
  is_pinned: boolean | null;
  is_muted: boolean | null;
};

type MessageLinkRow = {
  id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
  href: string;
};

type MessageAttachmentRow = {
  id: string;
  message_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string | null;
};

type MessageReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type OutgoingMessageLinkInput = {
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
};

type OutgoingMessageAttachmentInput = {
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url?: string | null;
};

type PendingMessagePayload = {
  body: string;
  links: OutgoingMessageLinkInput[];
  attachments: OutgoingMessageAttachmentInput[];
};

type MessageRow = {
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

type MessageReadReceipt = {
  userId: string;
  name: string;
  avatarUrl: string;
  hasRead: boolean;
  lastReadAt: string | null;
};

type LatestPreview = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type ComposerDraftInsertRequest = {
  id: string;
  text?: string;
  reply_to_message_id?: string;
  reply_preview?: string;
};

const typeLabel: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Suggestion",
  note: "Note",
  client: "Client",
};

function toMs(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortMessagesAsc(messages: MessageRow[]) {
  return [...messages].sort((left, right) => toMs(left.created_at) - toMs(right.created_at));
}

function mergeMessages(current: MessageRow[], incoming: MessageRow[]) {
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

function normalizeConversationMember(row: ConversationMemberRow): ConversationMemberRow {
  return {
    ...row,
    is_pinned: Boolean(row.is_pinned),
    is_muted: Boolean(row.is_muted),
  };
}

function getUserDisplayName(user: UserRow | null | undefined) {
  if (!user) return "Unknown user";
  return user.full_name || user.email || "Unknown user";
}

function getInitials(label: string) {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

function getUserAvatarUrl(user: UserRow | null | undefined) {
  return String(user?.avatar_url || "").trim();
}

function chatUrl(params: { c?: string }) {
  const sp = new URLSearchParams();
  if (params.c) sp.set("c", params.c);
  const qs = sp.toString();
  return qs ? `/chat?${qs}` : "/chat";
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatConversationTime(value: string | null | undefined) {
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

function renderPreviewText(message: LatestPreview | null) {
  if (!message) return "No messages yet";
  if (message.deleted_at) return "Message deleted";
  const body = parseReplyBody(String(message.body || "")).cleanBody.trim();
  if (body) return body;
  return "Attachment or link";
}

function formatMessageDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isSameCalendarDay(leftValue: string, rightValue: string) {
  const left = new Date(leftValue);
  const right = new Date(rightValue);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function parseReplyBody(rawBody: string): {
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

function toMessageSnippet(message: MessageRow) {
  const compactBody = parseReplyBody(String(message.body || "")).cleanBody.replace(/\s+/g, " ").trim();
  const fallback = message.attachments.length
    ? "sent an attachment"
    : message.links.length
      ? "shared a link"
      : "sent a message";
  const preview = compactBody || fallback;
  return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
}

function messageLinkHref(entityType: LinkEntityType, entityId: string) {
  if (entityType === "task") return `/tasks/${entityId}`;
  if (entityType === "project") return `/projects/${entityId}`;
  if (entityType === "feature_suggestion") {
    return `/feature-suggestions?open=${encodeURIComponent(entityId)}`;
  }
  if (entityType === "client") return `/clients/${entityId}`;
  return "/notes";
}

export default function ChatPageClient(props: {
  currentUserId: string;
  users: UserRow[];
  groups: AssignmentGroupOption[];
  initialConversations: ConversationRow[];
  initialMembers: ConversationMemberRow[];
  initialSelectedConversationId: string | null;
  initialMessages: MessageRow[];
  initialLatestByConversationId: Record<string, LatestPreview | null>;
  initialUnreadByConversationId: Record<string, number>;
}) {
  const {
    currentUserId,
    users,
    groups,
    initialConversations,
    initialMembers,
    initialSelectedConversationId,
    initialMessages,
    initialLatestByConversationId,
    initialUnreadByConversationId,
  } = props;

  const [conversations, setConversations] = useState(initialConversations);
  const [members, setMembers] = useState(() =>
    initialMembers.map((row) => normalizeConversationMember(row))
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialSelectedConversationId
  );
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, MessageRow[]>>(
    initialSelectedConversationId
      ? { [initialSelectedConversationId]: sortMessagesAsc(initialMessages) }
      : {}
  );
  const [latestByConversationId, setLatestByConversationId] = useState(initialLatestByConversationId);
  const [unreadByConversationId, setUnreadByConversationId] = useState(
    initialUnreadByConversationId
  );
  const [unreadAnchorByConversationId, setUnreadAnchorByConversationId] = useState<
    Record<string, string | null>
  >({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isCreatingDirect, setIsCreatingDirect] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isSavingConversationPrefsById, setIsSavingConversationPrefsById] = useState<
    Record<string, boolean>
  >({});
  const [isConversationSettingsOpen, setIsConversationSettingsOpen] = useState(false);
  const [isEditUsersOpen, setIsEditUsersOpen] = useState(false);
  const [isUpdatingConversationMembers, setIsUpdatingConversationMembers] = useState(false);
  const [memberDraftUserId, setMemberDraftUserId] = useState("");
  const [memberEditorError, setMemberEditorError] = useState("");
  const [memberEditorSuccess, setMemberEditorSuccess] = useState("");

  const [searchChats, setSearchChats] = useState("");
  const [addMode, setAddMode] = useState<"direct" | "group">("direct");
  const [directTargetUserId, setDirectTargetUserId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingReplyToMessageId, setEditingReplyToMessageId] = useState<string | null>(null);
  const [seenByMessageId, setSeenByMessageId] = useState<string | null>(null);
  const [composerInsertRequest, setComposerInsertRequest] =
    useState<ComposerDraftInsertRequest | null>(null);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const initialPositionConversationIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const userById = useMemo(
    () =>
      users.reduce<Record<string, UserRow>>((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {}),
    [users]
  );

  const membersByConversationId = useMemo(
    () =>
      members.reduce<Record<string, ConversationMemberRow[]>>((acc, row) => {
        acc[row.conversation_id] ||= [];
        acc[row.conversation_id].push(row);
        return acc;
      }, {}),
    [members]
  );

  const myMembershipByConversationId = useMemo(() => {
    return members.reduce<Record<string, ConversationMemberRow>>((acc, row) => {
      if (row.user_id === currentUserId) {
        acc[row.conversation_id] = row;
      }
      return acc;
    }, {});
  }, [currentUserId, members]);

  const conversationsByRecentActivity = useMemo(
    () => sortConversationsByRecentActivity(conversations, latestByConversationId),
    [conversations, latestByConversationId]
  );

  const conversationsByPriority = useMemo(() => {
    const pinnedUnmuted: ConversationRow[] = [];
    const pinnedMuted: ConversationRow[] = [];
    const regularUnmuted: ConversationRow[] = [];
    const regularMuted: ConversationRow[] = [];

    conversationsByRecentActivity.forEach((conversation) => {
      const myMembership = myMembershipByConversationId[conversation.id];
      const isPinned = Boolean(myMembership?.is_pinned);
      const isMuted = Boolean(myMembership?.is_muted);
      if (isPinned) {
        if (isMuted) {
          pinnedMuted.push(conversation);
        } else {
          pinnedUnmuted.push(conversation);
        }
        return;
      }
      if (isMuted) {
        regularMuted.push(conversation);
      } else {
        regularUnmuted.push(conversation);
      }
    });

    return [...pinnedUnmuted, ...pinnedMuted, ...regularUnmuted, ...regularMuted];
  }, [conversationsByRecentActivity, myMembershipByConversationId]);

  const selectedMessages = useMemo(() => {
    if (!selectedConversationId) return [];
    return messagesByConversation[selectedConversationId] || [];
  }, [messagesByConversation, selectedConversationId]);

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return (
      conversationsByPriority.find(
        (conversation) => conversation.id === selectedConversationId
      ) || null
    );
  }, [conversationsByPriority, selectedConversationId]);

  const searchableConversationTextById = useMemo(() => {
    return conversationsByPriority.reduce<Record<string, string>>((acc, conversation) => {
      const title =
        conversation.type === "group"
          ? conversation.title || "Untitled group"
          : (() => {
              const rowMembers = membersByConversationId[conversation.id] || [];
              const other = rowMembers.find((member) => member.user_id !== currentUserId);
              return getUserDisplayName(userById[other?.user_id || ""]);
            })();
      const latest = latestByConversationId[conversation.id];
      const latestSender = latest ? getUserDisplayName(userById[latest.sender_id]) : "";
      const latestBody = latest ? renderPreviewText(latest) : "";
      acc[conversation.id] = `${title} ${latestSender} ${latestBody}`.toLowerCase();
      return acc;
    }, {});
  }, [
    conversationsByPriority,
    currentUserId,
    latestByConversationId,
    membersByConversationId,
    userById,
  ]);

  const filteredConversations = useMemo(() => {
    const term = searchChats.trim().toLowerCase();
    if (!term) return conversationsByPriority;
    return conversationsByPriority.filter((conversation) =>
      (searchableConversationTextById[conversation.id] || "").includes(term)
    );
  }, [conversationsByPriority, searchChats, searchableConversationTextById]);

  const existingDirectConversationIdByUserId = useMemo(() => {
    return conversationsByRecentActivity.reduce<Record<string, string>>((acc, conversation) => {
      if (conversation.type !== "direct") {
        return acc;
      }
      const rowMembers = membersByConversationId[conversation.id] || [];
      const otherMember = rowMembers.find((member) => member.user_id !== currentUserId);
      const otherUserId = String(otherMember?.user_id || "").trim();
      if (!otherUserId || acc[otherUserId]) {
        return acc;
      }
      acc[otherUserId] = conversation.id;
      return acc;
    }, {});
  }, [conversationsByRecentActivity, currentUserId, membersByConversationId]);

  const selectedDirectExistingConversationId = directTargetUserId
    ? existingDirectConversationIdByUserId[directTargetUserId] || null
    : null;

  const selectedConversationMembers = useMemo(() => {
    if (!selectedConversationId) return [];
    return membersByConversationId[selectedConversationId] || [];
  }, [membersByConversationId, selectedConversationId]);

  const selectedConversationMembership = useMemo(() => {
    if (!selectedConversationId) return null;
    return myMembershipByConversationId[selectedConversationId] || null;
  }, [myMembershipByConversationId, selectedConversationId]);

  const selectedConversationIsGroup = selectedConversation?.type === "group";
  const canManageSelectedConversationMembers =
    selectedConversationIsGroup && selectedConversationMembership?.role === "owner";

  const selectedConversationMemberUserIds = useMemo(
    () => new Set(selectedConversationMembers.map((member) => member.user_id)),
    [selectedConversationMembers]
  );

  const addableUsersForSelectedConversation = useMemo(() => {
    if (!selectedConversationId || !selectedConversationIsGroup) return [];
    return users.filter((user) => !selectedConversationMemberUserIds.has(user.id));
  }, [
    selectedConversationId,
    selectedConversationIsGroup,
    selectedConversationMemberUserIds,
    users,
  ]);

  const groupTargetOptions = useMemo(
    () =>
      groups
        .map((group) => ({
          value: encodeAssignmentTarget("group", group.id),
          label: `${group.name} (${group.memberCount} members)`,
        }))
        .filter((group) => group.value),
    [groups]
  );

  const selectedMessagesById = useMemo(() => {
    return selectedMessages.reduce<Record<string, MessageRow>>((acc, message) => {
      acc[message.id] = message;
      return acc;
    }, {});
  }, [selectedMessages]);

  const firstUnreadMessageId = useMemo(() => {
    if (!selectedConversationId) return null;
    const anchorValue = unreadAnchorByConversationId[selectedConversationId] || null;
    if (!anchorValue) return null;
    const anchorMs = toMs(anchorValue);
    const firstUnread = selectedMessages.find(
      (message) =>
        !message.deleted_at &&
        message.sender_id !== currentUserId &&
        toMs(message.created_at) > anchorMs
    );
    return firstUnread?.id || null;
  }, [
    currentUserId,
    selectedConversationId,
    selectedMessages,
    unreadAnchorByConversationId,
  ]);

  const readReceiptsByMessageId = useMemo(() => {
    if (!selectedConversationId) {
      return {} as Record<string, MessageReadReceipt[]>;
    }

    const rows = membersByConversationId[selectedConversationId] || [];
    const result: Record<string, MessageReadReceipt[]> = {};

    selectedMessages.forEach((message) => {
      if (message.sender_id !== currentUserId || message.deleted_at || message.client_status) {
        return;
      }
      const createdMs = toMs(message.created_at);
      if (!createdMs) {
        return;
      }

      const receipts = rows
        .filter((member) => member.user_id !== message.sender_id)
        .map((member) => {
          const memberLastReadAt = member.last_read_at;
          const memberLastReadMs = toMs(memberLastReadAt);
          const user = userById[member.user_id] || null;
          return {
            userId: member.user_id,
            name: getUserDisplayName(user),
            avatarUrl: getUserAvatarUrl(user),
            hasRead: memberLastReadMs >= createdMs,
            lastReadAt: memberLastReadAt,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      result[message.id] = receipts;
    });

    return result;
  }, [
    currentUserId,
    membersByConversationId,
    selectedConversationId,
    selectedMessages,
    userById,
  ]);

  const seenByMessage = seenByMessageId ? selectedMessagesById[seenByMessageId] || null : null;
  const seenByReceipts = seenByMessageId ? readReceiptsByMessageId[seenByMessageId] || [] : [];
  const seenByReadReceipts = seenByReceipts.filter((receipt) => receipt.hasRead);
  const seenByUnreadReceipts = seenByReceipts.filter((receipt) => !receipt.hasRead);

  function getConversationTitle(conversation: ConversationRow) {
    if (conversation.type === "group") {
      return conversation.title || "Untitled group";
    }
    const rowMembers = membersByConversationId[conversation.id] || [];
    const other = rowMembers.find((member) => member.user_id !== currentUserId);
    return getUserDisplayName(userById[other?.user_id || ""]);
  }

  const syncUrl = (conversationId: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", chatUrl({ c: conversationId || undefined }));
  };

  const scrollMessageListToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior,
    });
  }, []);

  const jumpToMessage = useCallback((messageId: string, behavior: ScrollBehavior = "smooth") => {
    if (!messageListRef.current || !messageId) return;
    const target = messageListRef.current.querySelector<HTMLElement>(
      `[data-chat-message-id="${messageId}"]`
    );
    if (!target) return;
    target.scrollIntoView({ behavior, block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 1800);
  }, []);

  const upsertConversationMembers = useCallback(
    (conversationId: string, nextRows: ConversationMemberRow[]) => {
      const normalizedRows = nextRows.map((row) => normalizeConversationMember(row));
      setMembers((prev) => {
        const withoutConversation = prev.filter((row) => row.conversation_id !== conversationId);
        return [...withoutConversation, ...normalizedRows];
      });
    },
    []
  );

  const markConversationRead = useCallback(
    async (conversationId: string, latestMessageCreatedAt?: string | null) => {
      const res = await fetch("/api/chat/conversations/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Unable to mark conversation as read");
      }

      const nextLastReadAt = latestMessageCreatedAt || new Date().toISOString();
      setUnreadByConversationId((prev) => ({
        ...prev,
        [conversationId]: 0,
      }));
      setMembers((prev) =>
        prev.map((row) =>
          row.conversation_id === conversationId && row.user_id === currentUserId
            ? { ...row, last_read_at: nextLastReadAt }
            : row
        )
      );

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("chat-read-updated"));
      }
    },
    [currentUserId]
  );

  const fetchMessages = useCallback(
    async (
      conversationId: string,
      options?: {
        after?: string;
        replace?: boolean;
        markRead?: boolean;
        silent?: boolean;
      }
    ) => {
      const params = new URLSearchParams();
      params.set("conversation_id", conversationId);
      if (options?.after) {
        params.set("after", options.after);
      }

      if (!options?.silent) {
        setIsLoadingConversation(true);
      }

      try {
        const res = await fetch(`/api/chat/messages?${params.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          messages?: MessageRow[];
          members?: ConversationMemberRow[];
        };
        if (!res.ok) {
          throw new Error(json.error || "Unable to load messages");
        }

        const incomingMessages = sortMessagesAsc(json.messages || []);
        const incomingMembers = json.members || [];
        if (incomingMembers.length) {
          upsertConversationMembers(conversationId, incomingMembers);
        }

        let mergedMessages: MessageRow[] = [];
        setMessagesByConversation((prev) => {
          const current = prev[conversationId] || [];
          const next = options?.replace ? incomingMessages : mergeMessages(current, incomingMessages);
          mergedMessages = next;
          return {
            ...prev,
            [conversationId]: next,
          };
        });

        const latestMessage =
          mergedMessages[mergedMessages.length - 1] ||
          incomingMessages[incomingMessages.length - 1] ||
          null;

        if (latestMessage) {
          setLatestByConversationId((prev) => ({
            ...prev,
            [conversationId]: latestMessage,
          }));
        }

        if (options?.markRead && latestMessage) {
          await markConversationRead(conversationId, latestMessage.created_at);
        }
      } finally {
        if (!options?.silent) {
          setIsLoadingConversation(false);
        }
      }
    },
    [markConversationRead, upsertConversationMembers]
  );

  const selectConversation = useCallback(
    async (conversationId: string) => {
      setError("");
      setSuccess("");
      setSelectedConversationId(conversationId);
      setEditingMessageId(null);
      setEditingDraft("");
      setEditingReplyToMessageId(null);
      setComposerInsertRequest(null);
      syncUrl(conversationId);
      initialPositionConversationIdRef.current = null;

      const myMembership = (membersByConversationId[conversationId] || []).find(
        (member) => member.user_id === currentUserId
      );
      const hasUnread = (unreadByConversationId[conversationId] || 0) > 0;
      setUnreadAnchorByConversationId((prev) => ({
        ...prev,
        [conversationId]: hasUnread ? myMembership?.last_read_at || null : null,
      }));

      try {
        const existing = messagesByConversation[conversationId] || [];
        if (existing.length) {
          const after = existing[existing.length - 1]?.created_at;
          await fetchMessages(conversationId, {
            after,
            replace: false,
            markRead: true,
            silent: true,
          });
        } else {
          await fetchMessages(conversationId, {
            replace: true,
            markRead: true,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load messages");
      }
    },
    [
      currentUserId,
      fetchMessages,
      membersByConversationId,
      messagesByConversation,
      unreadByConversationId,
    ]
  );

  const upsertConversationState = (
    conversation: ConversationRow,
    newMembers: ConversationMemberRow[]
  ) => {
    setConversations((prev) => {
      const exists = prev.some((item) => item.id === conversation.id);
      if (exists) {
        return prev.map((item) => (item.id === conversation.id ? conversation : item));
      }
      return [conversation, ...prev];
    });

    upsertConversationMembers(conversation.id, newMembers);
    setSelectedConversationId(conversation.id);
    syncUrl(conversation.id);
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversation.id]: prev[conversation.id] || [],
    }));
    setUnreadByConversationId((prev) => ({
      ...prev,
      [conversation.id]: 0,
    }));
  };

  const sendMessageToApi = useCallback(async (conversationId: string, payload: PendingMessagePayload) => {
    const res = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        body: payload.body,
        attachments: payload.attachments.map((attachment) => ({
          storage_path: attachment.storage_path,
          filename: attachment.filename,
          mime_type: attachment.mime_type,
          size_bytes: attachment.size_bytes,
        })),
        links: payload.links,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: MessageRow;
    };
    if (!res.ok || !json.message) {
      throw new Error(json.error || "Unable to send message");
    }
    return json.message;
  }, []);

  const retryFailedMessage = useCallback(
    async (message: MessageRow) => {
      const payload = message.client_retry_payload;
      if (!payload) return;

      const conversationId = message.conversation_id;
      setError("");
      setSuccess("");
      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        const next = current.map((row) =>
          row.id === message.id ? { ...row, client_status: "sending" as const } : row
        );
        return {
          ...prev,
          [conversationId]: next,
        };
      });

      try {
        const sentMessage = await sendMessageToApi(conversationId, payload);
        setMessagesByConversation((prev) => {
          const current = prev[conversationId] || [];
          const withoutFailed = current.filter((row) => row.id !== message.id);
          const next = mergeMessages(withoutFailed, [sentMessage]);
          return {
            ...prev,
            [conversationId]: next,
          };
        });
        setLatestByConversationId((prev) => ({
          ...prev,
          [conversationId]: sentMessage,
        }));
        setUnreadByConversationId((prev) => ({
          ...prev,
          [conversationId]: 0,
        }));
        await markConversationRead(conversationId, sentMessage.created_at);
      } catch (err) {
        setMessagesByConversation((prev) => {
          const current = prev[conversationId] || [];
          const next = current.map((row) =>
            row.id === message.id ? { ...row, client_status: "failed" as const } : row
          );
          return {
            ...prev,
            [conversationId]: next,
          };
        });
        setError(err instanceof Error ? err.message : "Unable to send message");
      }
    },
    [markConversationRead, sendMessageToApi]
  );

  const updateConversationPreferences = useCallback(
    async (
      conversationId: string,
      patch: {
        is_pinned?: boolean;
        is_muted?: boolean;
      }
    ) => {
      const currentMembership = myMembershipByConversationId[conversationId];
      if (!currentMembership) {
        return;
      }

      const previousMembership = currentMembership;
      const optimisticMembership = normalizeConversationMember({
        ...currentMembership,
        ...(typeof patch.is_pinned === "boolean" ? { is_pinned: patch.is_pinned } : {}),
        ...(typeof patch.is_muted === "boolean" ? { is_muted: patch.is_muted } : {}),
      });

      setError("");
      setMembers((prev) =>
        prev.map((row) =>
          row.conversation_id === conversationId && row.user_id === currentUserId
            ? optimisticMembership
            : row
        )
      );
      setIsSavingConversationPrefsById((prev) => ({
        ...prev,
        [conversationId]: true,
      }));

      try {
        const res = await fetch("/api/chat/conversations/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            ...(typeof patch.is_pinned === "boolean" ? { is_pinned: patch.is_pinned } : {}),
            ...(typeof patch.is_muted === "boolean" ? { is_muted: patch.is_muted } : {}),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          member?: ConversationMemberRow;
        };
        if (!res.ok || !json.member) {
          throw new Error(json.error || "Unable to update preferences");
        }
        const normalizedMember = normalizeConversationMember(json.member);
        setMembers((prev) =>
          prev.map((row) =>
            row.conversation_id === conversationId && row.user_id === currentUserId
              ? normalizedMember
              : row
          )
        );
      } catch (err) {
        setMembers((prev) =>
          prev.map((row) =>
            row.conversation_id === conversationId && row.user_id === currentUserId
              ? previousMembership
              : row
          )
        );
        setError(err instanceof Error ? err.message : "Unable to update preferences");
      } finally {
        setIsSavingConversationPrefsById((prev) => ({
          ...prev,
          [conversationId]: false,
        }));
      }
    },
    [currentUserId, myMembershipByConversationId]
  );

  const addConversationMember = useCallback(async () => {
    if (!selectedConversationId) return;
    const targetId = String(memberDraftUserId || "").trim();
    if (!targetId) {
      setMemberEditorError("Select a teammate or group to add.");
      return;
    }

    setMemberEditorError("");
    setMemberEditorSuccess("");
    try {
      setIsUpdatingConversationMembers(true);
      const res = await fetch("/api/chat/conversations/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: selectedConversationId,
          target_id: targetId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        members?: ConversationMemberRow[];
      };
      if (!res.ok || !json.members) {
        throw new Error(json.error || "Unable to add member");
      }
      upsertConversationMembers(selectedConversationId, json.members);
      setMemberDraftUserId("");
      setMemberEditorSuccess("Member added");
    } catch (err) {
      setMemberEditorError(err instanceof Error ? err.message : "Unable to add member");
    } finally {
      setIsUpdatingConversationMembers(false);
    }
  }, [memberDraftUserId, selectedConversationId, upsertConversationMembers]);

  const removeConversationMember = useCallback(
    async (memberUserId: string) => {
      if (!selectedConversationId) return;
      const targetUserId = String(memberUserId || "").trim();
      if (!targetUserId) return;

      setMemberEditorError("");
      setMemberEditorSuccess("");
      try {
        setIsUpdatingConversationMembers(true);
        const res = await fetch("/api/chat/conversations/members", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: selectedConversationId,
            user_id: targetUserId,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          members?: ConversationMemberRow[];
        };
        if (!res.ok || !json.members) {
          throw new Error(json.error || "Unable to remove member");
        }
        upsertConversationMembers(selectedConversationId, json.members);
        setMemberEditorSuccess("Member removed");
      } catch (err) {
        setMemberEditorError(err instanceof Error ? err.message : "Unable to remove member");
      } finally {
        setIsUpdatingConversationMembers(false);
      }
    },
    [selectedConversationId, upsertConversationMembers]
  );

  const toggleReaction = async (message: MessageRow, emoji: string) => {
    if (message.deleted_at) {
      return;
    }

    const existingReaction = message.reactions.find(
      (reaction) => reaction.user_id === currentUserId && reaction.emoji === emoji
    );

    const method = existingReaction ? "DELETE" : "POST";
    const res = await fetch("/api/chat/reactions", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: message.id,
        emoji,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      reaction?: MessageReactionRow;
    };
    if (!res.ok) {
      throw new Error(json.error || "Unable to update reaction");
    }

    const conversationId = message.conversation_id;

    setMessagesByConversation((prev) => {
      const current = prev[conversationId] || [];
      const updated = current.map((row) => {
        if (row.id !== message.id) {
          return row;
        }
        if (existingReaction) {
          return {
            ...row,
            reactions: row.reactions.filter(
              (reaction) => !(reaction.user_id === currentUserId && reaction.emoji === emoji)
            ),
          };
        }
        const addedReaction = json.reaction || {
          id: `${message.id}-${currentUserId}-${emoji}`,
          message_id: message.id,
          user_id: currentUserId,
          emoji,
          created_at: new Date().toISOString(),
        };
        return {
          ...row,
          reactions: [...row.reactions, addedReaction],
        };
      });
      return {
        ...prev,
        [conversationId]: updated,
      };
    });
  };

  const applyReaction = async (message: MessageRow, emoji: string) => {
    try {
      await toggleReaction(message, emoji);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update reaction");
    }
  };

  const startReplyToMessage = (message: MessageRow, senderName: string) => {
    if (message.deleted_at) {
      return;
    }
    const preview = toMessageSnippet(message);
    setComposerInsertRequest({
      id: `${message.id}-${Date.now()}`,
      reply_to_message_id: message.id,
      reply_preview: `${senderName}: ${preview}`,
    });
  };

  const startEditingMessage = (message: MessageRow) => {
    const parsed = parseReplyBody(message.body);
    setEditingMessageId(message.id);
    setEditingDraft(parsed.cleanBody);
    setEditingReplyToMessageId(parsed.replyToMessageId);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingDraft("");
    setEditingReplyToMessageId(null);
  };

  const saveEditedMessage = async (message: MessageRow) => {
    const nextBody = editingDraft.trim();
    if (!nextBody) {
      setError("Message cannot be empty");
      return;
    }
    const payloadBody = editingReplyToMessageId
      ? `[[reply:${editingReplyToMessageId}]]\n${nextBody}`
      : nextBody;

    setError("");
    setSuccess("");
    setIsSavingEdit(true);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id, body: payloadBody }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: MessageRow;
      };
      if (!res.ok || !json.message) {
        throw new Error(json.error || "Unable to edit message");
      }

      const updatedMessage = json.message;
      const conversationId = updatedMessage.conversation_id;
      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        const next = current.map((row) => (row.id === updatedMessage.id ? updatedMessage : row));
        return {
          ...prev,
          [conversationId]: next,
        };
      });

      setLatestByConversationId((prev) => {
        const latest = prev[conversationId];
        if (!latest || latest.id !== updatedMessage.id) {
          return prev;
        }
        return {
          ...prev,
          [conversationId]: updatedMessage,
        };
      });

      setEditingMessageId(null);
      setEditingDraft("");
      setEditingReplyToMessageId(null);
      setSuccess("Message updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to edit message");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteMessage = async (message: MessageRow) => {
    const confirmed = window.confirm("Delete this message? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: MessageRow;
      };
      if (!res.ok || !json.message) {
        throw new Error(json.error || "Unable to delete message");
      }

      const deletedMessage = json.message;
      const conversationId = deletedMessage.conversation_id;
      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        const next = current.map((row) => (row.id === deletedMessage.id ? deletedMessage : row));
        return {
          ...prev,
          [conversationId]: next,
        };
      });

      setLatestByConversationId((prev) => {
        const latest = prev[conversationId];
        if (!latest || latest.id !== deletedMessage.id) {
          return prev;
        }
        return {
          ...prev,
          [conversationId]: deletedMessage,
        };
      });

      if (editingMessageId === deletedMessage.id) {
        cancelEditMessage();
      }

      setSuccess("Message deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete message");
    }
  };

  useEffect(() => {
    if (!selectedConversationId) return;
    if (Object.prototype.hasOwnProperty.call(unreadAnchorByConversationId, selectedConversationId)) {
      return;
    }
    const myMembership = (membersByConversationId[selectedConversationId] || []).find(
      (member) => member.user_id === currentUserId
    );
    const hasUnread = (unreadByConversationId[selectedConversationId] || 0) > 0;
    setUnreadAnchorByConversationId((prev) => ({
      ...prev,
      [selectedConversationId]: hasUnread ? myMembership?.last_read_at || null : null,
    }));
  }, [
    currentUserId,
    membersByConversationId,
    selectedConversationId,
    unreadAnchorByConversationId,
    unreadByConversationId,
  ]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    const messageRows = messagesByConversation[selectedConversationId] || [];
    const after = messageRows[messageRows.length - 1]?.created_at;

    const timer = window.setInterval(() => {
      void fetchMessages(selectedConversationId, {
        after,
        replace: !messageRows.length,
        markRead: true,
        silent: true,
      }).catch(() => null);
    }, 6000);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchMessages, messagesByConversation, selectedConversationId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsConversationSettingsOpen(false);
    setIsEditUsersOpen(false);
    setMemberDraftUserId("");
    setMemberEditorError("");
    setMemberEditorSuccess("");
    setSeenByMessageId(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!seenByMessageId) return;
    const message = selectedMessagesById[seenByMessageId];
    if (
      !message ||
      message.sender_id !== currentUserId ||
      message.deleted_at ||
      message.client_status
    ) {
      setSeenByMessageId(null);
    }
  }, [currentUserId, seenByMessageId, selectedMessagesById]);

  useEffect(() => {
    if (!selectedConversationId || !selectedMessages.length) return;
    if (initialPositionConversationIdRef.current === selectedConversationId) return;
    initialPositionConversationIdRef.current = selectedConversationId;

    requestAnimationFrame(() => {
      if (firstUnreadMessageId) {
        jumpToMessage(firstUnreadMessageId, "auto");
      } else {
        scrollMessageListToBottom("auto");
      }
    });
  }, [
    firstUnreadMessageId,
    jumpToMessage,
    scrollMessageListToBottom,
    selectedConversationId,
    selectedMessages.length,
  ]);

  useEffect(() => {
    if (!selectedConversationId || !selectedMessages.length) return;
    const latestMessage = selectedMessages[selectedMessages.length - 1];
    if (!latestMessage || latestMessage.sender_id !== currentUserId) return;
    requestAnimationFrame(() => {
      scrollMessageListToBottom("smooth");
    });
  }, [
    currentUserId,
    scrollMessageListToBottom,
    selectedConversationId,
    selectedMessages,
    selectedMessages.length,
  ]);

  const composerDisabled = !selectedConversationId || isLoadingConversation;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-slate-100 lg:grid-cols-[350px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-slate-50">
        <div className="flex h-full min-h-0 flex-col p-3">
          {error ? (
            <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">New conversation</h2>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <button
                  type="button"
                  onClick={() => setAddMode("direct")}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    addMode === "direct"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Direct
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode("group")}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    addMode === "group"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Group
                </button>
              </div>
            </div>

            {addMode === "direct" ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setError("");
                  setSuccess("");
                  const otherUserId = directTargetUserId.trim();
                  if (!otherUserId) {
                    setError("Select a teammate");
                    return;
                  }
                  if (selectedDirectExistingConversationId) {
                    await selectConversation(selectedDirectExistingConversationId);
                    setSuccess("Opened existing direct chat");
                    return;
                  }
                  try {
                    setIsCreatingDirect(true);
                    const res = await fetch("/api/chat/conversations/direct", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ other_user_id: otherUserId }),
                    });
                    const json = (await res.json().catch(() => ({}))) as {
                      error?: string;
                      conversation?: ConversationRow;
                      members?: ConversationMemberRow[];
                      existing?: boolean;
                    };
                    if (!res.ok || !json.conversation) {
                      throw new Error(json.error || "Unable to create chat");
                    }
                    upsertConversationState(json.conversation, json.members || []);
                    setSuccess(json.existing ? "Opened existing direct chat" : "Direct chat ready");
                    setDirectTargetUserId("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Unable to create chat");
                  } finally {
                    setIsCreatingDirect(false);
                  }
                }}
              >
                <select
                  name="other_user_id"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={directTargetUserId}
                  onChange={(event) => setDirectTargetUserId(event.target.value)}
                  required
                >
                  <option value="">Select teammate</option>
                  {users
                    .filter((user) => user.id !== currentUserId)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                        {existingDirectConversationIdByUserId[user.id] ? " (existing chat)" : ""}
                      </option>
                    ))}
                </select>
                {selectedDirectExistingConversationId ? (
                  <p className="text-[11px] text-slate-500">
                    Existing direct chat found. Selecting this will open it instead of creating a
                    duplicate.
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={isCreatingDirect || !directTargetUserId}
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingDirect
                    ? "Starting..."
                    : selectedDirectExistingConversationId
                      ? "Open chat"
                      : "Start direct chat"}
                </button>
              </form>
            ) : (
              <form
                className="mt-3 space-y-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setError("");
                  setSuccess("");
                  const formEl = event.currentTarget;
                  const formData = new FormData(formEl);
                  const title = String(formData.get("title") || "").trim();
                  const memberUserIds = formData
                    .getAll("member_user_ids")
                    .map((value) => String(value).trim())
                    .filter(Boolean);
                  if (!title) {
                    setError("Group name is required");
                    return;
                  }
                  try {
                    setIsCreatingGroup(true);
                    const res = await fetch("/api/chat/conversations/group", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        title,
                        member_user_ids: memberUserIds,
                      }),
                    });
                    const json = (await res.json().catch(() => ({}))) as {
                      error?: string;
                      conversation?: ConversationRow;
                      members?: ConversationMemberRow[];
                    };
                    if (!res.ok || !json.conversation) {
                      throw new Error(json.error || "Unable to create group");
                    }
                    upsertConversationState(json.conversation, json.members || []);
                    setSuccess("Group chat created");
                    formEl.reset();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Unable to create group");
                  } finally {
                    setIsCreatingGroup(false);
                  }
                }}
              >
                <input
                  name="title"
                  placeholder="Group name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
                <select
                  name="member_user_ids"
                  multiple
                  size={5}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {users.filter((user) => user.id !== currentUserId).length ? (
                    <optgroup label="Teammates">
                      {users
                        .filter((user) => user.id !== currentUserId)
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {getUserDisplayName(user)}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {groupTargetOptions.length ? (
                    <optgroup label="Groups">
                      {groupTargetOptions.map((group) => (
                        <option key={`create-${group.value}`} value={group.value}>
                          {group.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <button
                  type="submit"
                  disabled={isCreatingGroup}
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingGroup ? "Creating..." : "Create group chat"}
                </button>
              </form>
            )}
          </section>

          <section className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Chats</h2>
              <input
                value={searchChats}
                onChange={(event) => setSearchChats(event.target.value)}
                placeholder="Search chats"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </div>
            <div className="h-full overflow-y-auto pb-2">
              {filteredConversations.length ? (
                filteredConversations.map((conversation) => {
                  const isActive = selectedConversationId === conversation.id;
                  const latest = latestByConversationId[conversation.id] || null;
                  const latestSender = latest ? getUserDisplayName(userById[latest.sender_id]) : "";
                  const latestBody = renderPreviewText(latest);
                  const unreadCount = unreadByConversationId[conversation.id] || 0;
                  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
                  const title = getConversationTitle(conversation);
                  const myMembership = myMembershipByConversationId[conversation.id];
                  const isPinned = Boolean(myMembership?.is_pinned);
                  const isMuted = Boolean(myMembership?.is_muted);
                  const isSavingPreferences = Boolean(isSavingConversationPrefsById[conversation.id]);
                  const directOtherUser =
                    conversation.type === "direct"
                      ? (() => {
                          const rowMembers = membersByConversationId[conversation.id] || [];
                          const other = rowMembers.find((member) => member.user_id !== currentUserId);
                          return userById[other?.user_id || ""] || null;
                        })()
                      : null;
                  const conversationAvatarUrl = getUserAvatarUrl(directOtherUser);
                  const conversationAvatarLabel =
                    conversation.type === "group"
                      ? String(conversation.title || "Group")
                      : getUserDisplayName(directOtherUser);
                  const conversationAvatarInitials = getInitials(conversationAvatarLabel);

                  return (
                    <div
                      key={conversation.id}
                      className={`group relative border-b border-slate-100 ${
                        isActive ? "bg-blue-50/80" : "hover:bg-slate-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void selectConversation(conversation.id)}
                        className={`block w-full py-3 pr-16 text-left transition-colors ${
                          isActive
                            ? "border-l-2 border-l-blue-500 pl-3"
                            : "border-l-2 border-l-transparent pl-4"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <span
                              className={`relative mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-semibold ${
                                isActive
                                  ? "border-blue-200 bg-blue-100 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-700"
                              }`}
                            >
                              {conversationAvatarUrl ? (
                                <Image
                                  src={conversationAvatarUrl}
                                  alt={`${conversationAvatarLabel} avatar`}
                                  fill
                                  unoptimized
                                  sizes="32px"
                                  className="object-cover"
                                />
                              ) : (
                                conversationAvatarInitials
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p
                                  className={`truncate text-sm font-semibold ${
                                    isActive ? "text-blue-900" : "text-slate-900"
                                  }`}
                                >
                                  {title}
                                </p>
                                {isPinned ? (
                                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                    Pinned
                                  </span>
                                ) : null}
                                {isMuted ? (
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    Muted
                                  </span>
                                ) : null}
                              </div>
                              <p
                                className={`mt-1 line-clamp-1 text-xs ${
                                  isActive ? "text-blue-900/75" : "text-slate-600"
                                }`}
                              >
                                {latestSender ? `${latestSender}: ` : ""}
                                {latestBody}
                              </p>
                            </div>
                          </div>
                          <div className="flex min-w-[56px] flex-col items-end gap-1">
                            <span
                              className={`text-[10px] font-medium ${
                                isActive ? "text-blue-800/80" : "text-slate-500"
                              }`}
                            >
                              {formatConversationTime(latest?.created_at || conversation.created_at)}
                            </span>
                            {unreadCount > 0 ? (
                              <span
                                className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                                  isMuted
                                    ? "bg-slate-300 text-slate-700"
                                    : "bg-blue-600 text-white"
                                }`}
                              >
                                {unreadLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>

                      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <button
                          type="button"
                          disabled={isSavingPreferences}
                          onClick={() => {
                            void updateConversationPreferences(conversation.id, {
                              is_pinned: !isPinned,
                            });
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          disabled={isSavingPreferences}
                          onClick={() => {
                            void updateConversationPreferences(conversation.id, {
                              is_muted: !isMuted,
                            });
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isMuted ? "Unmute" : "Mute"}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="px-4 py-6 text-sm text-slate-600">No chats match your search.</p>
              )}
            </div>
          </section>
        </div>
      </aside>

      <section className="min-h-0 overflow-hidden bg-slate-100">
        <div className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-white">
          <div className="relative border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedConversation ? getConversationTitle(selectedConversation) : "Select chat"}
              </h2>
              <div className="flex items-center gap-2">
                {firstUnreadMessageId ? (
                  <button
                    type="button"
                    onClick={() => {
                      jumpToMessage(firstUnreadMessageId);
                      if (!selectedConversationId) return;
                      const latestCreatedAt = selectedMessages[selectedMessages.length - 1]?.created_at || null;
                      void markConversationRead(selectedConversationId, latestCreatedAt).catch(() => null);
                      setUnreadAnchorByConversationId((prev) => ({
                        ...prev,
                        [selectedConversationId]: null,
                      }));
                    }}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Jump to unread
                  </button>
                ) : null}
                {selectedConversationId ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsConversationSettingsOpen((prev) => !prev);
                        setMemberEditorError("");
                        setMemberEditorSuccess("");
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      aria-label="Chat settings"
                      title="Chat settings"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="3.5" />
                        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
                      </svg>
                    </button>
                    {isConversationSettingsOpen ? (
                      <div className="absolute right-0 top-9 z-30 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setIsConversationSettingsOpen(false);
                            setIsEditUsersOpen(true);
                            setMemberEditorError("");
                            setMemberEditorSuccess("");
                          }}
                          className="block w-full rounded-md px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Edit users
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isLoadingConversation ? (
                  <span className="text-xs font-medium text-slate-500">Refreshing...</span>
                ) : null}
              </div>
            </div>
            {selectedConversationId ? (
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                {selectedConversationMembers.length} members:{" "}
                {selectedConversationMembers
                  .map((member) => getUserDisplayName(userById[member.user_id]))
                  .join(", ")}
              </p>
            ) : null}
            {selectedConversationId && isEditUsersOpen ? (
              <div className="absolute right-5 top-[calc(100%-2px)] z-30 mt-2 w-[min(440px,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Edit users</h3>
                  <button
                    type="button"
                    onClick={() => setIsEditUsersOpen(false)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>

                {memberEditorError ? (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {memberEditorError}
                  </p>
                ) : null}
                {memberEditorSuccess ? (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {memberEditorSuccess}
                  </p>
                ) : null}

                {!selectedConversationIsGroup ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Direct chats don&apos;t support member editing. Create a group chat to manage
                    members.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        Add member
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          value={memberDraftUserId}
                          onChange={(event) => setMemberDraftUserId(event.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs"
                          disabled={
                            !canManageSelectedConversationMembers || isUpdatingConversationMembers
                          }
                        >
                          <option value="">Select teammate or group</option>
                          {addableUsersForSelectedConversation.length ? (
                            <optgroup label="Teammates">
                              {addableUsersForSelectedConversation.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {getUserDisplayName(user)}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {groupTargetOptions.length ? (
                            <optgroup label="Groups">
                              {groupTargetOptions.map((group) => (
                                <option key={group.value} value={group.value}>
                                  {group.label}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            void addConversationMember();
                          }}
                          disabled={
                            !canManageSelectedConversationMembers ||
                            !memberDraftUserId ||
                            isUpdatingConversationMembers
                          }
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isUpdatingConversationMembers ? "Saving..." : "Add"}
                        </button>
                      </div>
                      {!canManageSelectedConversationMembers ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Only group owners can add or remove users.
                        </p>
                      ) : null}
                      {canManageSelectedConversationMembers &&
                      !addableUsersForSelectedConversation.length &&
                      !groupTargetOptions.length ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Everyone is already in this chat.
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white">
                      <p className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        Members
                      </p>
                      <div className="max-h-48 overflow-y-auto">
                        {selectedConversationMembers
                          .slice()
                          .sort((left, right) => {
                            if (left.role === right.role) {
                              const leftName = getUserDisplayName(userById[left.user_id]);
                              const rightName = getUserDisplayName(userById[right.user_id]);
                              return leftName.localeCompare(rightName);
                            }
                            return left.role === "owner" ? -1 : 1;
                          })
                          .map((member) => {
                            const memberName = getUserDisplayName(userById[member.user_id]);
                            const isSelf = member.user_id === currentUserId;
                            const canRemove =
                              canManageSelectedConversationMembers &&
                              !isSelf &&
                              !isUpdatingConversationMembers;
                            return (
                              <div
                                key={`${member.conversation_id}-${member.user_id}`}
                                className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-slate-800">
                                    {memberName}
                                  </p>
                                  <p className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                                    <span>{member.role}</span>
                                    {isSelf ? (
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                                        You
                                      </span>
                                    ) : null}
                                  </p>
                                </div>
                                {canRemove ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void removeConversationMember(member.user_id);
                                    }}
                                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {selectedConversationId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
              <div
                ref={messageListRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                {selectedMessages.length ? (
                  selectedMessages.map((message, index) => {
                    const previousMessage = index > 0 ? selectedMessages[index - 1] : null;
                    const startsNewDay = !previousMessage || !isSameCalendarDay(previousMessage.created_at, message.created_at);
                    const groupedWithPrev =
                      Boolean(previousMessage) &&
                      !startsNewDay &&
                      previousMessage?.sender_id === message.sender_id &&
                      !previousMessage?.deleted_at &&
                      !message.deleted_at &&
                      toMs(message.created_at) - toMs(previousMessage?.created_at) <= 10 * 60 * 1000;
                    const senderUser = userById[message.sender_id] || null;
                    const senderName = getUserDisplayName(senderUser);
                    const senderAvatarUrl = getUserAvatarUrl(senderUser);
                    const senderInitials = getInitials(senderName);
                    const isMine = message.sender_id === currentUserId;
                    const isDeleted = Boolean(message.deleted_at);
                    const isEditing = editingMessageId === message.id;
                    const messageClientStatus = message.client_status || null;
                    const isSendingMessage = messageClientStatus === "sending";
                    const isFailedMessage = messageClientStatus === "failed";
                    const isTransientLocalMessage = Boolean(messageClientStatus);
                    const { replyToMessageId, cleanBody } = parseReplyBody(message.body);
                    const replyTarget = replyToMessageId ? selectedMessagesById[replyToMessageId] || null : null;
                    const replySenderName = replyTarget ? getUserDisplayName(userById[replyTarget.sender_id] || null) : "Original message";
                    const replyPreview = replyTarget ? toMessageSnippet(replyTarget) : "Original message is unavailable";

                    const reactionCounts = message.reactions.reduce<
                      Array<{ emoji: string; count: number; reactedByMe: boolean }>
                    >((acc, reaction) => {
                      const found = acc.find((item) => item.emoji === reaction.emoji);
                      if (found) {
                        found.count += 1;
                        if (reaction.user_id === currentUserId) {
                          found.reactedByMe = true;
                        }
                        return acc;
                      }
                      acc.push({
                        emoji: reaction.emoji,
                        count: 1,
                        reactedByMe: reaction.user_id === currentUserId,
                      });
                      return acc;
                    }, []);

                    return (
                      <div key={message.id}>
                        {startsNewDay ? (
                          <div className="my-3 flex items-center gap-3">
                            <span className="h-px flex-1 bg-slate-200" />
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {formatMessageDayLabel(message.created_at)}
                            </span>
                            <span className="h-px flex-1 bg-slate-200" />
                          </div>
                        ) : null}

                        {firstUnreadMessageId === message.id ? (
                          <div className="my-2 flex items-center gap-3">
                            <span className="h-px flex-1 bg-blue-200" />
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                              Unread messages
                            </span>
                            <span className="h-px flex-1 bg-blue-200" />
                          </div>
                        ) : null}

                        <div
                          data-chat-message-id={message.id}
                          className={`group/message relative -mx-1 flex w-full items-end gap-2 rounded-xl px-1 py-1 transition-colors ${
                            highlightedMessageId === message.id
                              ? "bg-amber-50 ring-1 ring-amber-300"
                              : isEditing
                                ? "bg-slate-100/70"
                                : "hover:bg-slate-100/70"
                          } ${isMine ? "justify-end" : "justify-start"}`}
                        >
                          {!isMine ? (
                            groupedWithPrev ? (
                              <span className="inline-block h-8 w-8 shrink-0" />
                            ) : (
                              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">
                                {senderAvatarUrl ? (
                                  <Image
                                    src={senderAvatarUrl}
                                    alt={`${senderName} avatar`}
                                    fill
                                    unoptimized
                                    sizes="32px"
                                    className="object-cover"
                                  />
                                ) : (
                                  senderInitials
                                )}
                              </span>
                            )
                          ) : null}
                          <article className="relative max-w-[min(760px,92%)]">
                            {!isEditing && !isDeleted && !isTransientLocalMessage ? (
                              <div
                                className={`absolute -top-3 z-20 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm transition-opacity duration-150 ${
                                  isMine ? "right-2" : "left-2"
                                } opacity-100 md:pointer-events-none md:opacity-0 md:group-hover/message:pointer-events-auto md:group-hover/message:opacity-100 md:group-focus-within/message:pointer-events-auto md:group-focus-within/message:opacity-100`}
                              >
                                <EmojiPickerButton
                                  onSelect={(emoji) => {
                                    void applyReaction(message, emoji);
                                  }}
                                  panelAlign={isMine ? "right" : "left"}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                />
                                <button
                                  type="button"
                                  onClick={() => startReplyToMessage(message, senderName)}
                                  className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  Reply
                                </button>
                                {isMine ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => startEditingMessage(message)}
                                      className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSeenByMessageId(message.id)}
                                      className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Seen by
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteMessage(message)}
                                      className="inline-flex h-7 items-center rounded-md border border-red-200 bg-white px-2 text-[11px] font-medium text-red-700 hover:bg-red-50"
                                    >
                                      Delete
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                            <div
                              className={`rounded-2xl border px-3 py-2 shadow-sm ${
                                isMine
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-slate-200 bg-white text-slate-900"
                              }`}
                            >
                              {!groupedWithPrev ? (
                                <div
                                  className={`mb-1 flex items-center justify-between gap-3 text-[11px] ${
                                    isMine ? "text-blue-100" : "text-slate-500"
                                  }`}
                                >
                                  <span className="font-semibold">{senderName}</span>
                                  <span>{formatMessageTime(message.created_at)}</span>
                                </div>
                              ) : null}

                              {isEditing ? (
                                <div className="space-y-2">
                                  <MentionTextarea
                                    value={editingDraft}
                                    onValueChange={setEditingDraft}
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={cancelEditMessage}
                                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSavingEdit}
                                      onClick={() => void saveEditedMessage(message)}
                                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {isSavingEdit ? "Saving..." : "Save"}
                                    </button>
                                  </div>
                                </div>
                              ) : isDeleted ? (
                                <p className={`text-sm italic ${isMine ? "text-blue-100" : "text-slate-500"}`}>
                                  Message deleted
                                </p>
                              ) : (
                                <>
                                  {replyToMessageId ? (
                                    <button
                                      type="button"
                                      disabled={!replyTarget}
                                      onClick={() => {
                                        if (replyTarget) jumpToMessage(replyToMessageId);
                                      }}
                                      className={`mb-2 w-full rounded-lg border px-2.5 py-2 text-left text-xs ${
                                        isMine
                                          ? "border-blue-300 bg-blue-500/30 text-blue-50 hover:bg-blue-500/40"
                                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                                      } ${replyTarget ? "" : "cursor-not-allowed opacity-70"}`}
                                    >
                                      <p className={`font-semibold ${isMine ? "text-blue-100" : "text-slate-600"}`}>
                                        Reply to {replySenderName}
                                      </p>
                                      <p className="line-clamp-2">{replyPreview}</p>
                                    </button>
                                  ) : null}

                                  {cleanBody ? (
                                    <p className="whitespace-pre-wrap text-sm">{cleanBody}</p>
                                  ) : null}

                                  {message.links.length ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {message.links.map((link) => (
                                        <Link
                                          key={link.id}
                                          href={link.href}
                                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                            isMine
                                              ? "border-blue-300 bg-blue-500/30 text-white hover:bg-blue-500/40"
                                              : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                                          }`}
                                        >
                                          {typeLabel[link.entity_type]}: {link.label}
                                        </Link>
                                      ))}
                                    </div>
                                  ) : null}

                                  {message.attachments.length ? (
                                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                      {message.attachments.map((attachment) =>
                                        attachment.url ? (
                                          <a
                                            key={attachment.id}
                                            href={attachment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block overflow-hidden rounded-md border border-slate-200"
                                          >
                                            <Image
                                              src={attachment.url}
                                              alt={attachment.filename}
                                              width={320}
                                              height={112}
                                              unoptimized
                                              className="h-28 w-full object-cover"
                                            />
                                          </a>
                                        ) : (
                                          <div
                                            key={attachment.id}
                                            className="flex h-28 items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-2 text-center text-xs text-slate-600"
                                          >
                                            Attachment unavailable
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ) : null}
                                </>
                              )}

                              {message.edited_at && !isDeleted && !isEditing ? (
                                <p className={`mt-2 text-[11px] ${isMine ? "text-blue-100" : "text-slate-500"}`}>
                                  Edited
                                </p>
                              ) : null}
                            </div>

                            {!isEditing && !isTransientLocalMessage ? (
                              <div
                                className={`mt-1 flex flex-wrap items-center gap-1 ${
                                  isMine ? "justify-end" : "justify-start"
                                }`}
                              >
                                {!isDeleted
                                  ? reactionCounts.map((item) => (
                                      <button
                                        key={`${message.id}-${item.emoji}`}
                                        type="button"
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                                          item.reactedByMe
                                            ? "border-blue-300 bg-blue-50 text-blue-700"
                                            : "border-slate-200 bg-white text-slate-600"
                                        }`}
                                        onClick={() => {
                                          void applyReaction(message, item.emoji);
                                        }}
                                      >
                                        <span>{item.emoji}</span>
                                        <span>{item.count}</span>
                                      </button>
                                    ))
                                  : null}
                              </div>
                            ) : null}

                            {isMine && !isEditing && isTransientLocalMessage ? (
                              <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
                                {isSendingMessage ? (
                                  <span className="text-slate-500">Sending...</span>
                                ) : null}
                                {isFailedMessage ? (
                                  <>
                                    <span className="text-rose-600">Failed to send</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void retryFailedMessage(message);
                                      }}
                                      className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-100"
                                    >
                                      Retry
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            ) : null}

                          </article>
                          {isMine ? (
                            groupedWithPrev ? (
                              <span className="inline-block h-8 w-8 shrink-0" />
                            ) : (
                              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">
                                {senderAvatarUrl ? (
                                  <Image
                                    src={senderAvatarUrl}
                                    alt={`${senderName} avatar`}
                                    fill
                                    unoptimized
                                    sizes="32px"
                                    className="object-cover"
                                  />
                                ) : (
                                  senderInitials
                                )}
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-600">No messages yet.</p>
                )}
              </div>

              {seenByMessage ? (
                <div
                  className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-4"
                  onClick={() => setSeenByMessageId(null)}
                  role="presentation"
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Seen by details"
                    onClick={(event) => event.stopPropagation()}
                    className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Seen by</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Message sent {formatMessageTime(seenByMessage.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSeenByMessageId(null)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          Read ({seenByReadReceipts.length})
                        </p>
                        {seenByReadReceipts.length ? (
                          <div className="mt-2 max-h-44 overflow-y-auto">
                            {seenByReadReceipts.map((receipt) => (
                              <div
                                key={`${seenByMessage.id}-read-${receipt.userId}`}
                                className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-700">
                                    {receipt.avatarUrl ? (
                                      <Image
                                        src={receipt.avatarUrl}
                                        alt={`${receipt.name} avatar`}
                                        fill
                                        unoptimized
                                        sizes="28px"
                                        className="object-cover"
                                      />
                                    ) : (
                                      getInitials(receipt.name)
                                    )}
                                  </span>
                                  <span className="truncate text-xs font-medium text-slate-800">
                                    {receipt.name}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[11px] text-slate-500">
                                  {receipt.lastReadAt ? formatMessageTime(receipt.lastReadAt) : "Read"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">No one has read this yet.</p>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                          Not read ({seenByUnreadReceipts.length})
                        </p>
                        {seenByUnreadReceipts.length ? (
                          <div className="mt-2 max-h-44 overflow-y-auto">
                            {seenByUnreadReceipts.map((receipt) => (
                              <div
                                key={`${seenByMessage.id}-unread-${receipt.userId}`}
                                className="flex items-center justify-between gap-2 border-b border-slate-200 py-2 last:border-b-0"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-700">
                                    {receipt.avatarUrl ? (
                                      <Image
                                        src={receipt.avatarUrl}
                                        alt={`${receipt.name} avatar`}
                                        fill
                                        unoptimized
                                        sizes="28px"
                                        className="object-cover"
                                      />
                                    ) : (
                                      getInitials(receipt.name)
                                    )}
                                  </span>
                                  <span className="truncate text-xs font-medium text-slate-800">
                                    {receipt.name}
                                  </span>
                                </div>
                                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                  Pending
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">Everyone has read this message.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={composerDisabled ? "opacity-70" : ""}>
                <ChatComposer
                  conversationId={selectedConversationId}
                  isSending={isSending || composerDisabled}
                  insertDraftRequest={composerInsertRequest}
                  onSend={async ({ body, links, attachments, replyToMessageId }) => {
                    if (!selectedConversationId) {
                      return;
                    }

                    setError("");
                    setSuccess("");
                    const normalizedBody = String(body || "").trim();
                    const payloadBody = replyToMessageId
                      ? `[[reply:${replyToMessageId}]]\n${normalizedBody}`
                      : normalizedBody;
                    const payload: PendingMessagePayload = {
                      body: payloadBody,
                      attachments: attachments.map((attachment) => ({
                        storage_path: attachment.storage_path,
                        filename: attachment.filename,
                        mime_type: attachment.mime_type,
                        size_bytes: attachment.size_bytes,
                        url: attachment.url || null,
                      })),
                      links: links.map((link) => ({
                        entity_type: link.entityType,
                        entity_id: link.entityId,
                        label: link.label,
                      })),
                    };

                    const optimisticId = `local-${Date.now()}-${Math.random()
                      .toString(36)
                      .slice(2, 8)}`;
                    const optimisticCreatedAt = new Date().toISOString();
                    const optimisticMessage: MessageRow = {
                      id: optimisticId,
                      conversation_id: selectedConversationId,
                      sender_id: currentUserId,
                      body: payload.body,
                      created_at: optimisticCreatedAt,
                      edited_at: null,
                      deleted_at: null,
                      links: payload.links.map((link, index) => ({
                        id: `${optimisticId}-link-${index}`,
                        message_id: optimisticId,
                        entity_type: link.entity_type,
                        entity_id: link.entity_id,
                        label: link.label || `${typeLabel[link.entity_type]} link`,
                        href: messageLinkHref(link.entity_type, link.entity_id),
                      })),
                      attachments: payload.attachments.map((attachment, index) => ({
                        id: `${optimisticId}-attachment-${index}`,
                        message_id: optimisticId,
                        storage_path: attachment.storage_path,
                        filename: attachment.filename,
                        mime_type: attachment.mime_type,
                        size_bytes: attachment.size_bytes,
                        url: attachment.url || null,
                      })),
                      reactions: [],
                      client_status: "sending",
                      client_retry_payload: payload,
                    };

                    setMessagesByConversation((prev) => {
                      const current = prev[selectedConversationId] || [];
                      return {
                        ...prev,
                        [selectedConversationId]: mergeMessages(current, [optimisticMessage]),
                      };
                    });
                    setLatestByConversationId((prev) => ({
                      ...prev,
                      [selectedConversationId]: optimisticMessage,
                    }));
                    setUnreadByConversationId((prev) => ({
                      ...prev,
                      [selectedConversationId]: 0,
                    }));
                    setComposerInsertRequest(null);

                    try {
                      setIsSending(true);
                      const message = await sendMessageToApi(selectedConversationId, payload);
                      setMessagesByConversation((prev) => {
                        const current = prev[selectedConversationId] || [];
                        const withoutOptimistic = current.filter((row) => row.id !== optimisticId);
                        const next = mergeMessages(withoutOptimistic, [message]);
                        return {
                          ...prev,
                          [selectedConversationId]: next,
                        };
                      });
                      setLatestByConversationId((prev) => ({
                        ...prev,
                        [selectedConversationId]: message,
                      }));
                      setUnreadByConversationId((prev) => ({
                        ...prev,
                        [selectedConversationId]: 0,
                      }));
                      await markConversationRead(selectedConversationId, message.created_at);
                    } catch (err) {
                      setMessagesByConversation((prev) => {
                        const current = prev[selectedConversationId] || [];
                        const next = current.map((row) =>
                          row.id === optimisticId
                            ? { ...row, client_status: "failed" as const }
                            : row
                        );
                        return {
                          ...prev,
                          [selectedConversationId]: next,
                        };
                      });
                      setLatestByConversationId((prev) => {
                        const latest = prev[selectedConversationId];
                        if (!latest || latest.id !== optimisticId) {
                          return prev;
                        }
                        return {
                          ...prev,
                          [selectedConversationId]: {
                            ...optimisticMessage,
                            client_status: "failed",
                          },
                        };
                      });
                      setError(err instanceof Error ? err.message : "Unable to send message");
                    } finally {
                      setIsSending(false);
                    }
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="px-4 py-8 text-sm text-slate-600">
              Start a direct chat or create a group to begin messaging.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
