import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPlainText } from "@/lib/tiptapText";

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  const params = await context.params;
  const sourcePageId = String(params.pageId || "").trim();
  if (!sourcePageId) {
    return NextResponse.json({ error: "Missing page id" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "personal.pages.duplicate.auth");
  if (auth.response) return auth.response;
  const { user } = auth;

  const { data: sourcePage, error: sourceError } = await supabase
    .from("personal_pages")
    .select("id,title,section_id,content")
    .eq("id", sourcePageId)
    .maybeSingle();

  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 400 });
  }

  if (!sourcePage) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  let nextSortOrder: number | null = null;
  let nextSortRequest = supabase
    .from("personal_pages")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  if (sourcePage.section_id) {
    nextSortRequest = nextSortRequest.eq("section_id", sourcePage.section_id);
  } else {
    nextSortRequest = nextSortRequest.is("section_id", null);
  }

  const { data: lastPageRows, error: lastPageError } = await nextSortRequest;
  if (lastPageError && !isMissingColumnError(lastPageError)) {
    return NextResponse.json({ error: lastPageError.message }, { status: 400 });
  }
  if (!lastPageError) {
    const lastSort = Number(lastPageRows?.[0]?.sort_order || 0);
    nextSortOrder = lastSort + 1;
  }

  const sourceContent =
    sourcePage.content && typeof sourcePage.content === "object"
      ? sourcePage.content
      : null;
  const content = sourceContent || { type: "doc", content: [{ type: "paragraph" }] };
  const contentText = extractPlainText(content);

  const insertPayload: Record<string, unknown> = {
    title: `Copy of ${sourcePage.title || "Untitled"}`,
    section_id: sourcePage.section_id,
    owner_id: user.id,
    share_mode: "private",
    content,
    content_text: contentText,
    updated_at: new Date().toISOString(),
  };
  if (nextSortOrder !== null) {
    insertPayload.sort_order = nextSortOrder;
  }

  const { data: createdPage, error: createError } = await supabase
    .from("personal_pages")
    .insert(insertPayload)
    .select("id")
    .single();

  if (createError && isMissingColumnError(createError)) {
    delete insertPayload.sort_order;
    const { data: fallbackCreatedPage, error: fallbackCreateError } = await supabase
      .from("personal_pages")
      .insert(insertPayload)
      .select("id")
      .single();
    if (fallbackCreateError) {
      return NextResponse.json({ error: fallbackCreateError.message }, { status: 400 });
    }
    return NextResponse.json({ id: fallbackCreatedPage.id });
  }

  if (createError || !createdPage) {
    return NextResponse.json(
      { error: createError?.message || "Unable to duplicate page" },
      { status: 400 }
    );
  }

  return NextResponse.json({ id: createdPage.id });
}
