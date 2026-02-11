import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import ChatComposer, { type LinkEntityType } from "./ChatComposer";

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

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

type MessageLinkRow = {
  id: string;
  message_id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
};

type NoteLookupRow = {
  id: string;
  client_id: string | null;
  title: string | null;
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function chatUrl(params: { c?: string; error?: string; success?: string }) {
  const sp = new URLSearchParams();
  if (params.c) sp.set("c", params.c);
  if (params.error) sp.set("error", params.error);
  if (params.success) sp.set("success", params.success);
  const qs = sp.toString();
  return qs ? `/chat?${qs}` : "/chat";
}

export default async function ChatPage(props: {
  searchParams?: Promise<{
    c?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const currentUserId = authData.user?.id;

  if (!currentUserId) {
    redirect("/login");
  }

  const { data: usersRaw } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const users = (usersRaw || []) as UserRow[];
  const userById = users.reduce<Record<string, UserRow>>((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const { data: myMembershipsRaw, error: myMembershipsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at")
    .eq("user_id", currentUserId);

  const chatSetupMissing = isSupabaseMissingTableError(myMembershipsError);
  const chatSetupError =
    myMembershipsError && !chatSetupMissing ? myMembershipsError.message : null;

  const myMemberships = chatSetupError
    ? ([] as ConversationMemberRow[])
    : ((myMembershipsRaw || []) as ConversationMemberRow[]);
  const myConversationIds = myMemberships.map((row) => row.conversation_id).filter(Boolean);

  const { data: conversationsRaw } = myConversationIds.length
    ? await supabase
        .from("chat_conversations")
        .select("id,type,title,created_by,created_at")
        .in("id", myConversationIds)
        .order("created_at", { ascending: false })
    : { data: [] as ConversationRow[] };

  const conversations = (conversationsRaw || []) as ConversationRow[];

  const { data: allConversationMembersRaw } = myConversationIds.length
    ? await supabase
        .from("chat_conversation_members")
        .select("conversation_id,user_id,role,last_read_at")
        .in("conversation_id", myConversationIds)
    : { data: [] as ConversationMemberRow[] };

  const allConversationMembers = (allConversationMembersRaw || []) as ConversationMemberRow[];
  const membersByConversationId = allConversationMembers.reduce<
    Record<string, ConversationMemberRow[]>
  >((acc, row) => {
    acc[row.conversation_id] ||= [];
    acc[row.conversation_id].push(row);
    return acc;
  }, {});

  const { data: latestMessagesRaw } = myConversationIds.length
    ? await supabase
        .from("chat_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at")
        .in("conversation_id", myConversationIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as MessageRow[] };

  const latestMessageByConversationId = ((latestMessagesRaw || []) as MessageRow[]).reduce<
    Record<string, MessageRow>
  >((acc, row) => {
    if (!acc[row.conversation_id]) {
      acc[row.conversation_id] = row;
    }
    return acc;
  }, {});

  const selectedConversationIdRaw = String(searchParams?.c || "").trim();
  const selectedConversationId =
    selectedConversationIdRaw && myConversationIds.includes(selectedConversationIdRaw)
      ? selectedConversationIdRaw
      : conversations[0]?.id || null;

  const selectedConversation =
    selectedConversationId
      ? conversations.find((conversation) => conversation.id === selectedConversationId) || null
      : null;

  const selectedMembers = selectedConversationId
    ? membersByConversationId[selectedConversationId] || []
    : [];

  const { data: messagesRaw } = selectedConversationId
    ? await supabase
        .from("chat_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true })
        .limit(300)
    : { data: [] as MessageRow[] };

  const messages = (messagesRaw || []) as MessageRow[];
  const messageIds = messages.map((message) => message.id).filter(Boolean);

  const { data: messageLinksRaw } = messageIds.length
    ? await supabase
        .from("chat_message_links")
        .select("id,message_id,entity_type,entity_id,label")
        .in("message_id", messageIds)
    : { data: [] as MessageLinkRow[] };

  const messageLinks = (messageLinksRaw || []) as MessageLinkRow[];
  const linksByMessageId = messageLinks.reduce<Record<string, MessageLinkRow[]>>((acc, link) => {
    acc[link.message_id] ||= [];
    acc[link.message_id].push(link);
    return acc;
  }, {});

  const noteLinkIds = Array.from(
    new Set(
      messageLinks
        .filter((link) => link.entity_type === "note")
        .map((link) => link.entity_id)
        .filter(Boolean)
    )
  );

  const { data: noteLookupRaw } = noteLinkIds.length
    ? await supabase
        .from("notes")
        .select("id,client_id,title")
        .in("id", noteLinkIds)
    : { data: [] as NoteLookupRow[] };

  const noteLookupById = ((noteLookupRaw || []) as NoteLookupRow[]).reduce<
    Record<string, NoteLookupRow>
  >((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const getConversationTitle = (conversation: ConversationRow) => {
    if (conversation.type === "group") {
      return conversation.title || "Untitled group";
    }
    const members = membersByConversationId[conversation.id] || [];
    const other = members.find((member) => member.user_id !== currentUserId);
    return getUserDisplayName(userById[other?.user_id || ""]);
  };

  const getLinkHref = (link: MessageLinkRow) => {
    if (link.entity_type === "task") return `/tasks/${link.entity_id}`;
    if (link.entity_type === "project") return `/projects/${link.entity_id}`;
    if (link.entity_type === "client") return `/clients/${link.entity_id}`;
    if (link.entity_type === "feature_suggestion") {
      return `/feature-suggestions?open=${encodeURIComponent(link.entity_id)}`;
    }
    const note = noteLookupById[link.entity_id];
    if (note?.client_id) {
      return `/clients/${note.client_id}/notes/${link.entity_id}`;
    }
    return "/notes";
  };

  const { data: tasksForLinkRaw } = await supabase
    .from("tasks")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: projectsForLinkRaw } = await supabase
    .from("projects")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(100);
  const { data: clientsForLinkRaw } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(100);
  const { data: featuresForLinkRaw } = await supabase
    .from("feature_suggestions")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: notesForLinkRaw } = await supabase
    .from("notes")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);

  const linkOptions = {
    task: ((tasksForLinkRaw || []) as Array<{ id: string; title: string | null }>).map(
      (row) => ({
        id: row.id,
        label: row.title || "Untitled task",
      })
    ),
    project: ((projectsForLinkRaw || []) as Array<{ id: string; name: string | null }>).map(
      (row) => ({
        id: row.id,
        label: row.name || "Untitled project",
      })
    ),
    client: ((clientsForLinkRaw || []) as Array<{ id: string; name: string | null }>).map(
      (row) => ({
        id: row.id,
        label: row.name || "Untitled client",
      })
    ),
    feature_suggestion: (
      (featuresForLinkRaw || []) as Array<{ id: string; title: string | null }>
    ).map((row) => ({
      id: row.id,
      label: row.title || "Untitled feature suggestion",
    })),
    note: ((notesForLinkRaw || []) as Array<{ id: string; title: string | null }>).map((row) => ({
      id: row.id,
      label: row.title || "Untitled note",
    })),
  } as const;

  async function createDirectConversation(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) redirect("/login");

    const otherUserId = String(formData.get("other_user_id") || "").trim();
    if (!otherUserId || !uuidRegex.test(otherUserId) || otherUserId === userId) {
      redirect(chatUrl({ error: "Select a valid teammate" }));
    }

    const { data: myRowsRaw } = await supabase
      .from("chat_conversation_members")
      .select("conversation_id")
      .eq("user_id", userId);

    const myIds = (myRowsRaw || [])
      .map((row) => row.conversation_id)
      .filter(Boolean) as string[];

    if (myIds.length) {
      const { data: otherRowsRaw } = await supabase
        .from("chat_conversation_members")
        .select("conversation_id")
        .eq("user_id", otherUserId)
        .in("conversation_id", myIds);
      const sharedIds = (otherRowsRaw || [])
        .map((row) => row.conversation_id)
        .filter(Boolean) as string[];
      if (sharedIds.length) {
        const { data: existingRaw } = await supabase
          .from("chat_conversations")
          .select("id,type")
          .in("id", sharedIds)
          .eq("type", "direct")
          .limit(1);
        const existing = (existingRaw || [])[0];
        if (existing?.id) {
          redirect(chatUrl({ c: existing.id }));
        }
      }
    }

    const { data: created, error: createError } = await supabase
      .from("chat_conversations")
      .insert({
        type: "direct",
        title: null,
        created_by: userId,
      })
      .select("id")
      .single();

    if (createError || !created?.id) {
      redirect(chatUrl({ error: createError?.message || "Unable to create conversation" }));
    }

    const { error: selfMemberError } = await supabase.from("chat_conversation_members").insert({
      conversation_id: created.id,
      user_id: userId,
      role: "owner",
    });
    if (selfMemberError) {
      redirect(chatUrl({ error: selfMemberError.message }));
    }

    const { error: otherMemberError } = await supabase.from("chat_conversation_members").insert({
      conversation_id: created.id,
      user_id: otherUserId,
      role: "member",
    });
    if (otherMemberError) {
      redirect(chatUrl({ error: otherMemberError.message }));
    }

    revalidatePath("/chat");
    redirect(chatUrl({ c: created.id, success: "Direct chat created" }));
  }

  async function createGroupConversation(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) redirect("/login");

    const title = String(formData.get("title") || "").trim();
    const rawMemberIds = formData
      .getAll("member_user_ids")
      .map((value) => String(value).trim())
      .filter((value) => uuidRegex.test(value));

    const memberIds = Array.from(new Set(rawMemberIds.filter((value) => value !== userId)));

    if (!title) {
      redirect(chatUrl({ error: "Group name is required" }));
    }

    const { data: created, error: createError } = await supabase
      .from("chat_conversations")
      .insert({
        type: "group",
        title,
        created_by: userId,
      })
      .select("id")
      .single();

    if (createError || !created?.id) {
      redirect(chatUrl({ error: createError?.message || "Unable to create group" }));
    }

    const { error: selfMemberError } = await supabase.from("chat_conversation_members").insert({
      conversation_id: created.id,
      user_id: userId,
      role: "owner",
    });
    if (selfMemberError) {
      redirect(chatUrl({ error: selfMemberError.message }));
    }

    if (memberIds.length) {
      const payload = memberIds.map((memberId) => ({
        conversation_id: created.id,
        user_id: memberId,
        role: "member" as const,
      }));
      const { error: memberInsertError } = await supabase
        .from("chat_conversation_members")
        .insert(payload);
      if (memberInsertError) {
        redirect(chatUrl({ error: memberInsertError.message }));
      }
    }

    revalidatePath("/chat");
    redirect(chatUrl({ c: created.id, success: "Group chat created" }));
  }

  async function sendMessage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) redirect("/login");

    const conversationId = String(formData.get("conversation_id") || "").trim();
    const body = String(formData.get("message_body") || "").trim();

    const entityTypes = formData
      .getAll("link_entity_type")
      .map((value) => String(value).trim()) as LinkEntityType[];
    const entityIds = formData
      .getAll("link_entity_id")
      .map((value) => String(value).trim());
    const labels = formData.getAll("link_label").map((value) => String(value).trim());

    const validLinks: Array<{ entity_type: LinkEntityType; entity_id: string; label: string }> = [];

    for (let idx = 0; idx < entityTypes.length; idx += 1) {
      const entityType = entityTypes[idx];
      const entityId = entityIds[idx] || "";
      const label = labels[idx] || "";
      const isValidType =
        entityType === "task" ||
        entityType === "project" ||
        entityType === "feature_suggestion" ||
        entityType === "note" ||
        entityType === "client";
      if (!isValidType || !uuidRegex.test(entityId)) continue;
      validLinks.push({
        entity_type: entityType,
        entity_id: entityId,
        label: label || `${typeLabel[entityType]} ${entityId}`,
      });
    }

    if (!conversationId || !uuidRegex.test(conversationId)) {
      redirect(chatUrl({ error: "Missing conversation" }));
    }

    const { data: membership } = await supabase
      .from("chat_conversation_members")
      .select("conversation_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!membership) {
      redirect(chatUrl({ error: "You are not a member of that conversation" }));
    }

    if (!body && !validLinks.length) {
      redirect(chatUrl({ c: conversationId, error: "Message or link is required" }));
    }

    const { data: createdMessage, error: messageError } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        body: body || "",
      })
      .select("id")
      .single();

    if (messageError || !createdMessage?.id) {
      redirect(chatUrl({ c: conversationId, error: messageError?.message || "Unable to send message" }));
    }

    if (validLinks.length) {
      const payload = validLinks.map((link) => ({
        message_id: createdMessage.id,
        entity_type: link.entity_type,
        entity_id: link.entity_id,
        label: link.label,
      }));
      const { error: linksError } = await supabase.from("chat_message_links").insert(payload);
      if (linksError) {
        redirect(chatUrl({ c: conversationId, error: linksError.message }));
      }
    }

    revalidatePath("/chat");
    redirect(chatUrl({ c: conversationId }));
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Chat</h1>
        <p className="text-sm text-slate-600">
          Direct and team messaging with structured links to tasks, projects, clients, notes,
          and feature suggestions.
        </p>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}
      {searchParams?.success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {searchParams.success}
        </p>
      ) : null}

      {chatSetupMissing ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Chat tables are not set up yet. Run <code>sql/chat.sql</code> in Supabase SQL editor,
          then refresh this page.
        </p>
      ) : null}

      {chatSetupError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {chatSetupError}
        </p>
      ) : null}

      {!chatSetupMissing && !chatSetupError ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <aside className="space-y-4 lg:col-span-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Start direct chat</h2>
              <form action={createDirectConversation} className="mt-3 space-y-2">
                <select
                  name="other_user_id"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Start chat
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Create group chat</h2>
              <form action={createGroupConversation} className="mt-3 space-y-2">
                <input
                  name="title"
                  placeholder="Group name"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
                <select
                  name="member_user_ids"
                  multiple
                  size={6}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {users
                    .filter((user) => user.id !== currentUserId)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-slate-500">
                  Hold Ctrl/Cmd to select multiple members.
                </p>
                <button
                  type="submit"
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Create group
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Conversations</h2>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {conversations.length ? (
                  conversations.map((conversation) => {
                    const isActive = selectedConversationId === conversation.id;
                    const latest = latestMessageByConversationId[conversation.id];
                    const latestSender = latest ? getUserDisplayName(userById[latest.sender_id]) : "";
                    const latestLine = latest
                      ? `${latestSender}: ${latest.body || "[link]"}`
                      : "No messages yet";
                    return (
                      <Link
                        key={conversation.id}
                        href={chatUrl({ c: conversation.id })}
                        className={`block border-b border-slate-100 px-4 py-3 hover:bg-slate-50 ${
                          isActive ? "bg-slate-50" : ""
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          {getConversationTitle(conversation)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-slate-600">{latestLine}</div>
                      </Link>
                    );
                  })
                ) : (
                  <p className="px-4 py-4 text-sm text-slate-600">No conversations yet.</p>
                )}
              </div>
            </section>
          </aside>

          <section className="lg:col-span-8">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-900">
                  {selectedConversation ? getConversationTitle(selectedConversation) : "Select chat"}
                </h2>
                {selectedMembers.length ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Members:{" "}
                    {selectedMembers
                      .map((member) => getUserDisplayName(userById[member.user_id]))
                      .join(", ")}
                  </p>
                ) : null}
              </div>

              {selectedConversationId ? (
                <div className="space-y-3 px-4 py-4">
                  <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-3">
                    {messages.length ? (
                      messages.map((message) => {
                        const senderName = getUserDisplayName(userById[message.sender_id]);
                        const links = linksByMessageId[message.id] || [];
                        return (
                          <article key={message.id} className="rounded-md border border-slate-200 bg-white p-3">
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
                            {links.length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {links.map((link) => (
                                  <Link
                                    key={link.id}
                                    href={getLinkHref(link)}
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
                    submitAction={sendMessage}
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
      ) : null}
    </div>
  );
}

