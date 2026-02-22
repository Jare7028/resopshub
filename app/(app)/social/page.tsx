import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";

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
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
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

  const [canViewResult, canEditResult] = await Promise.all([
    supabase.rpc("can_view_page", { p_page_key: "social" }),
    supabase.rpc("can_edit_page", { p_page_key: "social" }),
  ]);

  const canViewSocial = canViewResult.error
    ? true
    : Boolean(canViewResult.data);
  const canEditSocial = canEditResult.error
    ? true
    : Boolean(canEditResult.data);

  if (!canViewSocial) {
    redirect("/dashboard?error=No%20access%20to%20Social");
  }

  const { data: pagesRaw, error: pagesError } = await supabase
    .from("social_pages")
    .select("id,name,description,created_by,created_at,updated_at")
    .order("updated_at", { ascending: false });

  const pagesSchemaMissing = isSupabaseMissingTableError(pagesError);
  const pages = pagesSchemaMissing
    ? []
    : ((pagesRaw || []) as SocialPageRow[]);

  const pageIds = pages.map((page) => page.id);
  const oneWeekAgoTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const oneWeekAgoIso = new Date(oneWeekAgoTimestamp).toISOString();

  const [myMembershipResult, summaryResult, postsLast7dResult] = pageIds.length
    ? await Promise.all([
        supabase
          .from("social_page_members")
          .select("page_id,user_id,role")
          .eq("user_id", currentUser.id)
          .in("page_id", pageIds),
        supabase.rpc("social_page_summaries_for_user", { p_user_id: currentUser.id }),
        supabase
          .from("social_posts")
          .select("id", { head: true, count: "exact" })
          .in("page_id", pageIds)
          .gte("created_at", oneWeekAgoIso),
      ])
    : [
        { data: [] as SocialPageMemberRow[], error: null },
        { data: [] as SocialPageSummaryRow[], error: null },
        { count: 0, error: null } as { count: number | null; error: null },
      ];

  const myMembershipRows = (myMembershipResult.data || []) as SocialPageMemberRow[];
  const summaryRowsRaw = (summaryResult.data || []) as SocialPageSummaryRow[];

  let summaryRows = summaryRowsRaw;
  let summaryWarning: string | null = null;

  if (summaryResult.error && isSupabaseMissingFunctionError(summaryResult.error)) {
    const [membersFallbackResult, postsFallbackResult, pageReadsFallbackResult] = pageIds.length
      ? await Promise.all([
          supabase
            .from("social_page_members")
            .select("page_id,user_id,role")
            .in("page_id", pageIds),
          supabase
            .from("social_posts")
            .select("page_id,created_at")
            .in("page_id", pageIds),
          supabase
            .from("social_page_reads")
            .select("page_id,user_id,last_read_at")
            .eq("user_id", currentUser.id)
            .in("page_id", pageIds),
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
      const latest = !current.latest || post.created_at > current.latest ? post.created_at : current.latest;
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
    ? await supabase.from("users").select("id,full_name,email,avatar_url").in("id", ownerIds)
    : {
        data: [] as Array<{
          id: string;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
        }>,
      };

  const ownerLabelById = new Map<string, string>();
  const ownerAvatarById = new Map<string, string>();
  (ownerUsers || []).forEach((owner) => {
    ownerLabelById.set(owner.id, owner.full_name || owner.email || "Unknown user");
    ownerAvatarById.set(owner.id, String(owner.avatar_url || "").trim());
  });

  const membershipByPage = new Map<string, SocialPageMemberRow>();
  myMembershipRows.forEach((member) => {
    membershipByPage.set(member.page_id, member);
  });

  const summaryByPage = new Map<string, SocialPageSummaryRow>();
  summaryRows.forEach((row) => {
    summaryByPage.set(row.page_id, row);
  });

  const postsLast7d = postsLast7dResult.count || 0;
  const activePagesLast7d = pages.filter((page) => {
    const latest = summaryByPage.get(page.id)?.latest_post_at;
    return latest ? toTimestamp(latest) >= oneWeekAgoTimestamp : false;
  }).length;

  const socialPermissionWarning =
    canViewResult.error && !isSupabaseMissingFunctionError(canViewResult.error)
      ? `Could not verify Social view permission (${canViewResult.error.message}).`
      : canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)
        ? `Could not verify Social edit permission (${canEditResult.error.message}).`
        : null;

  if (canViewResult.error && !isSupabaseMissingFunctionError(canViewResult.error)) {
    logWarn("social.page.permission_check.view.warning", {
      error: canViewResult.error,
    });
  }

  if (canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)) {
    logWarn("social.page.permission_check.edit.warning", {
      error: canEditResult.error,
    });
  }

  if (summaryResult.error && !isSupabaseMissingFunctionError(summaryResult.error)) {
    logWarn("social.page.summary_query.warning", {
      error: summaryResult.error,
    });
  }

  if (postsLast7dResult.error && !isSupabaseMissingTableError(postsLast7dResult.error)) {
    logWarn("social.page.posts_last_7d_query.warning", {
      error: postsLast7dResult.error,
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
      {(searchParams?.error || searchParams?.success || socialPermissionWarning || summaryWarning) && (
        <div className="space-y-2">
          {socialPermissionWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {socialPermissionWarning}
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
          <p className="mt-1 text-2xl font-semibold text-slate-900">{pages.length}</p>
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
              {pages.length} total
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
        </article>
      </section>
    </div>
  );
}
