import { NextResponse } from "next/server";
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

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { sectionId?: string; beforeSectionId?: string | null };
  try {
    payload = (await req.json()) as { sectionId?: string; beforeSectionId?: string | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sectionId = String(payload.sectionId || "").trim();
  const beforeSectionIdRaw = payload.beforeSectionId;
  const beforeSectionId =
    beforeSectionIdRaw === null || beforeSectionIdRaw === undefined
      ? null
      : String(beforeSectionIdRaw).trim() || null;

  if (!sectionId) {
    return NextResponse.json({ error: "Missing section id" }, { status: 400 });
  }

  const { data: currentSection, error: currentSectionError } = await supabase
    .from("personal_sections")
    .select("id,owner_id")
    .eq("id", sectionId)
    .maybeSingle();

  if (currentSectionError) {
    return NextResponse.json({ error: currentSectionError.message }, { status: 400 });
  }
  if (!currentSection) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }
  if (currentSection.owner_id !== user.id) {
    return NextResponse.json(
      { error: "Only the section owner can reorder sections" },
      { status: 403 }
    );
  }

  if (beforeSectionId && beforeSectionId !== sectionId) {
    const { data: targetSection, error: targetSectionError } = await supabase
      .from("personal_sections")
      .select("id,owner_id")
      .eq("id", beforeSectionId)
      .maybeSingle();

    if (targetSectionError) {
      return NextResponse.json({ error: targetSectionError.message }, { status: 400 });
    }
    if (!targetSection) {
      return NextResponse.json({ error: "Target section not found" }, { status: 404 });
    }
    if (targetSection.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Can only reorder within your own sections" },
        { status: 403 }
      );
    }
  }

  const { data: ownerSections, error: ownerSectionsError } = await supabase
    .from("personal_sections")
    .select("id,sort_order,created_at")
    .eq("owner_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (ownerSectionsError) {
    if (isMissingColumnError(ownerSectionsError)) {
      return NextResponse.json(
        {
          error:
            "Manual section ordering needs sql/personal_templates_and_page_order.sql",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: ownerSectionsError.message }, { status: 400 });
  }

  const orderedIds = (ownerSections || []).map((row) => row.id);
  if (!orderedIds.includes(sectionId)) {
    return NextResponse.json({ error: "Section not found in your list" }, { status: 404 });
  }

  const nextIds = orderedIds.filter((id) => id !== sectionId);
  if (beforeSectionId && beforeSectionId !== sectionId) {
    const insertIndex = nextIds.findIndex((id) => id === beforeSectionId);
    if (insertIndex >= 0) {
      nextIds.splice(insertIndex, 0, sectionId);
    } else {
      nextIds.push(sectionId);
    }
  } else {
    nextIds.push(sectionId);
  }

  if (orderedIds.join("|") === nextIds.join("|")) {
    return NextResponse.json({ ok: true });
  }

  for (let index = 0; index < nextIds.length; index += 1) {
    const id = nextIds[index];
    const nextSortOrder = index + 1;
    const { error: updateError } = await supabase
      .from("personal_sections")
      .update({ sort_order: nextSortOrder })
      .eq("id", id)
      .eq("owner_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
