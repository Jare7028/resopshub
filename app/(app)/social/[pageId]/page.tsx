import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyMentionedUsersFromTextChange } from "@/lib/mentionNotifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { splitSocialInlineContent, stripSocialInlineImageTokens } from "@/lib/socialPostContent";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError, isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";
import RouteModalOverlay from "../../_components/RouteModalOverlay";
import SocialCommentComposer from "../_components/SocialCommentComposer";
import SocialPostComposer from "../_components/SocialPostComposer";
import SocialReadTracker from "../_components/SocialReadTracker";

type SocialPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type SocialPageMemberRow = {
  id: string;
  page_id: string;
  user_id: string;
  role: "member" | "manager";
  created_at: string;
};

type SocialPostRow = {
  id: string;
  page_id: string;
  user_id: string;
  body: string;
  is_pinned: boolean;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
};

type SocialPostImageRow = {
  id: string;
  post_id: string;
  storage_path: string;
  url: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
};

type SocialPostCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
};

type SocialPostViewRow = {
  post_id: string;
  user_id: string;
  viewed_at: string;
};

type SocialPostReactionRow = {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type SocialCommentReactionRow = {
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type SocialPageReadRow = {
  page_id: string;
  user_id: string;
  last_read_at: string;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  avatar_url: string | null;
};

type PostImageInput = {
  storage_path: string;
  url: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

type SocialPostFilter = "all" | "pinned" | "mine" | "unread";
type SocialDetailPanel = "none" | "compose" | "edit";

const SOCIAL_REACTION_OPTIONS = ["👍", "❤️", "🎉", "🔥", "👏"] as const;
const SOCIAL_POSTS_PAGE_SIZE = 20;
const SOCIAL_REACTION_OPTION_SET = new Set<string>(SOCIAL_REACTION_OPTIONS);

function parsePostImagesJson(raw: string): PostImageInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const uniquePaths = new Set<string>();
  const normalized = parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const storagePath = String(row.storage_path || "").trim();
      const url = String(row.url || "").trim();
      if (!storagePath || !url) return null;

      const filename = String(row.filename || "image").trim() || "image";
      const mimeType = String(row.mime_type || "application/octet-stream").trim() || "application/octet-stream";
      const sizeRaw = Number(row.size_bytes);
      const sizeBytes = Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.round(sizeRaw) : 0;

      return {
        storage_path: storagePath,
        url,
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
      } satisfies PostImageInput;
    })
    .filter((item): item is PostImageInput => Boolean(item))
    .filter((item) => {
      if (uniquePaths.has(item.storage_path)) return false;
      uniquePaths.add(item.storage_path);
      return true;
    });

  return normalized.slice(0, 6);
}

function toUserLabel(user: { full_name: string | null; email: string | null } | null | undefined) {
  if (!user) return "Unknown user";
  return user.full_name || user.email || "Unknown user";
}

function toInitials(label: string) {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

function toAvatarUrl(user: { avatar_url: string | null } | null | undefined) {
  return String(user?.avatar_url || "").trim();
}

function toDateTimeLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function toViewerSummary(viewerLabels: string[]) {
  if (!viewerLabels.length) return "No views yet";
  if (viewerLabels.length === 1) return `Seen by ${viewerLabels[0]}`;
  if (viewerLabels.length === 2) return `Seen by ${viewerLabels[0]} and ${viewerLabels[1]}`;
  return `Seen by ${viewerLabels[0]}, ${viewerLabels[1]} +${viewerLabels.length - 2}`;
}

function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizePostFilter(value: string): SocialPostFilter {
  if (value === "pinned") return "pinned";
  if (value === "mine") return "mine";
  if (value === "unread") return "unread";
  return "all";
}

function normalizeRole(value: string): "member" | "manager" {
  return value === "manager" ? "manager" : "member";
}

function normalizeSocialPanel(value: string): SocialDetailPanel {
  if (value === "compose") return "compose";
  if (value === "edit") return "edit";
  return "none";
}

async function resolveActingUser(supabaseClient: ReturnType<typeof createSupabaseServerClient>) {
  const { data: authData } = await supabaseClient.auth.getUser();
  const resolvedAuthUserId = String(authData.user?.id || "").trim();
  const resolvedAuthEmail = authData.user?.email;
  if (!resolvedAuthUserId) {
    return null;
  }

  const userByAuthIdResult = await supabaseClient
    .from("users")
    .select("id")
    .eq("id", resolvedAuthUserId)
    .maybeSingle();

  const userByEmailResult =
    !userByAuthIdResult.data && resolvedAuthEmail
      ? await supabaseClient
          .from("users")
          .select("id")
          .eq("email", resolvedAuthEmail)
          .maybeSingle()
      : null;

  const user = userByAuthIdResult.data || userByEmailResult?.data || null;
  if (!user?.id) {
    return null;
  }

  return {
    authUserId: resolvedAuthUserId,
    authEmail: resolvedAuthEmail,
    userId: user.id,
  };
}

function buildSocialDetailUrl(
  pageId: string,
  extra?: { error?: string; success?: string },
  options?: { q?: string; filter?: SocialPostFilter; p?: number; panel?: SocialDetailPanel | null }
) {
  const params = new URLSearchParams();
  const q = String(options?.q || "").trim();
  const filter = options?.filter || "all";
  const page = Math.max(1, Number(options?.p || 1));
  const panel = options?.panel && options.panel !== "none" ? options.panel : null;
  if (q) params.set("q", q);
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("p", String(page));
  if (panel) params.set("panel", panel);
  if (extra?.error) params.set("error", extra.error);
  if (extra?.success) params.set("success", extra.success);
  const query = params.toString();
  return query ? `/social/${pageId}?${query}` : `/social/${pageId}`;
}

export default async function SocialPageDetail(props: {
  params: Promise<{ pageId: string }>;
  searchParams?: Promise<{ error?: string; success?: string; q?: string; filter?: string; p?: string; panel?: string }>;
}) {
  const { pageId } = await props.params;
  const searchParams = await props.searchParams;
  const searchQuery = String(searchParams?.q || "").trim();
  const postFilter = normalizePostFilter(String(searchParams?.filter || ""));
  const parsedPage = Number(searchParams?.p || "1");
  const panel = normalizeSocialPanel(String(searchParams?.panel || ""));
  const postPageNumber = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  const listQueryState = {
    q: searchQuery,
    filter: postFilter,
    p: postPageNumber,
  } satisfies { q: string; filter: SocialPostFilter; p: number };

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

  const { data: page, error: pageError } = await supabase
    .from("social_pages")
    .select("id,name,description,created_by,created_at,updated_at")
    .eq("id", pageId)
    .maybeSingle();

  if (pageError) {
    redirect(`/social?error=${encodeURIComponent(pageError.message)}`);
  }

  if (!page) {
    redirect("/social?error=Social%20page%20not%20found%20or%20no%20access");
  }

  const socialPage = page as SocialPageRow;

  const [canManageResult, canEditResult] = await Promise.all([
    supabase.rpc("can_manage_social_page", { social_page_uuid: pageId }),
    supabase.rpc("can_edit_page", { p_page_key: "social" }),
  ]);

  const canManagePage = canManageResult.error
    ? socialPage.created_by === currentUser.id
    : Boolean(canManageResult.data);
  const canPost = canEditResult.error ? true : Boolean(canEditResult.data);

  const pageReadResult = await supabase
    .from("social_page_reads")
    .select("page_id,user_id,last_read_at")
    .eq("page_id", pageId)
    .eq("user_id", currentUser.id)
    .maybeSingle();
  const pageReadSchemaMissing = isSupabaseMissingTableError(pageReadResult.error);
  const previousPageReadAt = pageReadSchemaMissing
    ? null
    : String((pageReadResult.data as SocialPageReadRow | null)?.last_read_at || "").trim() || null;

  const postsOffset = (postPageNumber - 1) * SOCIAL_POSTS_PAGE_SIZE;
  let postsQuery = supabase
    .from("social_posts")
    .select("id,page_id,user_id,body,is_pinned,pinned_at,created_at,updated_at", { count: "exact" })
    .eq("page_id", pageId);

  if (postFilter === "pinned") {
    postsQuery = postsQuery.eq("is_pinned", true);
  } else if (postFilter === "mine") {
    postsQuery = postsQuery.eq("user_id", currentUser.id);
  } else if (postFilter === "unread" && previousPageReadAt) {
    postsQuery = postsQuery.gt("created_at", previousPageReadAt);
  }

  if (searchQuery) {
    postsQuery = postsQuery.ilike("body", `%${searchQuery}%`);
  }

  const [membersResult, postsResult, totalPostsResult, unreadPostsResult] = await Promise.all([
    supabase
      .from("social_page_members")
      .select("id,page_id,user_id,role,created_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: true }),
    postsQuery
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(postsOffset, postsOffset + SOCIAL_POSTS_PAGE_SIZE - 1),
    supabase
      .from("social_posts")
      .select("id", { head: true, count: "exact" })
      .eq("page_id", pageId),
    previousPageReadAt
      ? supabase
          .from("social_posts")
          .select("id", { head: true, count: "exact" })
          .eq("page_id", pageId)
          .gt("created_at", previousPageReadAt)
      : Promise.resolve({ count: null, error: null } as { count: number | null; error: null }),
  ]);

  const members = (membersResult.data || []) as SocialPageMemberRow[];
  const posts = (postsResult.data || []) as SocialPostRow[];
  const filteredPostCount = postsResult.count || 0;
  const totalPostPages = Math.max(1, Math.ceil(filteredPostCount / SOCIAL_POSTS_PAGE_SIZE));
  const postIds = posts.map((post) => post.id);

  if (postPageNumber > totalPostPages && filteredPostCount > 0) {
    redirect(
      buildSocialDetailUrl(pageId, undefined, {
        q: searchQuery,
        filter: postFilter,
        p: totalPostPages,
      })
    );
  }

  const [imagesResult, commentsResult] = postIds.length
    ? await Promise.all([
        supabase
          .from("social_post_images")
          .select("id,post_id,storage_path,url,filename,mime_type,size_bytes,position")
          .in("post_id", postIds)
          .order("position", { ascending: true }),
        supabase
          .from("social_post_comments")
          .select("id,post_id,user_id,body,parent_comment_id,created_at,updated_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true }),
      ])
    : [
        { data: [] as SocialPostImageRow[], error: null },
        { data: [] as SocialPostCommentRow[], error: null },
      ];

  const postImages = (imagesResult.data || []) as SocialPostImageRow[];
  const postComments = (commentsResult.data || []) as SocialPostCommentRow[];

  const postViewsResult = postIds.length
    ? await supabase
        .from("social_post_views")
        .select("post_id,user_id,viewed_at")
        .in("post_id", postIds)
        .order("viewed_at", { ascending: false })
    : { data: [] as SocialPostViewRow[], error: null };
  const postViewsSchemaMissing = isSupabaseMissingTableError(postViewsResult.error);
  const postViews = postViewsSchemaMissing ? [] : ((postViewsResult.data || []) as SocialPostViewRow[]);

  const commentIds = postComments.map((comment) => comment.id);
  const [postReactionsResult, commentReactionsResult] = postIds.length
    ? await Promise.all([
        supabase
          .from("social_post_reactions")
          .select("post_id,user_id,emoji,created_at")
          .in("post_id", postIds),
        commentIds.length
          ? supabase
              .from("social_comment_reactions")
              .select("comment_id,user_id,emoji,created_at")
              .in("comment_id", commentIds)
          : Promise.resolve({ data: [] as SocialCommentReactionRow[], error: null }),
      ])
    : [
        { data: [] as SocialPostReactionRow[], error: null },
        { data: [] as SocialCommentReactionRow[], error: null },
      ];
  const postReactionsSchemaMissing = isSupabaseMissingTableError(postReactionsResult.error);
  const commentReactionsSchemaMissing = isSupabaseMissingTableError(commentReactionsResult.error);
  const postReactions = postReactionsSchemaMissing
    ? []
    : ((postReactionsResult.data || []) as SocialPostReactionRow[]);
  const commentReactions = commentReactionsSchemaMissing
    ? []
    : ((commentReactionsResult.data || []) as SocialCommentReactionRow[]);

  const actorIds = Array.from(
    new Set([
      socialPage.created_by,
      ...members.map((member) => member.user_id),
      ...posts.map((post) => post.user_id),
      ...postComments.map((comment) => comment.user_id),
      ...postViews.map((view) => view.user_id),
      ...postReactions.map((reaction) => reaction.user_id),
      ...commentReactions.map((reaction) => reaction.user_id),
    ])
  );

  const [participantsResult, allUsersResult] = await Promise.all([
    actorIds.length
      ? supabase
          .from("users")
          .select("id,full_name,email,status,avatar_url")
          .in("id", actorIds)
      : Promise.resolve({ data: [] as UserRow[], error: null }),
    canManagePage
      ? supabase
          .from("users")
          .select("id,full_name,email,status,avatar_url")
          .eq("status", "active")
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] as UserRow[], error: null }),
  ]);

  const participantUsers = (participantsResult.data || []) as UserRow[];
  const allUsers = (allUsersResult.data || []) as UserRow[];

  const userById = new Map<string, UserRow>();
  participantUsers.forEach((user) => userById.set(user.id, user));
  allUsers.forEach((user) => {
    if (!userById.has(user.id)) {
      userById.set(user.id, user);
    }
  });

  const memberUserIds = new Set<string>(members.map((member) => member.user_id));
  memberUserIds.add(socialPage.created_by);

  const availableUsers = canManagePage
    ? allUsers
        .filter((user) => user.id !== socialPage.created_by)
        .filter((user) => !memberUserIds.has(user.id))
        .sort((left, right) =>
          toUserLabel(left).toLowerCase().localeCompare(toUserLabel(right).toLowerCase())
        )
    : [];

  const imagesByPostId = new Map<string, SocialPostImageRow[]>();
  postImages.forEach((image) => {
    const bucket = imagesByPostId.get(image.post_id) || [];
    bucket.push(image);
    imagesByPostId.set(image.post_id, bucket);
  });

  const commentsByPostId = new Map<string, SocialPostCommentRow[]>();
  postComments.forEach((comment) => {
    const bucket = commentsByPostId.get(comment.post_id) || [];
    bucket.push(comment);
    commentsByPostId.set(comment.post_id, bucket);
  });

  const viewsByPostId = new Map<string, SocialPostViewRow[]>();
  postViews.forEach((view) => {
    const bucket = viewsByPostId.get(view.post_id) || [];
    bucket.push(view);
    viewsByPostId.set(view.post_id, bucket);
  });

  const postReactionsByPostId = new Map<string, SocialPostReactionRow[]>();
  postReactions.forEach((reaction) => {
    const bucket = postReactionsByPostId.get(reaction.post_id) || [];
    bucket.push(reaction);
    postReactionsByPostId.set(reaction.post_id, bucket);
  });

  const commentReactionsByCommentId = new Map<string, SocialCommentReactionRow[]>();
  commentReactions.forEach((reaction) => {
    const bucket = commentReactionsByCommentId.get(reaction.comment_id) || [];
    bucket.push(reaction);
    commentReactionsByCommentId.set(reaction.comment_id, bucket);
  });

  const filteredPosts = posts;
  const hasPreviousPage = postPageNumber > 1;
  const hasNextPage = postPageNumber < totalPostPages;

  const permissionWarning =
    canManageResult.error && !isSupabaseMissingFunctionError(canManageResult.error)
      ? `Could not verify page management permission (${canManageResult.error.message}).`
      : canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)
        ? `Could not verify page edit permission (${canEditResult.error.message}).`
        : null;

  const dataWarning =
    membersResult.error ||
    postsResult.error ||
    totalPostsResult.error ||
    (previousPageReadAt ? unreadPostsResult.error : null) ||
    imagesResult.error ||
    commentsResult.error ||
    (!pageReadSchemaMissing ? pageReadResult.error : null) ||
    (!postViewsSchemaMissing ? postViewsResult.error : null) ||
    (!postReactionsSchemaMissing ? postReactionsResult.error : null) ||
    (!commentReactionsSchemaMissing ? commentReactionsResult.error : null);

  async function createPost(formData: FormData) {
    "use server";
    const actionId = randomUUID();
    const supabase = createSupabaseServerClient();

    const body = String(formData.get("body") || "").trim();
    const imagesJson = String(formData.get("images_json") || "[]");
    const parsedImages = parsePostImagesJson(imagesJson);

    logInfo("social.post.create.start", {
      action_id: actionId,
      page_id: pageId,
      body_length: body.length,
      uploaded_image_count: parsedImages.length,
    });

    if (!body) {
      logWarn("social.post.create.validation_failed", {
        action_id: actionId,
        page_id: pageId,
        reason: "missing_body",
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Post text is required" }));
    }

    const [canAccessResult, canEditResult] = await Promise.all([
      supabase.rpc("can_access_social_page", { social_page_uuid: pageId }),
      supabase.rpc("can_edit_page", { p_page_key: "social" }),
    ]);

    if (canAccessResult.error) {
      logError("social.post.create.page_access_check_error", {
        action_id: actionId,
        page_id: pageId,
        error: canAccessResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify page access (${canAccessResult.error.message})` }));
    }

    if (!canAccessResult.error && !canAccessResult.data) {
      logWarn("social.post.create.page_access_denied", {
        action_id: actionId,
        page_id: pageId,
      });
      redirect("/social?error=No%20access%20to%20this%20social%20page");
    }

    if (canEditResult.error) {
      logError("social.post.create.social_edit_check_error", {
        action_id: actionId,
        page_id: pageId,
        error: canEditResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify Social edit access (${canEditResult.error.message})` }));
    }

    if (!canEditResult.error && !canEditResult.data) {
      logWarn("social.post.create.social_edit_denied", {
        action_id: actionId,
        page_id: pageId,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      logWarn("social.post.create.unauthenticated", {
        action_id: actionId,
        page_id: pageId,
      });
      redirect("/login");
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch (error) {
      logError("social.post.create.admin_client_missing", {
        action_id: actionId,
        page_id: pageId,
        error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete. Contact support." }));
    }

    const { data: insertedPost, error: insertPostError } = await supabaseAdmin
      .from("social_posts")
      .insert({
        page_id: pageId,
        user_id: actingUser.userId,
        body,
      })
      .select("id")
      .single();

    if (insertPostError || !insertedPost?.id) {
      logError("social.post.create.insert_failed", {
        action_id: actionId,
        page_id: pageId,
        user_id: actingUser.userId,
        error: insertPostError,
      });
      const insertMessage = String(insertPostError?.message || "Unable to post update");
      const friendlyMessage = /row-level security/i.test(insertMessage)
        ? "Post creation failed due to a policy mismatch. Contact support if this persists."
        : insertMessage;
      redirect(buildSocialDetailUrl(pageId, { error: friendlyMessage }));
    }

    const images = parsedImages.filter((image) =>
      image.storage_path.startsWith(`${pageId}/${actingUser.userId}/`)
    );

    if (images.length) {
      const { error: imageInsertError } = await supabaseAdmin.from("social_post_images").insert(
        images.map((image, index) => ({
          post_id: insertedPost.id,
          storage_path: image.storage_path,
          url: image.url,
          filename: image.filename || null,
          mime_type: image.mime_type || null,
          size_bytes: image.size_bytes || null,
          position: index,
        }))
      );

      if (imageInsertError) {
        logError("social.post.create.image_insert_failed", {
          action_id: actionId,
          page_id: pageId,
          post_id: insertedPost.id,
          user_id: actingUser.userId,
          image_count: images.length,
          error: imageInsertError,
        });
        redirect(buildSocialDetailUrl(pageId, { error: imageInsertError.message }));
      }
    }

    logInfo("social.post.create.success", {
      action_id: actionId,
      page_id: pageId,
      post_id: insertedPost.id,
      user_id: actingUser.userId,
      image_count: images.length,
    });

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: actingUser.authUserId,
        previousText: null,
        nextText: stripSocialInlineImageTokens(body),
        sourceType: "social_post",
        sourceId: insertedPost.id,
        sourceUrl: `/social/${pageId}#post-${insertedPost.id}`,
        sourceTitle: socialPage.name,
      });
    } catch (error) {
      logError("social.post.create.mentions_notify_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: insertedPost.id,
        error,
      });
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(buildSocialDetailUrl(pageId, { success: "Update posted" }, listQueryState));
  }

  async function addComment(formData: FormData) {
    "use server";
    const actionId = randomUUID();
    const supabase = createSupabaseServerClient();

    const postId = String(formData.get("post_id") || "").trim();
    const parentCommentId = String(formData.get("parent_comment_id") || "").trim();
    const body = String(formData.get("body") || "").trim();

    logInfo("social.comment.create.start", {
      action_id: actionId,
      page_id: pageId,
      post_id: postId,
      parent_comment_id: parentCommentId || null,
      body_length: body.length,
    });

    if (!postId || !body) {
      logWarn("social.comment.create.validation_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Comment cannot be empty" }));
    }

    const { data: post, error: postError } = await supabase
      .from("social_posts")
      .select("id,page_id")
      .eq("id", postId)
      .eq("page_id", pageId)
      .maybeSingle();

    if (postError || !post) {
      logWarn("social.comment.create.post_not_found", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        error: postError,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Post not found" }));
    }

    if (parentCommentId) {
      const { data: parentComment, error: parentCommentError } = await supabase
        .from("social_post_comments")
        .select("id,post_id,parent_comment_id")
        .eq("id", parentCommentId)
        .eq("post_id", postId)
        .maybeSingle();

      if (parentCommentError || !parentComment) {
        logWarn("social.comment.create.parent_not_found", {
          action_id: actionId,
          page_id: pageId,
          post_id: postId,
          parent_comment_id: parentCommentId,
          error: parentCommentError,
        });
        redirect(buildSocialDetailUrl(pageId, { error: "Parent comment not found" }));
      }

      if (parentComment.parent_comment_id) {
        logWarn("social.comment.create.parent_depth_invalid", {
          action_id: actionId,
          page_id: pageId,
          post_id: postId,
          parent_comment_id: parentCommentId,
        });
        redirect(buildSocialDetailUrl(pageId, { error: "Replies can only be one level deep" }));
      }
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });

    if (canEditResult.error) {
      logError("social.comment.create.social_edit_check_error", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        error: canEditResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify Social edit access (${canEditResult.error.message})` }));
    }

    if (!canEditResult.error && !canEditResult.data) {
      logWarn("social.comment.create.social_edit_denied", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      logWarn("social.comment.create.unauthenticated", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
      });
      redirect("/login");
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch (error) {
      logError("social.comment.create.admin_client_missing", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete. Contact support." }));
    }

    const { data: insertedComment, error: commentError } = await supabaseAdmin
      .from("social_post_comments")
      .insert({
        post_id: postId,
        user_id: actingUser.userId,
        body,
        parent_comment_id: parentCommentId || null,
      })
      .select("id")
      .single();

    if (commentError || !insertedComment?.id) {
      logError("social.comment.create.insert_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        user_id: actingUser.userId,
        error: commentError,
      });
      redirect(buildSocialDetailUrl(pageId, { error: commentError?.message || "Unable to add comment" }));
    }

    logInfo("social.comment.create.success", {
      action_id: actionId,
      page_id: pageId,
      post_id: postId,
      parent_comment_id: parentCommentId || null,
      user_id: actingUser.userId,
    });

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: actingUser.authUserId,
        previousText: null,
        nextText: body,
        sourceType: "social_comment",
        sourceId: insertedComment.id,
        sourceUrl: `/social/${pageId}#comment-${insertedComment.id}`,
        sourceTitle: socialPage.name,
      });
    } catch (error) {
      logError("social.comment.create.mentions_notify_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        error,
      });
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, undefined, listQueryState)}#post-${postId}`);
  }

  async function togglePostPinned(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const postId = String(formData.get("post_id") || "").trim();
    const nextPinned = String(formData.get("next_pinned") || "") === "1";
    if (!postId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing post" }, listQueryState));
    }

    const canManageResult = await supabase.rpc("can_manage_social_page", {
      social_page_uuid: pageId,
    });
    if (canManageResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify page management access (${canManageResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canManageResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "Only page managers can pin posts" }, listQueryState));
    }

    const { error } = await supabase
      .from("social_posts")
      .update({
        is_pinned: nextPinned,
        pinned_at: nextPinned ? new Date().toISOString() : null,
      })
      .eq("id", postId)
      .eq("page_id", pageId);

    if (error) {
      redirect(buildSocialDetailUrl(pageId, { error: error.message }, listQueryState));
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, undefined, listQueryState)}#post-${postId}`);
  }

  async function updatePost(formData: FormData) {
    "use server";
    const actionId = randomUUID();
    const supabase = createSupabaseServerClient();
    const postId = String(formData.get("post_id") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!postId || !body) {
      redirect(buildSocialDetailUrl(pageId, { error: "Post text is required" }, listQueryState));
    }

    const { data: post, error: lookupError } = await supabase
      .from("social_posts")
      .select("id,page_id,body")
      .eq("id", postId)
      .eq("page_id", pageId)
      .maybeSingle();
    if (lookupError || !post?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Post not found" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const canManagePostResult = await supabase.rpc("can_manage_social_post", {
      social_post_uuid: postId,
    });
    if (canManagePostResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify post permissions (${canManagePostResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canManagePostResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You cannot edit this post" }, listQueryState));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      redirect("/login");
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch {
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete." }, listQueryState));
    }

    const { error: updateError } = await supabaseAdmin
      .from("social_posts")
      .update({
        body,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("page_id", pageId);
    if (updateError) {
      redirect(buildSocialDetailUrl(pageId, { error: updateError.message }, listQueryState));
    }

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: actingUser.authUserId,
        previousText: stripSocialInlineImageTokens(post.body),
        nextText: stripSocialInlineImageTokens(body),
        sourceType: "social_post",
        sourceId: postId,
        sourceUrl: `/social/${pageId}#post-${postId}`,
        sourceTitle: socialPage.name,
      });
    } catch (error) {
      logError("social.post.update.mentions_notify_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        error,
      });
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, { success: "Post updated" }, listQueryState)}#post-${postId}`);
  }

  async function deletePost(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const postId = String(formData.get("post_id") || "").trim();
    if (!postId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing post" }, listQueryState));
    }

    const { data: post, error: lookupError } = await supabase
      .from("social_posts")
      .select("id")
      .eq("id", postId)
      .eq("page_id", pageId)
      .maybeSingle();
    if (lookupError || !post?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Post not found" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const canManagePostResult = await supabase.rpc("can_manage_social_post", {
      social_post_uuid: postId,
    });
    if (canManagePostResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify post permissions (${canManagePostResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canManagePostResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You cannot delete this post" }, listQueryState));
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch {
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete." }, listQueryState));
    }

    const { error: deleteError } = await supabaseAdmin
      .from("social_posts")
      .delete()
      .eq("id", postId)
      .eq("page_id", pageId);
    if (deleteError) {
      redirect(buildSocialDetailUrl(pageId, { error: deleteError.message }, listQueryState));
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(buildSocialDetailUrl(pageId, { success: "Post deleted" }, listQueryState));
  }

  async function togglePostReaction(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const postId = String(formData.get("post_id") || "").trim();
    const emoji = String(formData.get("emoji") || "").trim();

    if (!postId || !SOCIAL_REACTION_OPTIONS.includes(emoji as (typeof SOCIAL_REACTION_OPTIONS)[number])) {
      redirect(buildSocialDetailUrl(pageId, { error: "Invalid reaction" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      redirect("/login");
    }

    const { data: existing } = await supabase
      .from("social_post_reactions")
      .select("post_id,user_id,emoji")
      .eq("post_id", postId)
      .eq("user_id", actingUser.userId)
      .eq("emoji", emoji)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("social_post_reactions")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", actingUser.userId)
        .eq("emoji", emoji);
      if (error) {
        redirect(buildSocialDetailUrl(pageId, { error: error.message }, listQueryState));
      }
    } else {
      const { error } = await supabase.from("social_post_reactions").insert({
        post_id: postId,
        user_id: actingUser.userId,
        emoji,
      });
      if (error) {
        redirect(buildSocialDetailUrl(pageId, { error: error.message }, listQueryState));
      }
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, undefined, listQueryState)}#post-${postId}`);
  }

  async function toggleCommentReaction(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const commentId = String(formData.get("comment_id") || "").trim();
    const postId = String(formData.get("post_id") || "").trim();
    const emoji = String(formData.get("emoji") || "").trim();

    if (
      !commentId ||
      !postId ||
      !SOCIAL_REACTION_OPTIONS.includes(emoji as (typeof SOCIAL_REACTION_OPTIONS)[number])
    ) {
      redirect(buildSocialDetailUrl(pageId, { error: "Invalid reaction" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      redirect("/login");
    }

    const { data: comment } = await supabase
      .from("social_post_comments")
      .select("id,post_id")
      .eq("id", commentId)
      .eq("post_id", postId)
      .maybeSingle();
    if (!comment?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Comment not found" }, listQueryState));
    }

    const { data: existing } = await supabase
      .from("social_comment_reactions")
      .select("comment_id,user_id,emoji")
      .eq("comment_id", commentId)
      .eq("user_id", actingUser.userId)
      .eq("emoji", emoji)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("social_comment_reactions")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", actingUser.userId)
        .eq("emoji", emoji);
      if (error) {
        redirect(buildSocialDetailUrl(pageId, { error: error.message }, listQueryState));
      }
    } else {
      const { error } = await supabase.from("social_comment_reactions").insert({
        comment_id: commentId,
        user_id: actingUser.userId,
        emoji,
      });
      if (error) {
        redirect(buildSocialDetailUrl(pageId, { error: error.message }, listQueryState));
      }
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, undefined, listQueryState)}#post-${postId}`);
  }

  async function updateComment(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const commentId = String(formData.get("comment_id") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!commentId || !body) {
      redirect(buildSocialDetailUrl(pageId, { error: "Comment cannot be empty" }, listQueryState));
    }

    const { data: comment, error: commentLookupError } = await supabase
      .from("social_post_comments")
      .select("id,post_id,body")
      .eq("id", commentId)
      .maybeSingle();
    if (commentLookupError || !comment?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Comment not found" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const canManageCommentResult = await supabase.rpc("can_manage_social_comment", {
      social_comment_uuid: commentId,
    });
    if (canManageCommentResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify comment permissions (${canManageCommentResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canManageCommentResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You cannot edit this comment" }, listQueryState));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      redirect("/login");
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch {
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete." }, listQueryState));
    }

    const { error: updateError } = await supabaseAdmin
      .from("social_post_comments")
      .update({
        body,
        updated_at: new Date().toISOString(),
      })
      .eq("id", commentId);
    if (updateError) {
      redirect(buildSocialDetailUrl(pageId, { error: updateError.message }, listQueryState));
    }

    try {
      await notifyMentionedUsersFromTextChange({
        actorAuthUserId: actingUser.authUserId,
        previousText: comment.body,
        nextText: body,
        sourceType: "social_comment",
        sourceId: comment.id,
        sourceUrl: `/social/${pageId}#comment-${comment.id}`,
        sourceTitle: socialPage.name,
      });
    } catch {
      // Mention notifications are non-blocking for comment edits.
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, { success: "Comment updated" }, listQueryState)}#post-${comment.post_id}`);
  }

  async function deleteComment(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const commentId = String(formData.get("comment_id") || "").trim();
    if (!commentId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing comment" }, listQueryState));
    }

    const { data: comment, error: lookupError } = await supabase
      .from("social_post_comments")
      .select("id,post_id")
      .eq("id", commentId)
      .maybeSingle();
    if (lookupError || !comment?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Comment not found" }, listQueryState));
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });
    if (canEditResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify Social edit access (${canEditResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canEditResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You have view-only access to this page" }, listQueryState));
    }

    const canManageCommentResult = await supabase.rpc("can_manage_social_comment", {
      social_comment_uuid: commentId,
    });
    if (canManageCommentResult.error) {
      redirect(
        buildSocialDetailUrl(
          pageId,
          { error: `Could not verify comment permissions (${canManageCommentResult.error.message})` },
          listQueryState
        )
      );
    }
    if (!canManageCommentResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "You cannot delete this comment" }, listQueryState));
    }

    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch {
      redirect(buildSocialDetailUrl(pageId, { error: "Social configuration is incomplete." }, listQueryState));
    }

    const { error: deleteError } = await supabaseAdmin
      .from("social_post_comments")
      .delete()
      .eq("id", commentId);
    if (deleteError) {
      redirect(buildSocialDetailUrl(pageId, { error: deleteError.message }, listQueryState));
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`${buildSocialDetailUrl(pageId, { success: "Comment deleted" }, listQueryState)}#post-${comment.post_id}`);
  }

  async function addMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const userId = String(formData.get("user_id") || "").trim();
    const role = normalizeRole(String(formData.get("role") || "member"));

    if (!userId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Select a user to add" }));
    }

    if (userId === socialPage.created_by) {
      redirect(buildSocialDetailUrl(pageId, { error: "Owner already has full access" }));
    }

    const canManageResult = await supabase.rpc("can_manage_social_page", {
      social_page_uuid: pageId,
    });

    if (canManageResult.error) {
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify page management access (${canManageResult.error.message})` }));
    }
    if (!canManageResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "Only page managers can add members" }));
    }

    const actingUser = await resolveActingUser(supabase);
    if (!actingUser?.userId) {
      redirect("/login");
    }

    const { error } = await supabase
      .from("social_page_members")
      .upsert(
        {
          page_id: pageId,
          user_id: userId,
          role,
          created_by_user_id: actingUser.userId,
        },
        { onConflict: "page_id,user_id" }
      );

    if (error) {
      redirect(buildSocialDetailUrl(pageId, { error: error.message }));
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(buildSocialDetailUrl(pageId, { success: "Member added" }));
  }

  async function updateMemberRole(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const memberId = String(formData.get("member_id") || "").trim();
    const role = normalizeRole(String(formData.get("role") || "member"));

    if (!memberId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing member" }));
    }

    const canManageResult = await supabase.rpc("can_manage_social_page", {
      social_page_uuid: pageId,
    });

    if (canManageResult.error) {
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify page management access (${canManageResult.error.message})` }));
    }
    if (!canManageResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "Only page managers can update members" }));
    }

    const { error } = await supabase
      .from("social_page_members")
      .update({ role })
      .eq("id", memberId)
      .eq("page_id", pageId);

    if (error) {
      redirect(buildSocialDetailUrl(pageId, { error: error.message }));
    }

    revalidatePath(`/social/${pageId}`);
    redirect(buildSocialDetailUrl(pageId, { success: "Member updated" }));
  }

  async function removeMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const memberId = String(formData.get("member_id") || "").trim();
    if (!memberId) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing member" }));
    }

    const canManageResult = await supabase.rpc("can_manage_social_page", {
      social_page_uuid: pageId,
    });

    if (canManageResult.error) {
      redirect(buildSocialDetailUrl(pageId, { error: `Could not verify page management access (${canManageResult.error.message})` }));
    }
    if (!canManageResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "Only page managers can remove members" }));
    }

    const { data: member } = await supabase
      .from("social_page_members")
      .select("id,user_id")
      .eq("id", memberId)
      .eq("page_id", pageId)
      .maybeSingle();

    if (!member?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Member not found" }));
    }

    if (member.user_id === socialPage.created_by) {
      redirect(buildSocialDetailUrl(pageId, { error: "Cannot remove page owner" }));
    }

    const { error } = await supabase
      .from("social_page_members")
      .delete()
      .eq("id", memberId)
      .eq("page_id", pageId);

    if (error) {
      redirect(buildSocialDetailUrl(pageId, { error: error.message }));
    }

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(buildSocialDetailUrl(pageId, { success: "Member removed" }));
  }

  const ownerUser = userById.get(socialPage.created_by);
  const ownerLabel = toUserLabel(ownerUser);
  const closePanelHref = buildSocialDetailUrl(pageId, undefined, listQueryState);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">{socialPage.name}</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            {socialPage.description || "No description added yet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManagePage ? (
            <Link
              href={buildSocialDetailUrl(pageId, undefined, { ...listQueryState, panel: "edit" })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              Edit page
            </Link>
          ) : null}
          <Link
            href="/social"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
          >
            Back to Social
          </Link>
        </div>
      </div>

      {(searchParams?.error || searchParams?.success || permissionWarning || dataWarning) && (
        <div className="space-y-2">
          {permissionWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {permissionWarning}
            </p>
          ) : null}
          {dataWarning ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {dataWarning.message}
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

      <SocialReadTracker pageId={pageId} postIds={postIds} />

      {panel === "compose" ? (
        <RouteModalOverlay
          closeHref={closePanelHref}
          overlayLabel="Close share update dialog"
        >
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-w-none max-h-[92vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-4xl md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold text-slate-900">Share an update</h2>
                <a
                  href={closePanelHref}
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </a>
              </div>
              <div className="px-4 pb-5 pt-4 md:px-6 md:pb-6">
                <SocialPostComposer socialPageId={pageId} action={createPost} canPost={canPost} />
              </div>
            </section>
          </div>
        </RouteModalOverlay>
      ) : null}

      {panel === "edit" && canManagePage ? (
        <RouteModalOverlay
          closeHref={closePanelHref}
          overlayLabel="Close edit page dialog"
        >
          <div className="relative z-10 flex min-h-full items-end justify-center overflow-y-auto p-0 md:items-start md:p-6 md:pb-8 md:pt-8 lg:p-10">
            <section className="w-full max-w-none max-h-[92vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-[0_28px_85px_-32px_rgba(15,23,42,0.5)] md:max-w-3xl md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Edit page</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Manage access and members for this social page.
                  </p>
                </div>
                <a
                  href={closePanelHref}
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </a>
              </div>

              <div className="grid gap-4 px-4 py-4 md:grid-cols-2 md:px-6 md:py-6">
                <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Page Access</h3>
                    <p className="mt-1 text-xs text-slate-600">Add people manually to grant access.</p>
                  </div>

                  <form action={addMember} className="space-y-2">
                    <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      Add user
                      <select
                        name="user_id"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm font-normal"
                        defaultValue=""
                      >
                        <option value="">Select user</option>
                        {availableUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {toUserLabel(user)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      Role
                      <select
                        name="role"
                        defaultValue="member"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm font-normal"
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                    >
                      Add to page
                    </button>
                  </form>
                </section>

                <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">Members</h3>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {memberUserIds.size}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                          {toAvatarUrl(ownerUser) ? (
                            <Image
                              src={toAvatarUrl(ownerUser)}
                              alt={`${ownerLabel} avatar`}
                              fill
                              sizes="28px"
                              className="object-cover"
                            />
                          ) : (
                            toInitials(ownerLabel)
                          )}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{ownerLabel}</p>
                          <p className="text-[11px] text-slate-600">Owner</p>
                        </div>
                      </div>
                    </div>

                    {members
                      .filter((member) => member.user_id !== socialPage.created_by)
                      .map((member) => {
                        const memberUser = userById.get(member.user_id);
                        const memberLabel = toUserLabel(memberUser);
                        const memberAvatarUrl = toAvatarUrl(memberUser);
                        const memberInitials = toInitials(memberLabel);
                        return (
                          <div key={member.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                                {memberAvatarUrl ? (
                                  <Image
                                    src={memberAvatarUrl}
                                    alt={`${memberLabel} avatar`}
                                    fill
                                    sizes="28px"
                                    className="object-cover"
                                  />
                                ) : (
                                  memberInitials
                                )}
                              </span>
                              <p className="text-xs font-semibold text-slate-900">{memberLabel}</p>
                            </div>

                            <form action={updateMemberRole} className="mt-2 flex items-center gap-2">
                              <input type="hidden" name="member_id" value={member.id} />
                              <select
                                name="role"
                                defaultValue={member.role}
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="member">Member</option>
                                <option value="manager">Manager</option>
                              </select>
                              <button
                                type="submit"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                              >
                                Save
                              </button>
                              <button
                                type="submit"
                                formAction={removeMember}
                                className="text-xs font-semibold text-red-600 hover:text-red-800"
                              >
                                Remove
                              </button>
                            </form>
                          </div>
                        );
                      })}

                    {!members.filter((member) => member.user_id !== socialPage.created_by).length ? (
                      <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-500">
                        No additional members yet.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </section>
          </div>
        </RouteModalOverlay>
      ) : null}

      <div className="grid gap-6">
        <section className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Search posts
                <input
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search updates"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Filter
                <select
                  name="filter"
                  defaultValue={postFilter}
                  className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                >
                  <option value="all">All posts</option>
                  <option value="pinned">Pinned</option>
                  <option value="mine">My posts</option>
                  <option value="unread">Unread</option>
                </select>
              </label>
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
              >
                Apply
              </button>
              {(searchQuery || postFilter !== "all") && (
                <Link
                  href={`/social/${pageId}`}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-800"
                >
                  Clear
                </Link>
              )}
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Showing {filteredPosts.length} of {filteredPostCount} posts
            </p>
            {filteredPostCount > SOCIAL_POSTS_PAGE_SIZE ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                  Page {Math.min(postPageNumber, totalPostPages)} of {totalPostPages}
                </span>
                <div className="flex items-center gap-2">
                  {hasPreviousPage ? (
                    <Link
                      href={buildSocialDetailUrl(pageId, undefined, {
                        ...listQueryState,
                        p: postPageNumber - 1,
                      })}
                      className="rounded-md border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-400">
                      Previous
                    </span>
                  )}
                  {hasNextPage ? (
                    <Link
                      href={buildSocialDetailUrl(pageId, undefined, {
                        ...listQueryState,
                        p: postPageNumber + 1,
                      })}
                      className="rounded-md border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-400">
                      Next
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <div className="flex justify-end">
            <Link
              href={buildSocialDetailUrl(pageId, undefined, {
                ...listQueryState,
                panel: "compose",
              })}
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Share an update
            </Link>
          </div>

          <div className="space-y-4">
            {filteredPosts.length ? (
              filteredPosts.map((post) => {
                const postUser = userById.get(post.user_id);
                const postLabel = toUserLabel(postUser);
                const postInitials = toInitials(postLabel);
                const postAvatarUrl = toAvatarUrl(postUser);
                const postImagesForItem = imagesByPostId.get(post.id) || [];
                const imageByStoragePath = new Map(postImagesForItem.map((image) => [image.storage_path, image]));
                const inlineSegments = splitSocialInlineContent(post.body);
                const inlineImagePaths = new Set(
                  inlineSegments
                    .filter((segment) => segment.type === "image")
                    .map((segment) => (segment.type === "image" ? segment.storagePath : ""))
                );
                const trailingImages = postImagesForItem.filter(
                  (image) => !inlineImagePaths.has(image.storage_path)
                );
                const commentsForPost = commentsByPostId.get(post.id) || [];
                const postViewsForItem = viewsByPostId.get(post.id) || [];
                const postReactionRows = postReactionsByPostId.get(post.id) || [];
                const postReactionCounts = postReactionRows.reduce<Record<string, number>>((acc, reaction) => {
                  acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
                  return acc;
                }, {});
                const myPostReactionSet = new Set(
                  postReactionRows
                    .filter((reaction) => reaction.user_id === currentUser.id)
                    .map((reaction) => reaction.emoji)
                );
                const viewerLabels = Array.from(
                  new Set(
                    [...postViewsForItem, { post_id: post.id, user_id: currentUser.id, viewed_at: "" }]
                      .sort((left, right) => right.viewed_at.localeCompare(left.viewed_at))
                      .map((view) => toUserLabel(userById.get(view.user_id)))
                  )
                );
                const canManagePost = canManagePage || post.user_id === currentUser.id;
                const isUnread = previousPageReadAt ? toTime(post.created_at) > toTime(previousPageReadAt) : false;
                const topLevelComments = commentsForPost.filter((comment) => !comment.parent_comment_id);
                const repliesByParentId = new Map<string, SocialPostCommentRow[]>();
                commentsForPost.forEach((comment) => {
                  if (!comment.parent_comment_id) return;
                  const bucket = repliesByParentId.get(comment.parent_comment_id) || [];
                  bucket.push(comment);
                  repliesByParentId.set(comment.parent_comment_id, bucket);
                });

                return (
                  <article
                    id={`post-${post.id}`}
                    key={post.id}
                    className={`rounded-2xl border bg-white p-5 shadow-sm ${
                      post.is_pinned ? "border-amber-300" : "border-slate-200"
                    }`}
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold tracking-wide text-slate-700">
                          {postAvatarUrl ? (
                            <Image
                              src={postAvatarUrl}
                              alt={`${postLabel} avatar`}
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          ) : (
                            postInitials
                          )}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{postLabel}</p>
                          <p className="text-xs text-slate-500">{toDateTimeLabel(post.created_at)}</p>
                          <p className="text-[11px] text-slate-500">{toViewerSummary(viewerLabels)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {post.is_pinned ? (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Pinned
                          </span>
                        ) : null}
                        {isUnread ? (
                          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            New
                          </span>
                        ) : null}
                        {canManagePage ? (
                          <form action={togglePostPinned}>
                            <input type="hidden" name="post_id" value={post.id} />
                            <input type="hidden" name="next_pinned" value={post.is_pinned ? "0" : "1"} />
                            <button
                              type="submit"
                              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                            >
                              {post.is_pinned ? "Unpin" : "Pin"}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </header>

                    <div className="mt-4 space-y-3">
                      {inlineSegments.map((segment) => {
                        if (segment.type === "text") {
                          if (!segment.text.trim()) return null;
                          return (
                            <p key={segment.key} className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                              {segment.text}
                            </p>
                          );
                        }

                        const image = imageByStoragePath.get(segment.storagePath);
                        if (!image) return null;
                        return (
                          <a
                            key={segment.key}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group block w-full max-w-[460px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                          >
                            <div className="relative aspect-[4/3]">
                              <Image
                                src={image.url}
                                alt={image.filename || "Post image"}
                                fill
                                sizes="(max-width: 768px) 92vw, 460px"
                                className="object-cover transition duration-150 group-hover:scale-[1.02]"
                              />
                            </div>
                          </a>
                        );
                      })}
                    </div>

                    {trailingImages.length ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        {trailingImages.map((image) => (
                          <a
                            key={image.id}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group w-full max-w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                          >
                            <div className="relative aspect-[4/3]">
                              <Image
                                src={image.url}
                                alt={image.filename || "Post image"}
                                fill
                                sizes="(max-width: 768px) 88vw, 320px"
                                className="object-cover transition duration-150 group-hover:scale-[1.02]"
                              />
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {SOCIAL_REACTION_OPTIONS.map((emoji) => {
                        const count = postReactionCounts[emoji] || 0;
                        const active = myPostReactionSet.has(emoji);
                        return (
                          <form key={`${post.id}-${emoji}`} action={togglePostReaction}>
                            <input type="hidden" name="post_id" value={post.id} />
                            <input type="hidden" name="emoji" value={emoji} />
                            <button
                              type="submit"
                              disabled={!canPost}
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                active
                                  ? "border-slate-400 bg-slate-100 text-slate-900"
                                  : "border-slate-200 bg-white text-slate-700"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              {emoji} {count > 0 ? count : ""}
                            </button>
                          </form>
                        );
                      })}
                    </div>

                    {canManagePost ? (
                      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">
                          Edit or delete
                        </summary>
                        <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                          <form action={updatePost} className="space-y-2">
                            <input type="hidden" name="post_id" value={post.id} />
                            <textarea
                              name="body"
                              defaultValue={post.body}
                              rows={4}
                              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                              required
                            />
                            <button
                              type="submit"
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                              Save post
                            </button>
                          </form>
                          <form action={deletePost}>
                            <input type="hidden" name="post_id" value={post.id} />
                            <button
                              type="submit"
                              className="text-xs font-semibold text-red-600 hover:text-red-800"
                            >
                              Delete post
                            </button>
                          </form>
                        </div>
                      </details>
                    ) : null}

                    <details className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Comments ({commentsForPost.length})
                      </summary>

                      <div className="border-t border-slate-200 px-3 py-3">
                        <SocialCommentComposer
                          postId={post.id}
                          canPost={canPost}
                          action={addComment}
                          placeholder="Write a comment (use @name to mention)"
                          className="flex flex-col gap-2"
                        />

                        <div className="mt-3 space-y-2">
                          {topLevelComments.length ? (
                            topLevelComments.map((comment) => {
                              const commentUser = userById.get(comment.user_id);
                              const commentLabel = toUserLabel(commentUser);
                              const commentAvatarUrl = toAvatarUrl(commentUser);
                              const commentInitials = toInitials(commentLabel);
                              const replies = repliesByParentId.get(comment.id) || [];
                              const canManageComment = canManagePage || comment.user_id === currentUser.id;
                              const commentReactionRows = commentReactionsByCommentId.get(comment.id) || [];
                              const commentReactionCounts = commentReactionRows.reduce<Record<string, number>>(
                                (acc, reaction) => {
                                  acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
                                  return acc;
                                },
                                {}
                              );
                              const myCommentReactionSet = new Set(
                                commentReactionRows
                                  .filter((reaction) => reaction.user_id === currentUser.id)
                                  .map((reaction) => reaction.emoji)
                              );
                              const visibleCommentReactions = [
                                ...SOCIAL_REACTION_OPTIONS.map((emoji) => ({
                                  emoji,
                                  count: commentReactionCounts[emoji] || 0,
                                  active: myCommentReactionSet.has(emoji),
                                })).filter((reaction) => reaction.count > 0),
                                ...Object.entries(commentReactionCounts)
                                  .filter(
                                    ([emoji, count]) =>
                                      Number(count) > 0 && !SOCIAL_REACTION_OPTION_SET.has(emoji)
                                  )
                                  .map(([emoji, count]) => ({
                                    emoji,
                                    count: Number(count),
                                    active: myCommentReactionSet.has(emoji),
                                  })),
                              ];

                              return (
                                <article
                                  id={`comment-${comment.id}`}
                                  key={comment.id}
                                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="relative mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                                      {commentAvatarUrl ? (
                                        <Image
                                          src={commentAvatarUrl}
                                          alt={`${commentLabel} avatar`}
                                          fill
                                          sizes="28px"
                                          className="object-cover"
                                        />
                                      ) : (
                                        commentInitials
                                      )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs text-slate-500">
                                        <span className="font-semibold text-slate-700">{commentLabel}</span> -{" "}
                                        {toDateTimeLabel(comment.created_at)}
                                        {toTime(comment.updated_at) > toTime(comment.created_at) ? " (edited)" : ""}
                                      </p>
                                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
                                      <div className="mt-2 flex flex-wrap items-center gap-1">
                                        {visibleCommentReactions.map((reaction) => (
                                          <form
                                            key={`${comment.id}-${reaction.emoji}`}
                                            action={toggleCommentReaction}
                                          >
                                            <input type="hidden" name="comment_id" value={comment.id} />
                                            <input type="hidden" name="post_id" value={post.id} />
                                            <input type="hidden" name="emoji" value={reaction.emoji} />
                                            <button
                                              type="submit"
                                              disabled={!canPost}
                                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                                reaction.active
                                                  ? "border-slate-400 bg-slate-100 text-slate-900"
                                                  : "border-slate-200 bg-white text-slate-700"
                                              } disabled:cursor-not-allowed disabled:opacity-50`}
                                            >
                                              <span>{reaction.emoji}</span>
                                              <span>{reaction.count}</span>
                                            </button>
                                          </form>
                                        ))}
                                        <details className="relative">
                                          <summary className="list-none inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
                                            <span className="sr-only">Add reaction</span>
                                            <svg
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              className="h-3.5 w-3.5"
                                              aria-hidden="true"
                                            >
                                              <circle cx="12" cy="12" r="9" />
                                              <path d="M8 15s1.5 2 4 2 4-2 4-2" />
                                              <line x1="9" y1="10" x2="9.01" y2="10" />
                                              <line x1="15" y1="10" x2="15.01" y2="10" />
                                            </svg>
                                          </summary>
                                          <div className="absolute bottom-7 left-0 z-20 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                                            {SOCIAL_REACTION_OPTIONS.map((emoji) => (
                                              <form
                                                key={`${comment.id}-picker-${emoji}`}
                                                action={toggleCommentReaction}
                                              >
                                                <input type="hidden" name="comment_id" value={comment.id} />
                                                <input type="hidden" name="post_id" value={post.id} />
                                                <input type="hidden" name="emoji" value={emoji} />
                                                <button
                                                  type="submit"
                                                  disabled={!canPost}
                                                  className="rounded px-1 py-0.5 text-base hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                  {emoji}
                                                </button>
                                              </form>
                                            ))}
                                          </div>
                                        </details>
                                      </div>
                                    </div>
                                  </div>

                                  {canManageComment ? (
                                    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
                                      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                                        Edit or delete
                                      </summary>
                                      <div className="space-y-2 border-t border-slate-200 px-2.5 py-2">
                                        <form action={updateComment} className="space-y-2">
                                          <input type="hidden" name="comment_id" value={comment.id} />
                                          <textarea
                                            name="body"
                                            defaultValue={comment.body}
                                            rows={3}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                                            required
                                          />
                                          <button
                                            type="submit"
                                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                                          >
                                            Save comment
                                          </button>
                                        </form>
                                        <form action={deleteComment}>
                                          <input type="hidden" name="comment_id" value={comment.id} />
                                          <button
                                            type="submit"
                                            className="text-xs font-semibold text-red-600 hover:text-red-800"
                                          >
                                            Delete comment
                                          </button>
                                        </form>
                                      </div>
                                    </details>
                                  ) : null}

                                  <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
                                    <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                                      {replies.length ? `Replies (${replies.length})` : "Reply"}
                                    </summary>
                                    <div className="border-t border-slate-200 px-2.5 py-2">
                                      <SocialCommentComposer
                                        postId={post.id}
                                        canPost={canPost}
                                        action={addComment}
                                        parentCommentId={comment.id}
                                        placeholder={`Reply to ${commentLabel} (use @name to mention)`}
                                        submitLabel="Reply"
                                        className="flex flex-col gap-2"
                                      />

                                      {replies.length ? (
                                        <div className="mt-3 space-y-2">
                                          {replies.map((reply) => {
                                            const replyUser = userById.get(reply.user_id);
                                            const replyLabel = toUserLabel(replyUser);
                                            const replyAvatarUrl = toAvatarUrl(replyUser);
                                            const replyInitials = toInitials(replyLabel);
                                            const canManageReply = canManagePage || reply.user_id === currentUser.id;
                                            const replyReactionRows =
                                              commentReactionsByCommentId.get(reply.id) || [];
                                            const replyReactionCounts = replyReactionRows.reduce<Record<string, number>>(
                                              (acc, reaction) => {
                                                acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
                                                return acc;
                                              },
                                              {}
                                            );
                                            const myReplyReactionSet = new Set(
                                              replyReactionRows
                                                .filter((reaction) => reaction.user_id === currentUser.id)
                                                .map((reaction) => reaction.emoji)
                                            );
                                            const visibleReplyReactions = [
                                              ...SOCIAL_REACTION_OPTIONS.map((emoji) => ({
                                                emoji,
                                                count: replyReactionCounts[emoji] || 0,
                                                active: myReplyReactionSet.has(emoji),
                                              })).filter((reaction) => reaction.count > 0),
                                              ...Object.entries(replyReactionCounts)
                                                .filter(
                                                  ([emoji, count]) =>
                                                    Number(count) > 0 &&
                                                    !SOCIAL_REACTION_OPTION_SET.has(emoji)
                                                )
                                                .map(([emoji, count]) => ({
                                                  emoji,
                                                  count: Number(count),
                                                  active: myReplyReactionSet.has(emoji),
                                                })),
                                            ];
                                            return (
                                              <article
                                                id={`comment-${reply.id}`}
                                                key={reply.id}
                                                className="rounded-md border border-slate-200 bg-white px-3 py-2"
                                              >
                                                <div className="flex items-start gap-2">
                                                  <span className="relative mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[10px] font-semibold text-slate-700">
                                                    {replyAvatarUrl ? (
                                                      <Image
                                                        src={replyAvatarUrl}
                                                        alt={`${replyLabel} avatar`}
                                                        fill
                                                        sizes="24px"
                                                        className="object-cover"
                                                      />
                                                    ) : (
                                                      replyInitials
                                                    )}
                                                  </span>
                                                  <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] text-slate-500">
                                                      <span className="font-semibold text-slate-700">{replyLabel}</span>{" "}
                                                      - {toDateTimeLabel(reply.created_at)}
                                                      {toTime(reply.updated_at) > toTime(reply.created_at)
                                                        ? " (edited)"
                                                        : ""}
                                                    </p>
                                                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                                                      {reply.body}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap items-center gap-1">
                                                      {visibleReplyReactions.map((reaction) => (
                                                        <form
                                                          key={`${reply.id}-${reaction.emoji}`}
                                                          action={toggleCommentReaction}
                                                        >
                                                          <input
                                                            type="hidden"
                                                            name="comment_id"
                                                            value={reply.id}
                                                          />
                                                          <input type="hidden" name="post_id" value={post.id} />
                                                          <input
                                                            type="hidden"
                                                            name="emoji"
                                                            value={reaction.emoji}
                                                          />
                                                          <button
                                                            type="submit"
                                                            disabled={!canPost}
                                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                                              reaction.active
                                                                ? "border-slate-400 bg-slate-100 text-slate-900"
                                                                : "border-slate-200 bg-white text-slate-700"
                                                            } disabled:cursor-not-allowed disabled:opacity-50`}
                                                          >
                                                            <span>{reaction.emoji}</span>
                                                            <span>{reaction.count}</span>
                                                          </button>
                                                        </form>
                                                      ))}
                                                      <details className="relative">
                                                        <summary className="list-none inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
                                                          <span className="sr-only">Add reaction</span>
                                                          <svg
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="h-3.5 w-3.5"
                                                            aria-hidden="true"
                                                          >
                                                            <circle cx="12" cy="12" r="9" />
                                                            <path d="M8 15s1.5 2 4 2 4-2 4-2" />
                                                            <line x1="9" y1="10" x2="9.01" y2="10" />
                                                            <line x1="15" y1="10" x2="15.01" y2="10" />
                                                          </svg>
                                                        </summary>
                                                        <div className="absolute bottom-7 left-0 z-20 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                                                          {SOCIAL_REACTION_OPTIONS.map((emoji) => (
                                                            <form
                                                              key={`${reply.id}-picker-${emoji}`}
                                                              action={toggleCommentReaction}
                                                            >
                                                              <input
                                                                type="hidden"
                                                                name="comment_id"
                                                                value={reply.id}
                                                              />
                                                              <input
                                                                type="hidden"
                                                                name="post_id"
                                                                value={post.id}
                                                              />
                                                              <input
                                                                type="hidden"
                                                                name="emoji"
                                                                value={emoji}
                                                              />
                                                              <button
                                                                type="submit"
                                                                disabled={!canPost}
                                                                className="rounded px-1 py-0.5 text-base hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                              >
                                                                {emoji}
                                                              </button>
                                                            </form>
                                                          ))}
                                                        </div>
                                                      </details>
                                                    </div>
                                                  </div>
                                                </div>

                                                {canManageReply ? (
                                                  <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
                                                    <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                                                      Edit or delete
                                                    </summary>
                                                    <div className="space-y-2 border-t border-slate-200 px-2.5 py-2">
                                                      <form action={updateComment} className="space-y-2">
                                                        <input type="hidden" name="comment_id" value={reply.id} />
                                                        <textarea
                                                          name="body"
                                                          defaultValue={reply.body}
                                                          rows={3}
                                                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                                                          required
                                                        />
                                                        <button
                                                          type="submit"
                                                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                                                        >
                                                          Save reply
                                                        </button>
                                                      </form>
                                                      <form action={deleteComment}>
                                                        <input type="hidden" name="comment_id" value={reply.id} />
                                                        <button
                                                          type="submit"
                                                          className="text-xs font-semibold text-red-600 hover:text-red-800"
                                                        >
                                                          Delete reply
                                                        </button>
                                                      </form>
                                                    </div>
                                                  </details>
                                                ) : null}
                                              </article>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  </details>
                                </article>
                              );
                            })
                          ) : (
                            <p className="text-xs text-slate-500">No comments yet.</p>
                          )}
                        </div>
                      </div>
                    </details>
                  </article>
                );
              })
            ) : filteredPostCount ? (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
                No posts match your current search/filter.
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
                No posts yet. Share the first update for this page.
              </section>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

