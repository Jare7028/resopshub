"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  links: MessageLinkRow[];
  reactions: MessageReactionRow[];
};

type LatestPreview = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

const typeLabel: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Suggestion",
  note: "Note",
  client: "Client",
};

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

export default function ChatPageClient(props: {
  currentUserId: string;
  users: UserRow[];
  initialConversations: ConversationRow[];
  initialMembers: ConversationMemberRow[];
  initialSelectedConversationId: string | null;
  initialMessages: MessageRow[];
  initialLatestByConversationId: Record<string, LatestPreview | null>;
  initialUnreadByConversationId: Record<string, number>;
  linkOptions: Record<LinkEntityType, Array<{ id: string; label: string }>>;
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
    linkOptions,
  } = props;

  const [conversations, setConversations] = useState(initialConversations);
  const [members, setMembers] = useState(initialMembers);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialSelectedConversationId
  );
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, MessageRow[]>>(
    initialSelectedConversationId
      ? { [initialSelectedConversationId]: initialMessages }
      : {}
  );
  const [latestByConversationId, setLatestByConversationId] = useState(initialLatestByConversationId);
  const [unreadByConversationId, setUnreadByConversationId] = useState(
    initialUnreadByConversationId
  );
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingDirect, setIsCreatingDirect] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [searchChats, setSearchChats] = useState("");
  const [addMode, setAddMode] = useState<"direct" | "group">("direct");
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);

  const reactionOptions = ["👍", "❤️", "😂", "🎉", "👀", "🔥"] as const;

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

  const selectedMessages = selectedConversationId
    ? messagesByConversation[selectedConversationId] || []
    : [];

  const selectedConversation = selectedConversationId
    ? conversations.find((conversation) => conversation.id === selectedConversationId) || null
    : null;

  const searchableConversationTextById = useMemo(() => {
    return conversations.reduce<Record<string, string>>((acc, conversation) => {
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
      const latestBody = latest?.body || "";
      acc[conversation.id] = `${title} ${latestSender} ${latestBody}`.toLowerCase();
      return acc;
    }, {});
  }, [conversations, currentUserId, latestByConversationId, membersByConversationId, userById]);

  const filteredConversations = useMemo(() => {
    const term = searchChats.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) =>
      (searchableConversationTextById[conversation.id] || "").includes(term)
    );
  }, [conversations, searchChats, searchableConversationTextById]);

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

  const fetchMessages = async (conversationId: string) => {
    const res = await fetch(
      `/api/chat/messages?conversation_id=${encodeURIComponent(conversationId)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      messages?: MessageRow[];
    };
    if (!res.ok) {
      throw new Error(json.error || "Unable to load messages");
    }
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: json.messages || [],
    }));
  };

  const markConversationRead = async (conversationId: string) => {
    setUnreadByConversationId((prev) => ({
      ...prev,
      [conversationId]: 0,
    }));
    await fetch("/api/chat/conversations/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => null);
  };

  const selectConversation = async (conversationId: string) => {
    setError("");
    setSuccess("");
    setSelectedConversationId(conversationId);
    syncUrl(conversationId);
    if (!messagesByConversation[conversationId]) {
      try {
        await fetchMessages(conversationId);
        await markConversationRead(conversationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load messages");
      }
    } else {
      await markConversationRead(conversationId);
    }
  };

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
    setMembers((prev) => {
      const without = prev.filter((row) => row.conversation_id !== conversation.id);
      return [...without, ...newMembers];
    });
    setSelectedConversationId(conversation.id);
    syncUrl(conversation.id);
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversation.id]: prev[conversation.id] || [],
    }));
  };

  const toggleReaction = async (message: MessageRow, emoji: string) => {
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

    if (!selectedConversationId) {
      return;
    }

    setMessagesByConversation((prev) => {
      const current = prev[selectedConversationId] || [];
      const updated = current.map((row) => {
        if (row.id !== message.id) {
          return row;
        }
        if (existingReaction) {
          return {
            ...row,
            reactions: row.reactions.filter(
              (reaction) =>
                !(
                  reaction.user_id === currentUserId &&
                  reaction.emoji === emoji
                )
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
        [selectedConversationId]: updated,
      };
    });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-slate-100 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-slate-50">
        <div className="flex h-full min-h-0 flex-col p-3">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Add new</h2>
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
          <div className="h-full overflow-y-auto pb-3">
            {filteredConversations.length ? (
              filteredConversations.map((conversation) => {
                const isActive = selectedConversationId === conversation.id;
                const latest = latestByConversationId[conversation.id] || null;
                const latestSender = latest ? getUserDisplayName(userById[latest.sender_id]) : "";
                const latestLine = latest
                  ? `${latestSender}: ${latest.body || "[link]"}`
                  : "No messages yet";
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => void selectConversation(conversation.id)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                      isActive ? "bg-slate-100" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {getConversationTitle(conversation)}
                      </div>
                      <div className="flex min-w-[52px] flex-col items-end gap-1">
                        <div className="text-xs text-slate-500">{latest ? new Date(latest.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}</div>
                        {(unreadByConversationId[conversation.id] || 0) > 0 ? (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {unreadByConversationId[conversation.id]}
                          </span>
                        ) : (
                          <span className="h-5" />
                        )}
                      </div>
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-slate-600">{latestLine}</div>
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
            <h2 className="text-base font-semibold text-slate-900">
              {selectedConversation ? getConversationTitle(selectedConversation) : "Select chat"}
            </h2>
            {selectedConversationId ? (
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                Members:{" "}
                {(membersByConversationId[selectedConversationId] || [])
                  .map((member) => getUserDisplayName(userById[member.user_id]))
                  .join(", ")}
              </p>
            ) : null}
          </div>

          {selectedConversationId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                {selectedMessages.length ? (
                  selectedMessages.map((message) => {
                    const senderName = getUserDisplayName(userById[message.sender_id]);
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
                      <article
                        key={message.id}
                        className="relative rounded-lg border border-slate-200 bg-white p-3 pb-10 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{senderName}</span>
                          <time className="text-xs text-slate-500">
                            {new Date(message.created_at).toLocaleString("en-US")}
                          </time>
                        </div>
                        {message.body ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                            {message.body}
                          </p>
                        ) : null}
                        {message.links.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.links.map((link) => (
                              <Link
                                key={link.id}
                                href={link.href}
                                className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              >
                                {typeLabel[link.entity_type]}: {link.label}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                        <div className="absolute bottom-2 right-2 flex items-center gap-1">
                          {reactionCounts.map((item) => (
                            <button
                              key={`${message.id}-${item.emoji}`}
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                                item.reactedByMe
                                  ? "border-blue-300 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                              }`}
                              onClick={async () => {
                                try {
                                  await toggleReaction(message, item.emoji);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Unable to update reaction"
                                  );
                                }
                              }}
                            >
                              <span>{item.emoji}</span>
                              <span>{item.count}</span>
                            </button>
                          ))}
                          <div className="relative">
                            <button
                              type="button"
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
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
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-600">No messages yet.</p>
                )}
              </div>

              <ChatComposer
                conversationId={selectedConversationId}
                isSending={isSending}
                onSend={async ({ body, links }) => {
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
                    setMessagesByConversation((prev) => ({
                      ...prev,
                      [selectedConversationId]: [...(prev[selectedConversationId] || []), message],
                    }));
                    setLatestByConversationId((prev) => ({
                      ...prev,
                      [selectedConversationId]: message,
                    }));
                    setUnreadByConversationId((prev) => ({
                      ...prev,
                      [selectedConversationId]: 0,
                    }));
                    await markConversationRead(selectedConversationId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Unable to send message");
                    throw err;
                  } finally {
                    setIsSending(false);
                  }
                }}
                linkOptions={linkOptions}
              />
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
