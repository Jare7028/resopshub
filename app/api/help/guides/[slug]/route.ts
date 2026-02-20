import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { normalizeHelpGuide } from "@/app/(app)/help/_data/guides";
import {
  ensureUniqueGuideRouteSlug,
  normalizeGuideRouteSlugFromTitle,
} from "@/app/(app)/help/_lib/guideSingleDoc";
import { loadHelpGuides } from "@/lib/helpGuidesStore";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

function normalizeStorageSlug(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = String(authData.user?.id || "").trim();

  if (!authUserId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id,role")
    .eq("id", authUserId)
    .maybeSingle();

  if (userError) {
    if (isSupabaseMissingTableError(userError)) {
      return {
        response: NextResponse.json(
          { error: "Users table is missing. Run sql/permissions_admin_member.sql first." },
          { status: 503 }
        ),
      };
    }
    return {
      response: NextResponse.json({ error: userError.message }, { status: 500 }),
    };
  }

  if (user?.role !== "admin") {
    return {
      response: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
    };
  }

  return {
    supabase,
    appUserId: user.id,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug: rawStorageSlug } = await context.params;
  const storageSlug = normalizeStorageSlug(rawStorageSlug);
  if (!storageSlug) {
    return NextResponse.json({ error: "Guide storage slug is required." }, { status: 400 });
  }

  const admin = await requireAdmin();
  if ("response" in admin) {
    return admin.response;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const payloadObject =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const normalizedGuide = normalizeHelpGuide(payloadObject);

  if (!normalizedGuide) {
    return NextResponse.json(
      {
        error:
          "Guide format is invalid. Include title, summary, audience, estimated time, keywords, prerequisites, and at least one section.",
      },
      { status: 400 }
    );
  }

  const { guides } = await loadHelpGuides();
  const existingGuide = guides.find((guide) => guide.storageSlug === storageSlug) || null;
  const previousRouteSlug = existingGuide?.slug || storageSlug;

  const usedRouteSlugs = new Set(
    guides
      .filter((guide) => guide.storageSlug !== storageSlug)
      .map((guide) => guide.slug)
  );

  const desiredRouteSlug = normalizeGuideRouteSlugFromTitle(normalizedGuide.title);
  const nextRouteSlug = ensureUniqueGuideRouteSlug(desiredRouteSlug, usedRouteSlugs);
  const guideToSave = {
    ...normalizedGuide,
    slug: nextRouteSlug,
  };

  const { error } = await admin.supabase.from("help_guides").upsert(
    {
      slug: storageSlug,
      guide: guideToSave,
      updated_by_user_id: admin.appUserId,
    },
    { onConflict: "slug" }
  );
  if (error) {
    if (isSupabaseMissingTableError(error)) {
      return NextResponse.json(
        { error: "Help guides table is missing. Run sql/help_guides.sql first." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/help");
  revalidatePath(`/help/${previousRouteSlug}`);
  revalidatePath(`/help/${nextRouteSlug}`);

  return NextResponse.json({ guide: guideToSave, storageSlug });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug: rawStorageSlug } = await context.params;
  const storageSlug = normalizeStorageSlug(rawStorageSlug);
  if (!storageSlug) {
    return NextResponse.json({ error: "Guide storage slug is required." }, { status: 400 });
  }

  const admin = await requireAdmin();
  if ("response" in admin) {
    return admin.response;
  }

  const { guides } = await loadHelpGuides();
  const previousRouteSlug =
    guides.find((guide) => guide.storageSlug === storageSlug)?.slug || storageSlug;

  const { error } = await admin.supabase.from("help_guides").delete().eq("slug", storageSlug);
  if (error && !isSupabaseMissingTableError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/help");
  revalidatePath(`/help/${storageSlug}`);
  revalidatePath(`/help/${previousRouteSlug}`);

  return NextResponse.json({ ok: true });
}

