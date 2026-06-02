import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type DirectPairRow = {
  conversation_id: string;
  user_low_id: string;
  user_high_id: string;
};

type MaybeError = { message?: string; code?: string } | null | undefined;

function canonicalDirectPair(leftUserId: string, rightUserId: string) {
  const left = String(leftUserId || "").trim().toLowerCase();
  const right = String(rightUserId || "").trim().toLowerCase();
  if (left <= right) {
    return { userLowId: left, userHighId: right };
  }
  return { userLowId: right, userHighId: left };
}

function isUniqueViolation(error: MaybeError) {
  const code = String(error?.code || "").trim();
  if (code === "23505") return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("duplicate key value") && message.includes("unique constraint");
}

async function loadConversationWithMembers(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conversationId: string
) {
  const { data: conversationRaw, error: conversationError } = await supabase
    .from("chat_conversations")
    .select("id,type,title,created_by,created_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    return {
      error: conversationError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  if (!conversationRaw?.id) {
    return {
      error: null,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const { data: membersRaw, error: membersError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
    .eq("conversation_id", conversationId);

  if (membersError) {
    return {
      error: membersError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  return {
    error: null,
    conversation: conversationRaw as ConversationRow,
    members: (membersRaw || []) as ConversationMemberRow[],
  };
}

async function tryUpsertDirectPair(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  input: { conversationId: string; userLowId: string; userHighId: string }
) {
  const { error } = await supabase.from("chat_direct_pairs").upsert(
    {
      conversation_id: input.conversationId,
      user_low_id: input.userLowId,
      user_high_id: input.userHighId,
    },
    {
      onConflict: "user_low_id,user_high_id",
      ignoreDuplicates: true,
    }
  );

  if (error && !isSupabaseMissingTableError(error)) {
    return { error: error.message };
  }

  return { error: null };
}

async function findExistingDirectConversation(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
  otherUserId: string,
  pair: { userLowId: string; userHighId: string }
) {
  const { data: mappedPairRaw, error: mappedPairError } = await supabase
    .from("chat_direct_pairs")
    .select("conversation_id,user_low_id,user_high_id")
    .eq("user_low_id", pair.userLowId)
    .eq("user_high_id", pair.userHighId)
    .maybeSingle();

  if (mappedPairError && !isSupabaseMissingTableError(mappedPairError)) {
    return {
      error: mappedPairError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const mappedPair = mappedPairRaw as DirectPairRow | null;
  if (mappedPair?.conversation_id) {
    const mappedResult = await loadConversationWithMembers(supabase, mappedPair.conversation_id);
    if (mappedResult.error) {
      return {
        error: mappedResult.error,
        conversation: null as ConversationRow | null,
        members: [] as ConversationMemberRow[],
      };
    }
    if (mappedResult.conversation?.id && mappedResult.conversation.type === "direct") {
      return {
        error: null,
        conversation: mappedResult.conversation,
        members: mappedResult.members,
      };
    }
  }

  const { data: myRowsRaw, error: myRowsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);

  if (myRowsError) {
    return {
      error: myRowsError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const myIds = (myRowsRaw || []).map((row) => row.conversation_id).filter(Boolean) as string[];
  if (!myIds.length) {
    return {
      error: null,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const { data: otherRowsRaw, error: otherRowsError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("user_id", otherUserId)
    .in("conversation_id", myIds);

  if (otherRowsError) {
    return {
      error: otherRowsError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const sharedIds = (otherRowsRaw || []).map((row) => row.conversation_id).filter(Boolean) as string[];
  if (!sharedIds.length) {
    return {
      error: null,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const { data: existingRaw, error: existingError } = await supabase
    .from("chat_conversations")
    .select("id,type,title,created_by,created_at")
    .in("id", sharedIds)
    .eq("type", "direct")
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) {
    return {
      error: existingError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const existingConversation = ((existingRaw || [])[0] || null) as ConversationRow | null;
  if (!existingConversation?.id) {
    return {
      error: null,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  const { data: membersRaw, error: membersError } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
    .eq("conversation_id", existingConversation.id);

  if (membersError) {
    return {
      error: membersError.message,
      conversation: null as ConversationRow | null,
      members: [] as ConversationMemberRow[],
    };
  }

  await tryUpsertDirectPair(supabase, {
    conversationId: existingConversation.id,
    userLowId: pair.userLowId,
    userHighId: pair.userHighId,
  });

  return {
    error: null,
    conversation: existingConversation,
    members: (membersRaw || []) as ConversationMemberRow[],
  };
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "chat.conversations.direct.auth");
  if (auth.response) return auth.response;
  const authUserId = auth.user.id;
  const authEmail = auth.user.email || "";
  if (!authUserId || !authEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();
  const userId = currentUser?.id || authUserId;

  const json = (await req.json().catch(() => null)) as { other_user_id?: string } | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const otherUserId = String(json.other_user_id || "").trim();
  if (!uuidRegex.test(otherUserId) || otherUserId === userId) {
    return NextResponse.json({ error: "Invalid other_user_id" }, { status: 400 });
  }

  const pair = canonicalDirectPair(userId, otherUserId);
  const existingResult = await findExistingDirectConversation(supabase, userId, otherUserId, pair);
  if (existingResult.error) {
    return NextResponse.json({ error: existingResult.error }, { status: 400 });
  }
  if (existingResult.conversation?.id) {
    return NextResponse.json({
      conversation: existingResult.conversation,
      members: existingResult.members,
      existing: true,
    });
  }

  const { data: created, error: createError } = await supabase
    .from("chat_conversations")
    .insert({
      type: "direct",
      title: null,
      created_by: userId,
    })
    .select("id,type,title,created_by,created_at")
    .single();
  if (createError || !created) {
    return NextResponse.json(
      { error: createError?.message || "Unable to create conversation" },
      { status: 400 }
    );
  }

  const cleanupCreatedConversation = async () => {
    await supabase.from("chat_conversations").delete().eq("id", created.id);
  };

  const { error: membersInsertError } = await supabase.from("chat_conversation_members").insert([
    {
      conversation_id: created.id,
      user_id: userId,
      role: "owner",
    },
    {
      conversation_id: created.id,
      user_id: otherUserId,
      role: "member",
    },
  ]);
  if (membersInsertError) {
    await cleanupCreatedConversation();
    return NextResponse.json({ error: membersInsertError.message }, { status: 400 });
  }

  const { error: pairInsertError } = await supabase.from("chat_direct_pairs").insert({
    conversation_id: created.id,
    user_low_id: pair.userLowId,
    user_high_id: pair.userHighId,
  });

  if (pairInsertError && !isSupabaseMissingTableError(pairInsertError)) {
    if (isUniqueViolation(pairInsertError)) {
      await cleanupCreatedConversation();
      const raceWinner = await findExistingDirectConversation(supabase, userId, otherUserId, pair);
      if (raceWinner.error) {
        return NextResponse.json({ error: raceWinner.error }, { status: 400 });
      }
      if (raceWinner.conversation?.id) {
        return NextResponse.json({
          conversation: raceWinner.conversation,
          members: raceWinner.members,
          existing: true,
        });
      }
      return NextResponse.json(
        { error: "A direct chat already exists for this teammate" },
        { status: 409 }
      );
    }
    await cleanupCreatedConversation();
    return NextResponse.json({ error: pairInsertError.message }, { status: 400 });
  }

  const { data: membersRaw } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at,is_pinned,is_muted")
    .eq("conversation_id", created.id);

  return NextResponse.json({
    conversation: created,
    members: membersRaw || [],
    existing: false,
  });
}
