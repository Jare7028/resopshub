import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { withSignedChatAttachmentUrls } from "@/lib/chatAttachments";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

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
  created_at: string;
};

type DbMessageAttachmentWithUrlRow = DbMessageAttachmentRow & {
  url: string | null;
};

async function getNoteClientMap(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  links: DbMessageLinkRow[]
) {
  const noteIds = Array.from(
    new Set(
      links
        .filter((link) => link.entity_type === "note")
        .map((link) => link.entity_id)
        .filter(Boolean)
    )
  );
  if (!noteIds.length) return {} as Record<string, string | null>;
  const { data } = await supabase.from("notes").select("id,client_id").in("id", noteIds);
  return ((data || []) as Array<{ id: string; client_id: string | null }>).reduce<
    Record<string, string | null>
  >((acc, row) => {
    acc[row.id] = row.client_id;
    return acc;
  }, {});
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

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = String(url.searchParams.get("conversation_id") || "").trim();
  if (!uuidRegex.test(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation_id" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: messagesRaw, error: messagesError } = await supabase
    .from("chat_messages")
    .select("id,conversation_id,sender_id,body,created_at,edited_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 400 });
  }

  const messages = (messagesRaw || []) as Array<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
  }>;
  const messageIds = messages.map((message) => message.id).filter(Boolean);

  const { data: linksRaw } = messageIds.length
    ? await supabase
        .from("chat_message_links")
        .select("id,message_id,entity_type,entity_id,label")
        .in("message_id", messageIds)
    : { data: [] as DbMessageLinkRow[] };
  const links = (linksRaw || []) as DbMessageLinkRow[];
  const noteClientById = await getNoteClientMap(supabase, links);

  const linksByMessageId = links.reduce<Record<string, DbMessageLinkRow[]>>((acc, link) => {
    acc[link.message_id] ||= [];
    acc[link.message_id].push(link);
    return acc;
  }, {});

  let reactionsByMessageId: Record<string, DbMessageReactionRow[]> = {};
  let attachmentsByMessageId: Record<string, DbMessageAttachmentWithUrlRow[]> = {};
  if (messageIds.length) {
    const { data: reactionsRaw, error: reactionsError } = await supabase
      .from("chat_message_reactions")
      .select("id,message_id,user_id,emoji,created_at")
      .in("message_id", messageIds);

    if (reactionsError && !isSupabaseMissingTableError(reactionsError)) {
      return NextResponse.json({ error: reactionsError.message }, { status: 400 });
    }

    if (reactionsRaw?.length) {
      reactionsByMessageId = (reactionsRaw as DbMessageReactionRow[]).reduce<
        Record<string, DbMessageReactionRow[]>
      >((acc, row) => {
        acc[row.message_id] ||= [];
        acc[row.message_id].push(row);
        return acc;
      }, {});
    }

    const { data: attachmentsRaw, error: attachmentsError } = await supabase
      .from("chat_message_attachments")
      .select("id,message_id,storage_path,filename,mime_type,size_bytes,created_at")
      .in("message_id", messageIds);

    if (attachmentsError && !isSupabaseMissingTableError(attachmentsError)) {
      return NextResponse.json({ error: attachmentsError.message }, { status: 400 });
    }

    if (attachmentsRaw?.length) {
      const signedAttachments = await withSignedChatAttachmentUrls(
        supabase.storage,
        attachmentsRaw as DbMessageAttachmentRow[]
      );

      attachmentsByMessageId = signedAttachments.reduce<
        Record<string, DbMessageAttachmentWithUrlRow[]>
      >((acc, row) => {
        acc[row.message_id] ||= [];
        acc[row.message_id].push(row);
        return acc;
      }, {});
    }
  }

  const payload = messages.map((message) => ({
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

  return NextResponse.json({ messages: payload });
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = (await req.json().catch(() => null)) as
    | {
        conversation_id?: string;
        body?: string;
        attachments?: Array<{
          storage_path?: string;
          filename?: string;
          mime_type?: string;
          size_bytes?: number;
        }>;
        links?: Array<{ entity_type?: string; entity_id?: string; label?: string }>;
      }
    | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = String(json.conversation_id || "").trim();
  const body = String(json.body || "").trim();
  const attachmentsRaw = Array.isArray(json.attachments) ? json.attachments : [];
  const linksRaw = Array.isArray(json.links) ? json.links : [];

  if (!uuidRegex.test(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation_id" }, { status: 400 });
  }

  const validLinks = linksRaw
    .map((link) => ({
      entity_type: String(link.entity_type || "") as LinkEntityType,
      entity_id: String(link.entity_id || "").trim(),
      label: String(link.label || "").trim(),
    }))
    .filter((link) => {
      const validType =
        link.entity_type === "task" ||
        link.entity_type === "project" ||
        link.entity_type === "feature_suggestion" ||
        link.entity_type === "note" ||
        link.entity_type === "client";
      return validType && uuidRegex.test(link.entity_id);
    });

  const validAttachments = attachmentsRaw
    .map((attachment) => ({
      storage_path: String(attachment.storage_path || "").trim(),
      filename: String(attachment.filename || "image").trim() || "image",
      mime_type: String(attachment.mime_type || "application/octet-stream").trim(),
      size_bytes: Number(attachment.size_bytes || 0),
    }))
    .filter(
      (attachment) =>
        attachment.storage_path.startsWith(`${conversationId}/${userId}/`) &&
        attachment.size_bytes >= 0
    );

  if (!body && !validLinks.length && !validAttachments.length) {
    return NextResponse.json({ error: "Message or link is required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: createdMessage, error: messageError } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      body: body || "",
    })
    .select("id,conversation_id,sender_id,body,created_at,edited_at")
    .single();
  if (messageError || !createdMessage) {
    return NextResponse.json(
      { error: messageError?.message || "Unable to create message" },
      { status: 400 }
    );
  }

  let createdLinks: DbMessageLinkRow[] = [];
  let createdAttachments: DbMessageAttachmentRow[] = [];
  if (validLinks.length) {
    const payload = validLinks.map((link) => ({
      message_id: createdMessage.id,
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      label: link.label || `${link.entity_type} ${link.entity_id}`,
    }));
    const { data: linksData, error: linksError } = await supabase
      .from("chat_message_links")
      .insert(payload)
      .select("id,message_id,entity_type,entity_id,label");
    if (linksError) {
      return NextResponse.json({ error: linksError.message }, { status: 400 });
    }
    createdLinks = (linksData || []) as DbMessageLinkRow[];
  }

  if (validAttachments.length) {
    const payload = validAttachments.map((attachment) => ({
      message_id: createdMessage.id,
      storage_path: attachment.storage_path,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
    }));

    const { data: attachmentsData, error: attachmentsError } = await supabase
      .from("chat_message_attachments")
      .insert(payload)
      .select("id,message_id,storage_path,filename,mime_type,size_bytes,created_at");

    if (attachmentsError && !isSupabaseMissingTableError(attachmentsError)) {
      return NextResponse.json({ error: attachmentsError.message }, { status: 400 });
    }
    createdAttachments = (attachmentsData || []) as DbMessageAttachmentRow[];
  }

  const noteClientById = await getNoteClientMap(supabase, createdLinks);
  const links = createdLinks.map((link) => ({
    id: link.id,
    entity_type: link.entity_type,
    entity_id: link.entity_id,
    label: link.label,
    href: linkHref(link, noteClientById),
  }));

  return NextResponse.json({
    message: {
      ...createdMessage,
      links,
      attachments: await withSignedChatAttachmentUrls(supabase.storage, createdAttachments),
      reactions: [],
    },
  });
}
