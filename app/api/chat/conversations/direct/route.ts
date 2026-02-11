import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = (await req.json().catch(() => null)) as { other_user_id?: string } | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const otherUserId = String(json.other_user_id || "").trim();
  if (!uuidRegex.test(otherUserId) || otherUserId === userId) {
    return NextResponse.json({ error: "Invalid other_user_id" }, { status: 400 });
  }

  const { data: myRowsRaw } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  const myIds = (myRowsRaw || []).map((row) => row.conversation_id).filter(Boolean) as string[];

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
        .select("id,type,title,created_by,created_at")
        .in("id", sharedIds)
        .eq("type", "direct")
        .limit(1);
      const existing = (existingRaw || [])[0];
      if (existing?.id) {
        const { data: membersRaw } = await supabase
          .from("chat_conversation_members")
          .select("conversation_id,user_id,role,last_read_at")
          .eq("conversation_id", existing.id);
        return NextResponse.json({
          conversation: existing,
          members: membersRaw || [],
        });
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
    .select("id,type,title,created_by,created_at")
    .single();
  if (createError || !created) {
    return NextResponse.json(
      { error: createError?.message || "Unable to create conversation" },
      { status: 400 }
    );
  }

  const { error: selfError } = await supabase.from("chat_conversation_members").insert({
    conversation_id: created.id,
    user_id: userId,
    role: "owner",
  });
  if (selfError) {
    return NextResponse.json({ error: selfError.message }, { status: 400 });
  }

  const { error: otherError } = await supabase.from("chat_conversation_members").insert({
    conversation_id: created.id,
    user_id: otherUserId,
    role: "member",
  });
  if (otherError) {
    return NextResponse.json({ error: otherError.message }, { status: 400 });
  }

  const { data: membersRaw } = await supabase
    .from("chat_conversation_members")
    .select("conversation_id,user_id,role,last_read_at")
    .eq("conversation_id", created.id);

  return NextResponse.json({
    conversation: created,
    members: membersRaw || [],
  });
}

