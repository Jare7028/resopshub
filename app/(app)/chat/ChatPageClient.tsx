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

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  links: MessageLinkRow[];
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
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingDirect, setIsCreatingDirect] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [searchChats, setSearchChats] = useState("");
  const [addMode, setAddMode] = useState<"direct" | "group">("direct");

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

  const selectConversation = async (conversationId: string) => {
    setError("");
    setSuccess("");
    setSelectedConversationId(conversationId);
    syncUrl(conversationId);
    if (!messagesByConversation[conversationId]) {
      try {
        await fetchMessages(conversationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load messages");
      }
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

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <aside className="space-y-4 lg:col-span-4">
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
                const formData = new FormData(event.currentTarget);
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
                  event.currentTarget.reset();
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
                const formData = new FormData(event.currentTarget);
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
                  event.currentTarget.reset();
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

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Chats</h2>
            <input
              value={searchChats}
              onChange={(event) => setSearchChats(event.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
            />
          </div>
          <div className="max-h-[520px] overflow-y-auto">
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
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {getConversationTitle(conversation)}
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
      </aside>

      <section className="lg:col-span-8">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
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
            <div className="space-y-4 px-5 py-4">
              <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                {selectedMessages.length ? (
                  selectedMessages.map((message) => {
                    const senderName = getUserDisplayName(userById[message.sender_id]);
                    return (
                      <article
                        key={message.id}
                        className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
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
