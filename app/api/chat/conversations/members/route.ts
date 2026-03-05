import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveAssignmentTargetsToUserIds } from "@/lib/assignmentGroups";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MembersMutationBody = {
  conversation_id?: string;
  user_id?: string;
  target_id?: string;
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
    .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
    .eq("conversation_id", conversationId);

  if (error) {
    return { error: error.message, members: [] as ConversationMemberRow[] };
  }

  return {
    error: null,
    members: (membersRaw || []) as ConversationMemberRow[],
  };
}

async function parseConversationBody(req: Request) {
  const json = (await req.json().catch(() => null)) as MembersMutationBody | null;
  if (!json) {
    return { error: "Invalid JSON body", conversationId: "", json: null as MembersMutationBody | null };
  }

  const conversationId = String(json.conversation_id || "").trim();
  if (!uuidRegex.test(conversationId)) {
    return { error: "Invalid conversation_id", conversationId: "", json };
  }

  return { error: null, conversationId, json };
}

async function parseAndValidateAddBody(req: Request) {
  const base = await parseConversationBody(req);
  if (base.error || !base.json) {
    return { error: base.error, conversationId: "", targetValue: "" };
  }

  const targetValue = String(base.json.target_id || base.json.user_id || "").trim();
  if (!targetValue) {
    return { error: "Missing target_id", conversationId: "", targetValue: "" };
  }

  return { error: null, conversationId: base.conversationId, targetValue };
}

async function parseAndValidateDeleteBody(req: Request) {
  const base = await parseConversationBody(req);
  if (base.error || !base.json) {
    return { error: base.error, conversationId: "", targetUserId: "" };
  }

  const targetUserId = String(base.json.user_id || "").trim();
  if (!uuidRegex.test(targetUserId)) {
    return { error: "Invalid user_id", conversationId: "", targetUserId: "" };
  }

  return { error: null, conversationId: base.conversationId, targetUserId };
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

  const body = await parseAndValidateAddBody(req);
  if (body.error) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const { conversationId, targetValue } = body;

  const context = await loadConversationContext(supabase, conversationId, currentUserId);
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  if (context.membership?.role !== "owner") {
    return NextResponse.json({ error: "Only group owners can add members" }, { status: 403 });
  }

  const targetResolution = await resolveAssignmentTargetsToUserIds(supabase, [targetValue]);
  if (targetResolution.error) {
    return NextResponse.json({ error: targetResolution.error }, { status: 400 });
  }
  const targetUserIds = Array.from(
    new Set(targetResolution.userIds.filter((userId) => uuidRegex.test(userId) && userId !== currentUserId))
  );

  if (!targetUserIds.length) {
    return NextResponse.json({ error: "No members found for this selection" }, { status: 400 });
  }

  const { data: existingMembershipRows } = await supabase
    .from("chat_conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .in("user_id", targetUserIds);
  const existingUserIds = new Set(
    (existingMembershipRows || [])
      .map((row) => String((row as { user_id?: string }).user_id || "").trim())
      .filter(Boolean)
  );

  const missingUserIds = targetUserIds.filter((userId) => !existingUserIds.has(userId));

  if (missingUserIds.length) {
    const { error: insertError } = await supabase.from("chat_conversation_members").insert(
      missingUserIds.map((userId) => ({
        conversation_id: conversationId,
        user_id: userId,
        role: "member" as const,
      }))
    );
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

  const body = await parseAndValidateDeleteBody(req);
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
