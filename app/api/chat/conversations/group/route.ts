import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData.user?.id;
  const authEmail = authData.user?.email || "";
  if (!authUserId || !authEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();
  const userId = currentUser?.id || authUserId;

  const json = (await req.json().catch(() => null)) as
    | { title?: string; member_user_ids?: string[] }
    | null;
  if (!json) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = String(json.title || "").trim();
  const memberIds = Array.from(
    new Set(
      (Array.isArray(json.member_user_ids) ? json.member_user_ids : [])
        .map((value) => String(value).trim())
        .filter((value) => uuidRegex.test(value) && value !== userId)
    )
  );

  if (!title) {
    return NextResponse.json({ error: "Group name is required" }, { status: 400 });
  }

  const { data: created, error: createError } = await supabase
    .from("chat_conversations")
    .insert({
      type: "group",
      title,
      created_by: userId,
    })
    .select("id,type,title,created_by,created_at")
    .single();
  if (createError || !created) {
    return NextResponse.json(
      { error: createError?.message || "Unable to create group conversation" },
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

  if (memberIds.length) {
    const payload = memberIds.map((memberId) => ({
      conversation_id: created.id,
      user_id: memberId,
      role: "member" as const,
    }));
    const { error: membersError } = await supabase
      .from("chat_conversation_members")
      .insert(payload);
    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 400 });
    }
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
