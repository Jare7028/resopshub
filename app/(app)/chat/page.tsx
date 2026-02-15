import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { withSignedChatAttachmentUrls } from "@/lib/chatAttachments";
import { sortConversationsByRecentActivity } from "@/lib/chatConversations";
import ChatPageClient from "./ChatPageClient";

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

type DbMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

type DbMessageLinkRow = {
  id: string;
  message_id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  label: string;
};

type DbMessageReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type DbMessageAttachmentRow = {
  id: string;
  message_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

type DbMessageAttachmentWithUrlRow = DbMessageAttachmentRow & {
  url: string | null;
};

function linkHref(link: DbMessageLinkRow, noteClientById: Record<string, string | null>) {
  if (link.entity_type === "task") return `/tasks/${link.entity_id}`;
  if (link.entity_type === "project") return `/projects/${link.entity_id}`;
  if (link.entity_type === "client") return `/clients/${link.entity_id}`;
  if (link.entity_type === "feature_suggestion") {
    return `/feature-suggestions?open=${encodeURIComponent(link.entity_id)}`;
  }
  const clientId = noteClientById[link.entity_id];
  return clientId ? `/clients/${clientId}/notes/${link.entity_id}` : "/notes";
}

export default async function ChatPage(props: {
  searchParams?: Promise<{ c?: string; error?: string; success?: string }>;
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

  const { data: myMembershipsRaw, error: myMembershipsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at")
    .eq("user_id", currentUserId);

  const chatSetupMissing = isSupabaseMissingTableError(myMembershipsError);
  const chatSetupError =
    myMembershipsError && !chatSetupMissing ? myMembershipsError.message : null;

  if (chatSetupMissing || chatSetupError) {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Chat</h1>
          <p className="text-sm text-slate-600">
            Direct and team messaging with structured links.
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
      </div>
    );
  }

  const myMemberships = (myMembershipsRaw || []) as ConversationMemberRow[];
  const myConversationIds = myMemberships.map((row) => row.conversation_id).filter(Boolean);
  const myLastReadByConversationId = myMemberships.reduce<Record<string, string | null>>(
    (acc, row) => {
      acc[row.conversation_id] = row.last_read_at || null;
      return acc;
    },
    {}
  );

  const { data: conversationsRaw } = myConversationIds.length
    ? await supabase
        .from("chat_conversations")
        .select("id,type,title,created_by,created_at")
        .in("id", myConversationIds)
        .order("created_at", { ascending: false })
    : { data: [] as ConversationRow[] };
  const conversations = (conversationsRaw || []) as ConversationRow[];

  const { data: allMembersRaw } = myConversationIds.length
    ? await supabase
        .from("chat_conversation_members")
        .select("conversation_id,user_id,role,last_read_at")
        .in("conversation_id", myConversationIds)
    : { data: [] as ConversationMemberRow[] };
  const allMembers = (allMembersRaw || []) as ConversationMemberRow[];

  const { data: latestMessagesRaw } = myConversationIds.length
    ? await supabase
        .from("chat_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at")
        .in("conversation_id", myConversationIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as DbMessageRow[] };
  const latestMessageByConversationId = ((latestMessagesRaw || []) as DbMessageRow[]).reduce<
    Record<string, DbMessageRow | null>
  >((acc, row) => {
    if (!acc[row.conversation_id]) {
      acc[row.conversation_id] = row;
    }
    return acc;
  }, {});
  const conversationsByRecentActivity = sortConversationsByRecentActivity(
    conversations,
    latestMessageByConversationId
  );

  const selectedConversationIdRaw = String(searchParams?.c || "").trim();
  const selectedConversationId =
    selectedConversationIdRaw && myConversationIds.includes(selectedConversationIdRaw)
      ? selectedConversationIdRaw
      : conversationsByRecentActivity[0]?.id || null;

  const { data: selectedMessagesRaw } = selectedConversationId
    ? await supabase
        .from("chat_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true })
        .limit(300)
    : { data: [] as DbMessageRow[] };
  const selectedMessages = (selectedMessagesRaw || []) as DbMessageRow[];
  const selectedMessageIds = selectedMessages.map((row) => row.id).filter(Boolean);

  const { data: selectedLinksRaw } = selectedMessageIds.length
    ? await supabase
        .from("chat_message_links")
        .select("id,message_id,entity_type,entity_id,label")
        .in("message_id", selectedMessageIds)
    : { data: [] as DbMessageLinkRow[] };
  const selectedLinks = (selectedLinksRaw || []) as DbMessageLinkRow[];

  const { data: selectedReactionsRaw } = selectedMessageIds.length
    ? await supabase
        .from("chat_message_reactions")
        .select("id,message_id,user_id,emoji,created_at")
        .in("message_id", selectedMessageIds)
    : { data: [] as DbMessageReactionRow[] };
  const selectedReactions = (selectedReactionsRaw || []) as DbMessageReactionRow[];

  const { data: selectedAttachmentsRaw, error: selectedAttachmentsError } = selectedMessageIds.length
    ? await supabase
        .from("chat_message_attachments")
        .select("id,message_id,storage_path,filename,mime_type,size_bytes")
        .in("message_id", selectedMessageIds)
    : { data: [] as DbMessageAttachmentRow[], error: null };
  const selectedAttachments =
    selectedAttachmentsError && isSupabaseMissingTableError(selectedAttachmentsError)
      ? ([] as DbMessageAttachmentRow[])
      : ((selectedAttachmentsRaw || []) as DbMessageAttachmentRow[]);
  const selectedAttachmentsWithUrls = await withSignedChatAttachmentUrls(
    supabase.storage,
    selectedAttachments
  );

  const noteIds = Array.from(
    new Set(
      selectedLinks
        .filter((link) => link.entity_type === "note")
        .map((link) => link.entity_id)
        .filter(Boolean)
    )
  );
  const { data: noteRowsRaw } = noteIds.length
    ? await supabase.from("notes").select("id,client_id").in("id", noteIds)
    : { data: [] as Array<{ id: string; client_id: string | null }> };
  const noteClientById = ((noteRowsRaw || []) as Array<{ id: string; client_id: string | null }>).reduce<
    Record<string, string | null>
  >((acc, row) => {
    acc[row.id] = row.client_id;
    return acc;
  }, {});

  const linksByMessageId = selectedLinks.reduce<Record<string, DbMessageLinkRow[]>>((acc, row) => {
    acc[row.message_id] ||= [];
    acc[row.message_id].push(row);
    return acc;
  }, {});
  const reactionsByMessageId = selectedReactions.reduce<
    Record<string, DbMessageReactionRow[]>
  >((acc, row) => {
    acc[row.message_id] ||= [];
    acc[row.message_id].push(row);
    return acc;
  }, {});
  const attachmentsByMessageId = selectedAttachmentsWithUrls.reduce<
    Record<string, DbMessageAttachmentWithUrlRow[]>
  >((acc, row) => {
    acc[row.message_id] ||= [];
    acc[row.message_id].push(row);
    return acc;
  }, {});
  const initialMessages = selectedMessages.map((message) => ({
    ...message,
    links: (linksByMessageId[message.id] || []).map((link) => ({
      id: link.id,
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      label: link.label,
      href: linkHref(link, noteClientById),
    })),
    attachments: attachmentsByMessageId[message.id] || [],
    reactions: reactionsByMessageId[message.id] || [],
  }));

  const { data: tasksRaw } = await supabase
    .from("tasks")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: projectsRaw } = await supabase
    .from("projects")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(100);
  const { data: clientsRaw } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(100);
  const { data: featuresRaw } = await supabase
    .from("feature_suggestions")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: notesRaw } = await supabase
    .from("notes")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(100);

  const linkOptions = {
    task: ((tasksRaw || []) as Array<{ id: string; title: string | null }>).map((row) => ({
      id: row.id,
      label: row.title || "Untitled task",
    })),
    project: ((projectsRaw || []) as Array<{ id: string; name: string | null }>).map((row) => ({
      id: row.id,
      label: row.name || "Untitled project",
    })),
    client: ((clientsRaw || []) as Array<{ id: string; name: string | null }>).map((row) => ({
      id: row.id,
      label: row.name || "Untitled client",
    })),
    feature_suggestion: ((featuresRaw || []) as Array<{ id: string; title: string | null }>).map(
      (row) => ({
        id: row.id,
        label: row.title || "Untitled feature suggestion",
      })
    ),
    note: ((notesRaw || []) as Array<{ id: string; title: string | null }>).map((row) => ({
      id: row.id,
      label: row.title || "Untitled note",
    })),
  } as const;

  const unreadEntries = await Promise.all(
    myConversationIds.map(async (conversationId) => {
      const lastReadAt = myLastReadByConversationId[conversationId];
      let query = supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .neq("sender_id", currentUserId);
      if (lastReadAt) {
        query = query.gt("created_at", lastReadAt);
      }
      const { count } = await query;
      return [conversationId, count || 0] as const;
    })
  );
  const initialUnreadByConversationId = unreadEntries.reduce<Record<string, number>>(
    (acc, [conversationId, count]) => {
      acc[conversationId] = count;
      return acc;
    },
    {}
  );

  return (
    <div className="-mx-6 -my-8 h-[calc(100vh-73px)]">
      <ChatPageClient
        currentUserId={currentUserId}
        users={users}
        initialConversations={conversationsByRecentActivity}
        initialMembers={allMembers}
        initialSelectedConversationId={selectedConversationId}
        initialMessages={initialMessages}
        initialLatestByConversationId={latestMessageByConversationId}
        initialUnreadByConversationId={initialUnreadByConversationId}
        linkOptions={linkOptions}
      />
    </div>
  );
}
