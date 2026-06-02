import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";
import { withPerfTiming } from "@/lib/perf";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  buildSocialListUrl,
  normalizeSocialPageNumber,
  SOCIAL_PAGE_SIZE,
} from "./socialListPageUtils";

type SocialPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type SocialPageMemberRow = {
  page_id: string;
  user_id: string;
  role: "member" | "manager";
};

type SocialPostRow = {
  page_id: string;
  created_at: string;
};

type SocialPageReadRow = {
  page_id: string;
  user_id: string;
  last_read_at: string;
};

type SocialPageSummaryRow = {
  page_id: string;
  member_count: number;
  post_total: number;
  latest_post_at: string | null;
  unread_count: number;
};

type SocialLandingPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count: number | string | null;
  post_total: number | string | null;
  latest_post_at: string | null;
  unread_count: number | string | null;
  my_role: "member" | "manager" | null;
  owner_label: string | null;
  owner_avatar_url: string | null;
  total_count: number | string | null;
  posts_last_7d: number | string | null;
  active_pages_last_7d: number | string | null;
};

function toDisplayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function toTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export default async function SocialPage(props: {
  searchParams?: Promise<{ error?: string; success?: string; page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const currentPage = normalizeSocialPageNumber(searchParams?.page);
  const socialOffset = (currentPage - 1) * SOCIAL_PAGE_SIZE;
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = String(authData.user?.id || "").trim();
  const authEmail = authData.user?.email;

  if (!authUserId) {
    redirect("/login");
  }

  const currentUserByAuthIdResult = await supabase
    .from("users")
    .select("id")
    .eq("id", authUserId)
    .maybeSingle();
  const currentUserByEmailResult =
    !currentUserByAuthIdResult.data && authEmail
      ? await supabase
          .from("users")
          .select("id")
          .eq("email", authEmail)
          .maybeSingle()
      : null;
  const currentUser = currentUserByAuthIdResult.data || currentUserByEmailResult?.data || null;

  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const canEditResult = await supabase.rpc("can_edit_page", {
    p_page_key: "social",
  });

  const canEditSocial = canEditResult.error
    ? true
    : Boolean(canEditResult.data);

  const oneWeekAgoTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const oneWeekAgoIso = new Date(oneWeekAgoTimestamp).toISOString();

  let pagesSchemaMissing = false;
  let pages: SocialPageRow[] = [];
  let myMembershipRows: SocialPageMemberRow[] = [];
  let summaryRows: SocialPageSummaryRow[] = [];
  let summaryWarning: string | null = null;
  let socialPerfWarning: string | null = null;
  let totalSocialPages = 0;
  let postsLast7d = 0;
  let activePagesLast7d = 0;

  const ownerLabelById = new Map<string, string>();
  const ownerAvatarById = new Map<string, string>();
  const landingResult = await withPerfTiming("social.page.social_landing_page", () =>
    supabase.rpc("social_landing_page", {
      p_user_id: currentUser.id,
      p_limit: SOCIAL_PAGE_SIZE,
      p_offset: socialOffset,
    })
  );

  const canUseLandingFallback =
    landingResult.error &&
    (isSupabaseMissingFunctionError(landingResult.error) ||
      isSupabaseMissingTableError(landingResult.error));

  if (!landingResult.error) {
    const landingRows = (landingResult.data || []) as SocialLandingPageRow[];
    pages = landingRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    summaryRows = landingRows.map((row) => ({
      page_id: row.id,
      member_count: Number(row.member_count || 1),
      post_total: Number(row.post_total || 0),
      latest_post_at: row.latest_post_at,
      unread_count: Number(row.unread_count || 0),
    }));
    myMembershipRows = landingRows
      .filter((row) => row.my_role === "member" || row.my_role === "manager")
      .map((row) => ({
        page_id: row.id,
        user_id: currentUser.id,
        role: row.my_role as "member" | "manager",
      }));
    landingRows.forEach((row) => {
      ownerLabelById.set(row.created_by, row.owner_label || "Unknown user");
      ownerAvatarById.set(row.created_by, String(row.owner_avatar_url || "").trim());
    });
    totalSocialPages = Number(landingRows[0]?.total_count || 0);
    postsLast7d = Number(landingRows[0]?.posts_last_7d || 0);
    activePagesLast7d = Number(landingRows[0]?.active_pages_last_7d || 0);
  } else if (canUseLandingFallback) {
    pagesSchemaMissing = isSupabaseMissingTableError(landingResult.error);
    if (!pagesSchemaMissing) {
      socialPerfWarning =
        "Social is running in compatibility mode. Run sql/social_landing_page_rpc.sql in Supabase to speed up the Social landing page.";
    }

    const pagesResult = await withPerfTiming("social.page.fallback.pages", () =>
      supabase
        .from("social_pages")
        .select("id,name,description,created_by,created_at,updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(socialOffset, socialOffset + SOCIAL_PAGE_SIZE - 1)
    );

    pagesSchemaMissing = pagesSchemaMissing || isSupabaseMissingTableError(pagesResult.error);
    if (pagesResult.error && !pagesSchemaMissing) {
      summaryWarning = `Could not load Social pages (${pagesResult.error.message}).`;
    }
    pages = pagesSchemaMissing ? [] : ((pagesResult.data || []) as SocialPageRow[]);
    totalSocialPages = pagesResult.count || pages.length;

    const pageIds = pages.map((page) => page.id);
    const [myMembershipResult, summaryResult, postsLast7dResult] = pageIds.length
      ? await Promise.all([
          withPerfTiming("social.page.fallback.my_membership", () =>
            supabase
              .from("social_page_members")
              .select("page_id,user_id,role")
              .eq("user_id", currentUser.id)
              .in("page_id", pageIds)
          ),
          withPerfTiming("social.page.fallback.summaries", () =>
            supabase.rpc("social_page_summaries_for_user", { p_user_id: currentUser.id })
          ),
          withPerfTiming("social.page.fallback.posts_7d", () =>
            supabase
              .from("social_posts")
              .select("id", { head: true, count: "exact" })
              .in("page_id", pageIds)
              .gte("created_at", oneWeekAgoIso)
          ),
        ])
      : [
          { data: [] as SocialPageMemberRow[], error: null },
          { data: [] as SocialPageSummaryRow[], error: null },
          { count: 0, error: null } as { count: number | null; error: null },
        ];

    myMembershipRows = (myMembershipResult.data || []) as SocialPageMemberRow[];
    const summaryRowsRaw = (summaryResult.data || []) as SocialPageSummaryRow[];
    summaryRows = summaryRowsRaw;

    if (summaryResult.error && isSupabaseMissingFunctionError(summaryResult.error)) {
      const [membersFallbackResult, postsFallbackResult, pageReadsFallbackResult] = pageIds.length
        ? await Promise.all([
            withPerfTiming("social.page.fallback.all_members", () =>
              supabase
                .from("social_page_members")
                .select("page_id,user_id,role")
                .in("page_id", pageIds)
            ),
            withPerfTiming("social.page.fallback.posts", () =>
              supabase
                .from("social_posts")
                .select("page_id,created_at")
                .in("page_id", pageIds)
            ),
            withPerfTiming("social.page.fallback.reads", () =>
              supabase
                .from("social_page_reads")
                .select("page_id,user_id,last_read_at")
                .eq("user_id", currentUser.id)
                .in("page_id", pageIds)
            ),
          ])
        : [
            { data: [] as SocialPageMemberRow[], error: null },
            { data: [] as SocialPostRow[], error: null },
            { data: [] as SocialPageReadRow[], error: null },
          ];

      const membersFallback = (membersFallbackResult.data || []) as SocialPageMemberRow[];
      const postsFallback = (postsFallbackResult.data || []) as SocialPostRow[];
      const pageReadsFallback = isSupabaseMissingTableError(pageReadsFallbackResult.error)
        ? []
        : ((pageReadsFallbackResult.data || []) as SocialPageReadRow[]);

      const memberIdsByPage = new Map<string, Set<string>>();
      pages.forEach((page) => {
        memberIdsByPage.set(page.id, new Set([page.created_by]));
      });
      membersFallback.forEach((member) => {
        const bucket = memberIdsByPage.get(member.page_id) || new Set<string>();
        bucket.add(member.user_id);
        memberIdsByPage.set(member.page_id, bucket);
      });

      const postStatsByPage = new Map<string, { total: number; latest: string | null }>();
      postsFallback.forEach((post) => {
        const current = postStatsByPage.get(post.page_id) || { total: 0, latest: null };
        const latest =
          !current.latest || post.created_at > current.latest
            ? post.created_at
            : current.latest;
        postStatsByPage.set(post.page_id, {
          total: current.total + 1,
          latest,
        });
      });

      const pageReadByPage = new Map<string, string>();
      pageReadsFallback.forEach((read) => {
        pageReadByPage.set(read.page_id, read.last_read_at);
      });

      const unreadCountByPage = new Map<string, number>();
      postsFallback.forEach((post) => {
        const lastReadAt = pageReadByPage.get(post.page_id);
        const isUnread = !lastReadAt || toTimestamp(post.created_at) > toTimestamp(lastReadAt);
        if (!isUnread) return;
        unreadCountByPage.set(post.page_id, (unreadCountByPage.get(post.page_id) || 0) + 1);
      });

      summaryRows = pages.map((page) => {
        const postStats = postStatsByPage.get(page.id) || { total: 0, latest: null };
        return {
          page_id: page.id,
          member_count: memberIdsByPage.get(page.id)?.size || 1,
          post_total: postStats.total,
          latest_post_at: postStats.latest,
          unread_count: unreadCountByPage.get(page.id) || 0,
        };
      });
    } else if (summaryResult.error) {
      summaryWarning = `Could not load Social page summaries (${summaryResult.error.message}).`;
    }

    const ownerIds = Array.from(new Set(pages.map((page) => page.created_by)));
    const { data: ownerUsers } = ownerIds.length
      ? await withPerfTiming("social.page.fallback.owners", () =>
          supabase.from("users").select("id,full_name,email,avatar_url").in("id", ownerIds)
        )
      : {
          data: [] as Array<{
            id: string;
            full_name: string | null;
            email: string | null;
            avatar_url: string | null;
          }>,
        };
    (ownerUsers || []).forEach((owner) => {
      ownerLabelById.set(owner.id, owner.full_name || owner.email || "Unknown user");
      ownerAvatarById.set(owner.id, String(owner.avatar_url || "").trim());
    });

    postsLast7d = postsLast7dResult.count || 0;
    activePagesLast7d = pages.filter((page) => {
      const latest = summaryRows.find((row) => row.page_id === page.id)?.latest_post_at;
      return latest ? toTimestamp(latest) >= oneWeekAgoTimestamp : false;
    }).length;
  } else {
    summaryWarning = `Could not load Social pages (${landingResult.error.message}).`;
  }

  if (!pages.length && currentPage > 1) {
    redirect(buildSocialListUrl());
  }

  const previousPageUrl =
    currentPage > 1 ? buildSocialListUrl(currentPage - 1) : null;
  const nextPageUrl =
    currentPage * SOCIAL_PAGE_SIZE < totalSocialPages
      ? buildSocialListUrl(currentPage + 1)
      : null;

  const membershipByPage = new Map<string, SocialPageMemberRow>();
  myMembershipRows.forEach((member) => {
    membershipByPage.set(member.page_id, member);
  });

  const summaryByPage = new Map<string, SocialPageSummaryRow>();
  summaryRows.forEach((row) => {
    summaryByPage.set(row.page_id, row);
  });

  const socialPermissionWarning =
    canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)
      ? `Could not verify Social edit permission (${canEditResult.error.message}).`
      : null;

  if (canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)) {
    logWarn("social.page.permission_check.edit.warning", {
      error: canEditResult.error,
    });
  }

  if (landingResult.error && !canUseLandingFallback) {
    logWarn("social.page.landing_query.warning", {
      error: landingResult.error,
    });
  }

  async function createSocialPage(formData: FormData) {
    "use server";
    const createAttemptId = randomUUID();
    const supabase = createSupabaseServerClient();

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();

    logInfo("social.page.create.start", {
      create_attempt_id: createAttemptId,
      name_length: name.length,
      description_length: description.length,
    });

    if (!name) {
      logWarn("social.page.create.validation_failed", {
        create_attempt_id: createAttemptId,
        reason: "missing_name",
      });
      redirect("/social?error=Page%20name%20is%20required");
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });

    if (canEditResult.error) {
      logError("social.page.create.permission_check_error", {
        create_attempt_id: createAttemptId,
        error: canEditResult.error,
      });
      redirect(`/social?error=${encodeURIComponent(`Could not verify Social edit permission (${canEditResult.error.message})`)}`);
    }

    if (!canEditResult.error && !canEditResult.data) {
      logWarn("social.page.create.permission_denied", {
        create_attempt_id: createAttemptId,
      });
      redirect("/social?error=You%20only%20have%20view%20access%20to%20Social");
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = String(authData.user?.id || "").trim();
    const authEmail = authData.user?.email;

    if (!authUserId) {
      logWarn("social.page.create.unauthenticated", {
        create_attempt_id: createAttemptId,
      });
      redirect("/login");
    }

    const userByAuthIdResult = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (userByAuthIdResult.error) {
      logError("social.page.create.lookup_by_auth_id_error", {
        create_attempt_id: createAttemptId,
        auth_user_id: authUserId,
        error: userByAuthIdResult.error,
      });
      redirect("/social?error=Could%20not%20verify%20your%20user%20profile");
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
      logError("social.page.create.lookup_by_email_error", {
        create_attempt_id: createAttemptId,
        auth_email: authEmail,
        error: userByEmailResult.error,
      });
      redirect("/social?error=Could%20not%20verify%20your%20user%20profile");
    }

    const user = userByAuthIdResult.data || userByEmailResult?.data || null;

    if (!user?.id) {
      logWarn("social.page.create.user_profile_missing", {
        create_attempt_id: createAttemptId,
        auth_user_id: authUserId,
        auth_email: authEmail,
      });
      redirect("/social?error=Missing%20user%20profile");
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch (error) {
      logError("social.page.create.admin_client_missing", {
        create_attempt_id: createAttemptId,
        error,
      });
      redirect("/social?error=Social%20configuration%20is%20incomplete.%20Contact%20support.");
    }

    const { data: insertedPage, error: insertError } = await supabaseAdmin
      .from("social_pages")
      .insert({
        name,
        description: description || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !insertedPage?.id) {
      logError("social.page.create.insert_failed", {
        create_attempt_id: createAttemptId,
        created_by: user.id,
        error: insertError,
      });
      const insertMessage = String(insertError?.message || "Unable to create page");
      const friendlyMessage = /row-level security/i.test(insertMessage)
        ? "Social page creation failed due to a policy mismatch. Contact support if this persists."
        : insertMessage;
      redirect(
        `/social?error=${encodeURIComponent(friendlyMessage)}`
      );
    }

    const { error: addManagerError } = await supabaseAdmin
      .from("social_page_members")
      .upsert(
        {
          page_id: insertedPage.id,
          user_id: user.id,
          role: "manager",
          created_by_user_id: user.id,
        },
        { onConflict: "page_id,user_id" }
      );

    if (addManagerError && !isSupabaseMissingTableError(addManagerError)) {
      logError("social.page.create.add_manager_failed", {
        create_attempt_id: createAttemptId,
        page_id: insertedPage.id,
        user_id: user.id,
        error: addManagerError,
      });
      redirect(`/social?error=${encodeURIComponent(addManagerError.message)}`);
    }

    logInfo("social.page.create.success", {
      create_attempt_id: createAttemptId,
      page_id: insertedPage.id,
      created_by: user.id,
    });

    revalidatePath("/social");
    revalidatePath(`/social/${insertedPage.id}`);
    redirect(`/social/${insertedPage.id}?success=Social%20page%20created`);
  }

  return (
    <div className="space-y-7">
      {(searchParams?.error ||
        searchParams?.success ||
        socialPermissionWarning ||
        socialPerfWarning ||
        summaryWarning) && (
        <div className="space-y-2">
          {socialPermissionWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {socialPermissionWarning}
            </p>
          ) : null}
          {socialPerfWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {socialPerfWarning}
            </p>
          ) : null}
          {summaryWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {summaryWarning}
            </p>
          ) : null}
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pages</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totalSocialPages}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Posts (7d)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{postsLast7d}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Pages (7d)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{activePagesLast7d}</p>
        </article>
      </section>

      {pagesSchemaMissing ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Social is not set up yet. Run <code>sql/social.sql</code> in Supabase SQL editor, then refresh.
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1.15fr_2fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Create a social page</h2>
          <p className="mt-1 text-sm text-slate-600">
            Keep each page focused on one team or initiative.
          </p>

          {!canEditSocial ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You have view-only access to Social.
            </p>
          ) : null}

          <form action={createSocialPage} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Page name
              <input
                name="name"
                maxLength={80}
                placeholder="Example: Product Launch HQ"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                disabled={!canEditSocial}
                required
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Description
              <textarea
                name="description"
                rows={4}
                maxLength={600}
                placeholder="What this page is for and who should be invited."
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                disabled={!canEditSocial}
              />
            </label>
            <button
              type="submit"
              disabled={!canEditSocial}
              className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create page
            </button>
          </form>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Your social pages</h2>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {totalSocialPages} total
            </span>
          </div>

          {pages.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {pages.map((page) => {
                const stat = summaryByPage.get(page.id) || {
                  page_id: page.id,
                  member_count: 1,
                  post_total: 0,
                  latest_post_at: null,
                  unread_count: 0,
                };
                const unreadCount = stat.unread_count;
                const currentMember = membershipByPage.get(page.id);
                const roleLabel =
                  page.created_by === currentUser.id
                    ? "Owner"
                    : currentMember?.role === "manager"
                      ? "Manager"
                      : "Member";
                const ownerLabel = ownerLabelById.get(page.created_by) || "Unknown user";
                const ownerAvatarUrl = ownerAvatarById.get(page.created_by) || "";

                return (
                  <Link
                    key={page.id}
                    href={`/social/${page.id}`}
                    className="group flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 transition hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-2 text-base font-semibold text-slate-900 group-hover:text-slate-950">
                          {page.name}
                        </h3>
                        <div className="flex items-center gap-1.5">
                          {unreadCount > 0 ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              {unreadCount} new
                            </span>
                          ) : null}
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                            {roleLabel}
                          </span>
                        </div>
                      </div>
                      <p className="line-clamp-3 text-sm text-slate-600">
                        {page.description || "No description added yet."}
                      </p>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{stat.member_count} people</span>
                        <span>-</span>
                        <span>{stat.post_total} posts</span>
                        {unreadCount > 0 ? (
                          <>
                            <span>-</span>
                            <span>{unreadCount} unread</span>
                          </>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[10px] font-semibold text-slate-700">
                          {ownerAvatarUrl ? (
                            <Image
                              src={ownerAvatarUrl}
                              alt={`${ownerLabel} avatar`}
                              fill
                              sizes="24px"
                              className="object-cover"
                            />
                          ) : (
                            ownerLabel
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((word) => word.charAt(0).toUpperCase())
                              .join("")
                          )}
                        </span>
                        <p>Owner: {ownerLabel}</p>
                      </div>
                      <p>
                        Last activity:{" "}
                        {stat.latest_post_at ? toDisplayDate(stat.latest_post_at) : toDisplayDate(page.updated_at)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              No social pages yet. Create one to start posting updates and comments.
            </div>
          )}
          {totalSocialPages > SOCIAL_PAGE_SIZE ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
              <p className="text-slate-500">
                Showing {(currentPage - 1) * SOCIAL_PAGE_SIZE + 1}-
                {Math.min(currentPage * SOCIAL_PAGE_SIZE, totalSocialPages)} of{" "}
                {totalSocialPages}
              </p>
              <div className="flex items-center gap-2">
                {previousPageUrl ? (
                  <Link
                    href={previousPageUrl}
                    className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Previous
                  </Link>
                ) : null}
                {nextPageUrl ? (
                  <Link
                    href={nextPageUrl}
                    className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
