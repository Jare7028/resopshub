import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

async function fetchOwnedPagesBySection(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ownerId: string,
  sectionId: string | null
) {
  let query = supabase
    .from("personal_pages")
    .select("id,section_id,sort_order,created_at")
    .eq("owner_id", ownerId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (sectionId) {
    query = query.eq("section_id", sectionId);
  } else {
    query = query.is("section_id", null);
  }

  return query;
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "personal.pages.reorder.auth");
  if (auth.response) return auth.response;
  const { user } = auth;

  let payload: {
    pageId?: string;
    targetSectionId?: string | null;
    beforePageId?: string | null;
  };

  try {
    payload = (await req.json()) as {
      pageId?: string;
      targetSectionId?: string | null;
      beforePageId?: string | null;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pageId = String(payload.pageId || "").trim();
  const targetSectionIdRaw = payload.targetSectionId;
  const targetSectionId =
    targetSectionIdRaw === null || targetSectionIdRaw === undefined
      ? null
      : String(targetSectionIdRaw).trim() || null;
  const beforePageIdRaw = payload.beforePageId;
  const beforePageId =
    beforePageIdRaw === null || beforePageIdRaw === undefined
      ? null
      : String(beforePageIdRaw).trim() || null;

  if (!pageId) {
    return NextResponse.json({ error: "Missing page id" }, { status: 400 });
  }

  const { data: currentPage, error: currentPageError } = await supabase
    .from("personal_pages")
    .select("id,owner_id,section_id")
    .eq("id", pageId)
    .maybeSingle();

  if (currentPageError) {
    return NextResponse.json({ error: currentPageError.message }, { status: 400 });
  }
  if (!currentPage) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }
  if (currentPage.owner_id !== user.id) {
    return NextResponse.json(
      { error: "Only the page owner can reorder pages" },
      { status: 403 }
    );
  }

  const currentSectionId = currentPage.section_id || null;

  if (targetSectionId) {
    const { data: targetSection, error: targetSectionError } = await supabase
      .from("personal_sections")
      .select("id,owner_id")
      .eq("id", targetSectionId)
      .maybeSingle();

    if (targetSectionError) {
      return NextResponse.json({ error: targetSectionError.message }, { status: 400 });
    }
    if (!targetSection) {
      return NextResponse.json({ error: "Target section not found" }, { status: 404 });
    }
    if (targetSection.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Can only move pages into your own sections" },
        { status: 403 }
      );
    }
  }

  let targetBeforePageId = beforePageId;
  if (targetBeforePageId && targetBeforePageId !== pageId) {
    const { data: beforePage, error: beforePageError } = await supabase
      .from("personal_pages")
      .select("id,owner_id,section_id")
      .eq("id", targetBeforePageId)
      .maybeSingle();

    if (beforePageError) {
      return NextResponse.json({ error: beforePageError.message }, { status: 400 });
    }
    if (!beforePage) {
      targetBeforePageId = null;
    } else if (beforePage.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Can only reorder against your own pages" },
        { status: 403 }
      );
    } else if ((beforePage.section_id || null) !== targetSectionId) {
      return NextResponse.json(
        { error: "Drop target must be in the destination section" },
        { status: 400 }
      );
    }
  } else {
    targetBeforePageId = null;
  }

  const { data: sourcePages, error: sourcePagesError } = await fetchOwnedPagesBySection(
    supabase,
    user.id,
    currentSectionId
  );
  if (sourcePagesError) {
    if (isMissingColumnError(sourcePagesError)) {
      return NextResponse.json(
        {
          error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: sourcePagesError.message }, { status: 400 });
  }

  const sourceIds = (sourcePages || []).map((row) => row.id);
  if (!sourceIds.includes(pageId)) {
    return NextResponse.json({ error: "Page not found in source section" }, { status: 404 });
  }

  let targetIds: string[];
  if (targetSectionId === currentSectionId) {
    targetIds = [...sourceIds];
  } else {
    const { data: targetPages, error: targetPagesError } = await fetchOwnedPagesBySection(
      supabase,
      user.id,
      targetSectionId
    );
    if (targetPagesError) {
      if (isMissingColumnError(targetPagesError)) {
        return NextResponse.json(
          {
            error: "Manual page ordering needs sql/personal_templates_and_page_order.sql",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: targetPagesError.message }, { status: 400 });
    }
    targetIds = (targetPages || []).map((row) => row.id);
  }

  const updates: Array<{ id: string; sectionId: string | null; sortOrder: number }> = [];

  if (targetSectionId === currentSectionId) {
    const nextIds = sourceIds.filter((id) => id !== pageId);
    const insertIndex = targetBeforePageId
      ? nextIds.findIndex((id) => id === targetBeforePageId)
      : -1;
    if (insertIndex >= 0) {
      nextIds.splice(insertIndex, 0, pageId);
    } else {
      nextIds.push(pageId);
    }

    if (nextIds.join("|") === sourceIds.join("|")) {
      return NextResponse.json({ ok: true });
    }

    nextIds.forEach((id, index) => {
      updates.push({ id, sectionId: targetSectionId, sortOrder: index + 1 });
    });
  } else {
    const nextSourceIds = sourceIds.filter((id) => id !== pageId);
    const nextTargetIds = targetIds.filter((id) => id !== pageId);
    const insertIndex = targetBeforePageId
      ? nextTargetIds.findIndex((id) => id === targetBeforePageId)
      : -1;
    if (insertIndex >= 0) {
      nextTargetIds.splice(insertIndex, 0, pageId);
    } else {
      nextTargetIds.push(pageId);
    }

    nextSourceIds.forEach((id, index) => {
      updates.push({ id, sectionId: currentSectionId, sortOrder: index + 1 });
    });
    nextTargetIds.forEach((id, index) => {
      updates.push({ id, sectionId: targetSectionId, sortOrder: index + 1 });
    });
  }

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("personal_pages")
      .update({ section_id: update.sectionId, sort_order: update.sortOrder })
      .eq("id", update.id)
      .eq("owner_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
