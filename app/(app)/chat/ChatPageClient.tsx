"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sortConversationsByRecentActivity } from "@/lib/chatConversations";
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

const typeLabel: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Suggestion",
  note: "Note",
  client: "Client",
};

const reactionOptions = [
  "\u{1F44D}",
  "\u{2764}\u{FE0F}",
  "\u{1F602}",
  "\u{1F389}",
  "\u{1F440}",
  "\u{1F525}",
] as const;

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

function getUserDisplayName(user: UserRow | null | undefined) {
  if (!user) return "Unknown user";
  return user.full_name || user.email || "Unknown user";
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
  const body = String(message.body || "").trim();
  if (body) return body;
  return "Attachment or link";
}

export default function ChatPageClient(props: {
  currentUserId: string;
  users: UserRow[];
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
    initialConversations,
    initialMembers,
    initialSelectedConversationId,
    initialMessages,
    initialLatestByConversationId,
    initialUnreadByConversationId,
  } = props;

  const [conversations, setConversations] = useState(initialConversations);
  const [members, setMembers] = useState(initialMembers);
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

  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isCreatingDirect, setIsCreatingDirect] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [searchChats, setSearchChats] = useState("");
  const [addMode, setAddMode] = useState<"direct" | "group">("direct");
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const messageListRef = useRef<HTMLDivElement | null>(null);

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

  const conversationsByRecentActivity = useMemo(
    () => sortConversationsByRecentActivity(conversations, latestByConversationId),
    [conversations, latestByConversationId]
  );

  const selectedMessages = useMemo(() => {
    if (!selectedConversationId) return [];
    return messagesByConversation[selectedConversationId] || [];
  }, [messagesByConversation, selectedConversationId]);

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return (
      conversationsByRecentActivity.find(
        (conversation) => conversation.id === selectedConversationId
      ) || null
    );
  }, [conversationsByRecentActivity, selectedConversationId]);

  const searchableConversationTextById = useMemo(() => {
    return conversationsByRecentActivity.reduce<Record<string, string>>((acc, conversation) => {
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
    conversationsByRecentActivity,
    currentUserId,
    latestByConversationId,
    membersByConversationId,
    userById,
  ]);

  const filteredConversations = useMemo(() => {
    const term = searchChats.trim().toLowerCase();
    if (!term) return conversationsByRecentActivity;
    return conversationsByRecentActivity.filter((conversation) =>
      (searchableConversationTextById[conversation.id] || "").includes(term)
    );
  }, [conversationsByRecentActivity, searchChats, searchableConversationTextById]);

  const selectedConversationMembers = useMemo(() => {
    if (!selectedConversationId) return [];
    return membersByConversationId[selectedConversationId] || [];
  }, [membersByConversationId, selectedConversationId]);

  const latestOwnMessageId = useMemo(() => {
    for (let index = selectedMessages.length - 1; index >= 0; index -= 1) {
      const message = selectedMessages[index];
      if (message.sender_id === currentUserId) {
        return message.id;
      }
    }
    return null;
  }, [currentUserId, selectedMessages]);

  const readByMessageId = useMemo(() => {
    if (!selectedConversationId) {
      return {} as Record<string, string[]>;
    }

    const rows = membersByConversationId[selectedConversationId] || [];
    const result: Record<string, string[]> = {};

    selectedMessages.forEach((message) => {
      if (message.sender_id !== currentUserId || message.deleted_at) {
        return;
      }
      const createdMs = toMs(message.created_at);
      if (!createdMs) {
        return;
      }

      const readNames = rows
        .filter((member) => member.user_id !== message.sender_id)
        .filter((member) => toMs(member.last_read_at) >= createdMs)
        .map((member) => getUserDisplayName(userById[member.user_id]))
        .sort((left, right) => left.localeCompare(right));

      if (readNames.length) {
        result[message.id] = readNames;
      }
    });

    return result;
  }, [
    currentUserId,
    membersByConversationId,
    selectedConversationId,
    selectedMessages,
    userById,
  ]);

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

  const upsertConversationMembers = useCallback(
    (conversationId: string, nextRows: ConversationMemberRow[]) => {
      setMembers((prev) => {
        const withoutConversation = prev.filter((row) => row.conversation_id !== conversationId);
        return [...withoutConversation, ...nextRows];
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
      setReactionPickerMessageId(null);
      syncUrl(conversationId);

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
    [fetchMessages, messagesByConversation]
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

  const startEditingMessage = (message: MessageRow) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.body);
    setReactionPickerMessageId(null);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingDraft("");
  };

  const saveEditedMessage = async (message: MessageRow) => {
    const nextBody = editingDraft.trim();
    if (!nextBody) {
      setError("Message cannot be empty");
      return;
    }

    setError("");
    setSuccess("");
    setIsSavingEdit(true);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id, body: nextBody }),
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
    if (!selectedConversationId) {
      return;
    }

    if ((unreadByConversationId[selectedConversationId] || 0) <= 0) {
      return;
    }

    const latestCreatedAt =
      messagesByConversation[selectedConversationId]?.[
        (messagesByConversation[selectedConversationId] || []).length - 1
      ]?.created_at || null;

    void markConversationRead(selectedConversationId, latestCreatedAt).catch(() => null);
  }, [
    markConversationRead,
    messagesByConversation,
    selectedConversationId,
    unreadByConversationId,
  ]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [selectedConversationId, selectedMessages.length]);

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
                  const formEl = event.currentTarget;
                  const formData = new FormData(formEl);
                  const otherUserId = String(formData.get("other_user_id") || "").trim();
                  if (!otherUserId) {
                    setError("Select a teammate");
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
                    };
                    if (!res.ok || !json.conversation) {
                      throw new Error(json.error || "Unable to create chat");
                    }
                    upsertConversationState(json.conversation, json.members || []);
                    setSuccess("Direct chat ready");
                    formEl.reset();
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
                  defaultValue=""
                  required
                >
                  <option value="">Select teammate</option>
                  {users
                    .filter((user) => user.id !== currentUserId)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  disabled={isCreatingDirect}
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingDirect ? "Starting..." : "Start direct chat"}
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
                  {users
                    .filter((user) => user.id !== currentUserId)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                      </option>
                    ))}
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
                  const title = getConversationTitle(conversation);

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => void selectConversation(conversation.id)}
                      className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                        isActive ? "bg-blue-50/70" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
                          <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                            {latestSender ? `${latestSender}: ` : ""}
                            {latestBody}
                          </p>
                        </div>
                        <div className="flex min-w-[56px] flex-col items-end gap-1">
                          <span className="text-[11px] text-slate-500">
                            {formatConversationTime(latest?.created_at || conversation.created_at)}
                          </span>
                          {unreadCount > 0 ? (
                            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                              {unreadCount}
                            </span>
                          ) : (
                            <span className="h-5" />
                          )}
                        </div>
                      </div>
                    </button>
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
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedConversation ? getConversationTitle(selectedConversation) : "Select chat"}
              </h2>
              {isLoadingConversation ? (
                <span className="text-xs font-medium text-slate-500">Refreshing...</span>
              ) : null}
            </div>
            {selectedConversationId ? (
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                {selectedConversationMembers.length} members:{" "}
                {selectedConversationMembers
                  .map((member) => getUserDisplayName(userById[member.user_id]))
                  .join(", ")}
              </p>
            ) : null}
          </div>

          {selectedConversationId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
              <div
                ref={messageListRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                {selectedMessages.length ? (
                  selectedMessages.map((message) => {
                    const senderName = getUserDisplayName(userById[message.sender_id]);
                    const isMine = message.sender_id === currentUserId;
                    const isDeleted = Boolean(message.deleted_at);
                    const isEditing = editingMessageId === message.id;
                    const readNames = readByMessageId[message.id] || [];
                    const isLatestOwn = latestOwnMessageId === message.id;

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
                      <div
                        key={message.id}
                        className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                      >
                        <article className="group max-w-[min(760px,92%)]">
                          <div
                            className={`rounded-2xl border px-3 py-2 shadow-sm ${
                              isMine
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-slate-200 bg-white text-slate-900"
                            }`}
                          >
                            <div
                              className={`mb-1 flex items-center justify-between gap-3 text-[11px] ${
                                isMine ? "text-blue-100" : "text-slate-500"
                              }`}
                            >
                              <span className="font-semibold">{senderName}</span>
                              <span>{formatMessageTime(message.created_at)}</span>
                            </div>

                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editingDraft}
                                  onChange={(event) => setEditingDraft(event.target.value)}
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
                                {message.body ? (
                                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
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

                          {!isEditing ? (
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
                                      onClick={async () => {
                                        try {
                                          await toggleReaction(message, item.emoji);
                                        } catch (err) {
                                          setError(
                                            err instanceof Error ? err.message : "Unable to update reaction"
                                          );
                                        }
                                      }}
                                    >
                                      <span>{item.emoji}</span>
                                      <span>{item.count}</span>
                                    </button>
                                  ))
                                : null}

                              {!isDeleted ? (
                                <div className="relative">
                                  <button
                                    type="button"
                                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                                    onClick={() =>
                                      setReactionPickerMessageId((current) =>
                                        current === message.id ? null : message.id
                                      )
                                    }
                                  >
                                    +
                                  </button>
                                  {reactionPickerMessageId === message.id ? (
                                    <div className="absolute bottom-7 right-0 z-10 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                                      {reactionOptions.map((emoji) => (
                                        <button
                                          key={`${message.id}-${emoji}`}
                                          type="button"
                                          className="rounded px-1 py-0.5 text-base hover:bg-slate-100"
                                          onClick={async () => {
                                            try {
                                              await toggleReaction(message, emoji);
                                              setReactionPickerMessageId(null);
                                            } catch (err) {
                                              setError(
                                                err instanceof Error
                                                  ? err.message
                                                  : "Unable to update reaction"
                                              );
                                            }
                                          }}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {isMine && !isDeleted ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditingMessage(message)}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteMessage(message)}
                                    className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}

                          {isMine && isLatestOwn && readNames.length ? (
                            <p className="mt-1 text-right text-[11px] text-slate-500">
                              Seen by{" "}
                              {readNames.length <= 2
                                ? readNames.join(", ")
                                : `${readNames[0]} +${readNames.length - 1}`}
                            </p>
                          ) : null}
                        </article>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-600">No messages yet.</p>
                )}
              </div>

              <div className={composerDisabled ? "opacity-70" : ""}>
                <ChatComposer
                  conversationId={selectedConversationId}
                  isSending={isSending || composerDisabled}
                  onSend={async ({ body, links, attachments }) => {
                    setError("");
                    setSuccess("");
                    try {
                      setIsSending(true);
                      const res = await fetch("/api/chat/messages", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          conversation_id: selectedConversationId,
                          body,
                          attachments,
                          links: links.map((link) => ({
                            entity_type: link.entityType,
                            entity_id: link.entityId,
                            label: link.label,
                          })),
                        }),
                      });
                      const json = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        message?: MessageRow;
                      };
                      if (!res.ok || !json.message) {
                        throw new Error(json.error || "Unable to send message");
                      }

                      const message = json.message;
                      setMessagesByConversation((prev) => {
                        const current = prev[selectedConversationId] || [];
                        return {
                          ...prev,
                          [selectedConversationId]: mergeMessages(current, [message]),
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
                      setError(err instanceof Error ? err.message : "Unable to send message");
                      throw err;
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
