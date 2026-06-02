import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEmoji(value: string) {
  return value.trim().slice(0, 16);
}

async function canAccessMessage(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  messageId: string,
  userId: string
) {
  const { data: messageRow } = await supabase
    .from("chat_messages")
    .select("id,conversation_id")
    .eq("id", messageId)
    .maybeSingle();

  if (!messageRow?.conversation_id) {
    return { ok: false, conversationId: null };
  }

  const { data: membership } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", messageRow.conversation_id)
    .eq("user_id", userId)
    .maybeSingle();

  return { ok: Boolean(membership), conversationId: messageRow.conversation_id as string };
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "chat.reactions.create.auth");
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  const json = (await req.json().catch(() => null)) as
    | {
        message_id?: string;
        emoji?: string;
      }
    | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messageId = String(json.message_id || "").trim();
  const emoji = normalizeEmoji(String(json.emoji || ""));
  if (!uuidRegex.test(messageId) || !emoji) {
    return NextResponse.json({ error: "Invalid message_id or emoji" }, { status: 400 });
  }

  const access = await canAccessMessage(supabase, messageId, userId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: createdReaction, error } = await supabase
    .from("chat_message_reactions")
    .upsert(
      {
        message_id: messageId,
        user_id: userId,
        emoji,
      },
      {
        onConflict: "message_id,user_id,emoji",
        ignoreDuplicates: true,
      }
    )
    .select("id,message_id,user_id,emoji,created_at")
    .single();

  if (error || !createdReaction) {
    return NextResponse.json({ error: error?.message || "Unable to add reaction" }, { status: 400 });
  }

  return NextResponse.json({ reaction: createdReaction });
}

export async function DELETE(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "chat.reactions.delete.auth");
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  const json = (await req.json().catch(() => null)) as
    | {
        message_id?: string;
        emoji?: string;
      }
    | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messageId = String(json.message_id || "").trim();
  const emoji = normalizeEmoji(String(json.emoji || ""));
  if (!uuidRegex.test(messageId) || !emoji) {
    return NextResponse.json({ error: "Invalid message_id or emoji" }, { status: 400 });
  }

  const access = await canAccessMessage(supabase, messageId, userId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("chat_message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

