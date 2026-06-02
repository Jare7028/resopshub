import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const conversationMemberSelect =
  "conversation_id,user_id,role,last_read_at,is_pinned,is_muted";

type PreferenceUpdateBody = {
  conversation_id?: string;
  is_pinned?: boolean;
  is_muted?: boolean;
};

export async function PATCH(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "chat.conversations.preferences.auth");
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  const json = (await req.json().catch(() => null)) as PreferenceUpdateBody | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = String(json.conversation_id || "").trim();
  if (!uuidRegex.test(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation_id" }, { status: 400 });
  }

  const hasPinned = typeof json.is_pinned === "boolean";
  const hasMuted = typeof json.is_muted === "boolean";
  if (!hasPinned && !hasMuted) {
    return NextResponse.json(
      { error: "At least one preference field is required" },
      { status: 400 }
    );
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

  const updatePayload: {
    is_pinned?: boolean;
    is_muted?: boolean;
  } = {};
  if (hasPinned) {
    updatePayload.is_pinned = Boolean(json.is_pinned);
  }
  if (hasMuted) {
    updatePayload.is_muted = Boolean(json.is_muted);
  }

  const { data: updatedMember, error: updateError } = await supabase
    .from("chat_conversation_members")
    .update(updatePayload)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .select(conversationMemberSelect)
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }
  if (!updatedMember) {
    return NextResponse.json({ error: "Membership not found" }, { status: 404 });
  }

  return NextResponse.json({ member: updatedMember });
}
