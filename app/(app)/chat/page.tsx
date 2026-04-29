import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import { loadAssignmentGroups } from "@/lib/assignmentGroups";
import { withPerfTiming } from "@/lib/perf";
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

type DbMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
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

const INITIAL_CONVERSATION_MESSAGES_LIMIT = 150;

async function fetchLatestMessageByConversationId(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conversationIds: string[]
) {
  const latestByConversationId: Record<string, DbMessageRow | null> = {};

  await Promise.all(
    conversationIds.map(async (conversationId) => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      latestByConversationId[conversationId] = (data as DbMessageRow | null) || null;
    })
  );

  return latestByConversationId;
}

async function fetchRecentConversationMessages(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conversationId: string,
  limit: number
) {
  const { data } = await supabase
    .from("chat_messages")
    .select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data || []) as DbMessageRow[]).reverse();
}

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
  const authUser = await getCurrentRequestUser(supabase, "chat.page.auth");
  const currentUserId = authUser?.id;
  if (!currentUserId) {
    redirect("/login");
  }

  const { data: usersRaw } = await supabase
    .from("users")
    .select("id,full_name,email,avatar_url")
    .order("full_name", { ascending: true });
  const users = (usersRaw || []) as UserRow[];
  const assignmentGroupsResult = await loadAssignmentGroups(supabase);
  const assignmentGroups = assignmentGroupsResult.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
  })) as AssignmentGroupOption[];

  const { data: myMembershipsRaw, error: myMembershipsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
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

  const selectedConversationIdRaw = String(searchParams?.c || "").trim();
  const preselectedConversationId =
    selectedConversationIdRaw && myConversationIds.includes(selectedConversationIdRaw)
      ? selectedConversationIdRaw
      : null;

  const conversationsPromise = myConversationIds.length
    ? supabase
        .from("chat_conversations")
        .select("id,type,title,created_by,created_at")
        .in("id", myConversationIds)
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [] as ConversationRow[] });

  const allMembersPromise = myConversationIds.length
    ? supabase
        .from("chat_conversation_members")
        .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
        .in("conversation_id", myConversationIds)
    : Promise.resolve({ data: [] as ConversationMemberRow[] });

  const latestMessagesPromise = myConversationIds.length
    ? fetchLatestMessageByConversationId(supabase, myConversationIds)
    : Promise.resolve({} as Record<string, DbMessageRow | null>);

  const unreadRowsPromise = withPerfTiming("chat.page.unread.rpc", () =>
    supabase.rpc("chat_unread_counts")
  );

  const preselectedMessagesPromise = preselectedConversationId
    ? fetchRecentConversationMessages(
        supabase,
        preselectedConversationId,
        INITIAL_CONVERSATION_MESSAGES_LIMIT
      )
    : Promise.resolve([] as DbMessageRow[]);

  const [
    { data: conversationsRaw },
    { data: allMembersRaw },
    latestMessageByConversationId,
    { data: unreadRowsRaw, error: unreadRowsError },
    preselectedMessagesRaw,
  ] = await Promise.all([
    conversationsPromise,
    allMembersPromise,
    latestMessagesPromise,
    unreadRowsPromise,
    preselectedMessagesPromise,
  ]);

  const conversations = (conversationsRaw || []) as ConversationRow[];
  const allMembers = (allMembersRaw || []) as ConversationMemberRow[];
  const conversationsByRecentActivity = sortConversationsByRecentActivity(
    conversations,
    latestMessageByConversationId
  );

  const selectedConversationId =
    preselectedConversationId || conversationsByRecentActivity[0]?.id || null;

  const selectedMessagesRaw =
    selectedConversationId === preselectedConversationId
      ? preselectedMessagesRaw
      : selectedConversationId
        ? await fetchRecentConversationMessages(
            supabase,
            selectedConversationId,
            INITIAL_CONVERSATION_MESSAGES_LIMIT
          )
        : [];
  const selectedMessages = (selectedMessagesRaw || []) as DbMessageRow[];
  const selectedMessageIds = selectedMessages.map((row) => row.id).filter(Boolean);

  const [
    { data: selectedLinksRaw },
    { data: selectedReactionsRaw },
    { data: selectedAttachmentsRaw, error: selectedAttachmentsError },
  ] = selectedMessageIds.length
    ? await Promise.all([
        supabase
          .from("chat_message_links")
          .select("id,message_id,entity_type,entity_id,label")
          .in("message_id", selectedMessageIds),
        supabase
          .from("chat_message_reactions")
          .select("id,message_id,user_id,emoji,created_at")
          .in("message_id", selectedMessageIds),
        supabase
          .from("chat_message_attachments")
          .select("id,message_id,storage_path,filename,mime_type,size_bytes")
          .in("message_id", selectedMessageIds),
      ])
    : [
        { data: [] as DbMessageLinkRow[] },
        { data: [] as DbMessageReactionRow[] },
        { data: [] as DbMessageAttachmentRow[], error: null },
      ];

  const selectedLinks = (selectedLinksRaw || []) as DbMessageLinkRow[];
  const selectedReactions = (selectedReactionsRaw || []) as DbMessageReactionRow[];

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

  const initialUnreadByConversationId: Record<string, number> = {};

  if (!unreadRowsError) {
    const unreadByConversationId = ((unreadRowsRaw || []) as Array<{
      conversation_id: string;
      unread_count: number | null;
    }>).reduce<Record<string, number>>((acc, row) => {
      acc[row.conversation_id] = Number(row.unread_count || 0);
      return acc;
    }, {});
    myConversationIds.forEach((conversationId) => {
      initialUnreadByConversationId[conversationId] = unreadByConversationId[conversationId] || 0;
    });
  } else if (isSupabaseMissingFunctionError(unreadRowsError)) {
    // Fallback for environments that haven't applied sql/chat_unread_counts.sql yet.
    const myLastReadByConversationId = myMemberships.reduce<Record<string, string | null>>(
      (acc, row) => {
        acc[row.conversation_id] = row.last_read_at || null;
        return acc;
      },
      {}
    );
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
    unreadEntries.forEach(([conversationId, count]) => {
      initialUnreadByConversationId[conversationId] = count;
    });
  } else {
    myConversationIds.forEach((conversationId) => {
      initialUnreadByConversationId[conversationId] = 0;
    });
  }

  return (
    <div className="-mx-6 -my-8 h-[calc(100vh-73px)]">
      <ChatPageClient
        currentUserId={currentUserId}
        users={users}
        groups={assignmentGroups}
        initialConversations={conversationsByRecentActivity}
        initialMembers={allMembers}
        initialSelectedConversationId={selectedConversationId}
        initialMessages={initialMessages}
        initialLatestByConversationId={latestMessageByConversationId}
        initialUnreadByConversationId={initialUnreadByConversationId}
      />
    </div>
  );
}
