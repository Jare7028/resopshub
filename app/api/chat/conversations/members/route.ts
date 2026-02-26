import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MembersMutationBody = {
  conversation_id?: string;
  user_id?: string;
};

type ConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  role: "owner" | "member";
  last_read_at: string | null;
  is_pinned: boolean | null;
  is_muted: boolean | null;
};

async function loadConversationMembers(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conversationId: string
) {
  const { data: membersRaw, error } = await supabase
    .from("chat_conversation_members")
    .select("*")
    .eq("conversation_id", conversationId);

  if (error) {
    return { error: error.message, members: [] as ConversationMemberRow[] };
  }

  return {
    error: null,
    members: (membersRaw || []) as ConversationMemberRow[],
  };
}

async function parseAndValidateBody(req: Request) {
  const json = (await req.json().catch(() => null)) as MembersMutationBody | null;
  if (!json) {
    return { error: "Invalid JSON body", conversationId: "", targetUserId: "" };
  }

  const conversationId = String(json.conversation_id || "").trim();
  const targetUserId = String(json.user_id || "").trim();

  if (!uuidRegex.test(conversationId)) {
    return { error: "Invalid conversation_id", conversationId: "", targetUserId: "" };
  }
  if (!uuidRegex.test(targetUserId)) {
    return { error: "Invalid user_id", conversationId: "", targetUserId: "" };
  }

  return { error: null, conversationId, targetUserId };
}

async function loadConversationContext(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conversationId: string,
  currentUserId: string
) {
  const [{ data: membership }, { data: conversation }] = await Promise.all([
    supabase
      .from("chat_conversation_members")
      .select("conversation_id,user_id,role")
      .eq("conversation_id", conversationId)
      .eq("user_id", currentUserId)
      .maybeSingle(),
    supabase
      .from("chat_conversations")
      .select("id,type")
      .eq("id", conversationId)
      .maybeSingle(),
  ]);

  if (!membership) {
    return { error: "Forbidden", status: 403, membership: null, conversation: null };
  }
  if (!conversation?.id) {
    return { error: "Conversation not found", status: 404, membership: null, conversation: null };
  }
  if (conversation.type !== "group") {
    return {
      error: "Only group chats support member editing",
      status: 400,
      membership: null,
      conversation: null,
    };
  }

  return {
    error: null,
    status: 200,
    membership: membership as { conversation_id: string; user_id: string; role: "owner" | "member" },
    conversation: conversation as { id: string; type: "direct" | "group" },
  };
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const currentUserId = authData.user?.id;
  if (!currentUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await parseAndValidateBody(req);
  if (body.error) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const { conversationId, targetUserId } = body;

  if (targetUserId === currentUserId) {
    return NextResponse.json({ error: "You are already a member" }, { status: 400 });
  }

  const context = await loadConversationContext(supabase, conversationId, currentUserId);
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  if (context.membership?.role !== "owner") {
    return NextResponse.json({ error: "Only group owners can add members" }, { status: 403 });
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!targetUser?.id) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: existingMembership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!existingMembership) {
    const { error: insertError } = await supabase.from("chat_conversation_members").insert({
      conversation_id: conversationId,
      user_id: targetUserId,
      role: "member",
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  const membersResult = await loadConversationMembers(supabase, conversationId);
  if (membersResult.error) {
    return NextResponse.json({ error: membersResult.error }, { status: 400 });
  }
  return NextResponse.json({ members: membersResult.members });
}

export async function DELETE(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const currentUserId = authData.user?.id;
  if (!currentUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await parseAndValidateBody(req);
  if (body.error) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const { conversationId, targetUserId } = body;

  const context = await loadConversationContext(supabase, conversationId, currentUserId);
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  if (context.membership?.role !== "owner") {
    return NextResponse.json({ error: "Only group owners can remove members" }, { status: 403 });
  }
  if (targetUserId === currentUserId) {
    return NextResponse.json({ error: "Owner cannot remove themselves" }, { status: 400 });
  }

  const { data: targetMembership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("chat_conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", targetUserId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const membersResult = await loadConversationMembers(supabase, conversationId);
  if (membersResult.error) {
    return NextResponse.json({ error: membersResult.error }, { status: 400 });
  }
  return NextResponse.json({ members: membersResult.members });
}
