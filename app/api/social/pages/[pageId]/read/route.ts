import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/requireApiUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { logError, logWarn } from "@/lib/vercelLogger";

const PAGE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPostIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => PAGE_ID_REGEX.test(item))
    )
  ).slice(0, 100);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  const requestId = randomUUID();
  const params = await context.params;
  const pageId = String(params.pageId || "").trim();

  if (!PAGE_ID_REGEX.test(pageId)) {
    return NextResponse.json({ error: "Invalid page id" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const auth = await requireApiUser(supabase, "social.pages.read.auth");
  if (auth.response) return auth.response;
  const authUserId = String(auth.user.id || "").trim();
  const authEmail = auth.user.email;

  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageAccessResult = await supabase.rpc("can_access_social_page", {
    social_page_uuid: pageId,
  });
  if (pageAccessResult.error) {
    logError("social.read_tracking.page_access_check_error", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: authUserId,
      error: pageAccessResult.error,
    });
    return NextResponse.json({ error: "Could not verify page access" }, { status: 500 });
  }
  if (!pageAccessResult.data) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userByAuthIdResult = await supabase
    .from("users")
    .select("id")
    .eq("id", authUserId)
    .maybeSingle();
  if (userByAuthIdResult.error) {
    logError("social.read_tracking.lookup_by_auth_id_error", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: authUserId,
      error: userByAuthIdResult.error,
    });
    return NextResponse.json({ error: "Could not verify user profile" }, { status: 500 });
  }

  const userByEmailResult =
    !userByAuthIdResult.data && authEmail
      ? await supabase
          .from("users")
          .select("id")
          .eq("email", authEmail)
          .maybeSingle()
      : null;
  if (userByEmailResult?.error) {
    logError("social.read_tracking.lookup_by_email_error", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: authUserId,
      auth_email: authEmail,
      error: userByEmailResult.error,
    });
    return NextResponse.json({ error: "Could not verify user profile" }, { status: 500 });
  }

  const appUserId = String(userByAuthIdResult.data?.id || userByEmailResult?.data?.id || "").trim();
  if (!appUserId) {
    logWarn("social.read_tracking.user_profile_missing", {
      request_id: requestId,
      page_id: pageId,
      auth_user_id: authUserId,
      auth_email: authEmail,
    });
    return NextResponse.json({ error: "Missing user profile" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    postIds?: unknown;
  };
  const requestedPostIds = toPostIds(body.postIds || []);

  const nowIso = new Date().toISOString();
  const pageReadUpsertResult = await supabase.from("social_page_reads").upsert(
    {
      page_id: pageId,
      user_id: appUserId,
      last_read_at: nowIso,
    },
    { onConflict: "page_id,user_id" }
  );
  if (pageReadUpsertResult.error && !isSupabaseMissingTableError(pageReadUpsertResult.error)) {
    logError("social.read_tracking.page_read_upsert_error", {
      request_id: requestId,
      page_id: pageId,
      user_id: appUserId,
      error: pageReadUpsertResult.error,
    });
    return NextResponse.json({ error: pageReadUpsertResult.error.message }, { status: 500 });
  }

  if (requestedPostIds.length) {
    const validPostsResult = await supabase
      .from("social_posts")
      .select("id")
      .eq("page_id", pageId)
      .in("id", requestedPostIds);
    if (validPostsResult.error) {
      logError("social.read_tracking.valid_post_lookup_error", {
        request_id: requestId,
        page_id: pageId,
        user_id: appUserId,
        post_count: requestedPostIds.length,
        error: validPostsResult.error,
      });
      return NextResponse.json({ error: validPostsResult.error.message }, { status: 500 });
    }

    const validPostIds = Array.from(
      new Set((validPostsResult.data || []).map((row) => String(row.id || "").trim()).filter(Boolean))
    );

    if (validPostIds.length) {
      const postViewUpsertResult = await supabase.from("social_post_views").upsert(
        validPostIds.map((postId) => ({
          post_id: postId,
          user_id: appUserId,
          viewed_at: nowIso,
        })),
        { onConflict: "post_id,user_id" }
      );

      if (postViewUpsertResult.error && !isSupabaseMissingTableError(postViewUpsertResult.error)) {
        logError("social.read_tracking.post_view_upsert_error", {
          request_id: requestId,
          page_id: pageId,
          user_id: appUserId,
          post_count: validPostIds.length,
          error: postViewUpsertResult.error,
        });
        return NextResponse.json({ error: postViewUpsertResult.error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
