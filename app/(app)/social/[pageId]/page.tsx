import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import { logError, logInfo, logWarn } from "@/lib/vercelLogger";
import SocialCommentComposer from "../_components/SocialCommentComposer";
import SocialPostComposer from "../_components/SocialPostComposer";

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
  created_at: string;
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

function normalizeRole(value: string): "member" | "manager" {
  return value === "manager" ? "manager" : "member";
}

function buildSocialDetailUrl(pageId: string, extra?: { error?: string; success?: string }) {
  const params = new URLSearchParams();
  if (extra?.error) params.set("error", extra.error);
  if (extra?.success) params.set("success", extra.success);
  const query = params.toString();
  return query ? `/social/${pageId}?${query}` : `/social/${pageId}`;
}

export default async function SocialPageDetail(props: {
  params: Promise<{ pageId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const { pageId } = await props.params;
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

  const [membersResult, postsResult] = await Promise.all([
    supabase
      .from("social_page_members")
      .select("id,page_id,user_id,role,created_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: true }),
    supabase
      .from("social_posts")
      .select("id,page_id,user_id,body,created_at,updated_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const members = (membersResult.data || []) as SocialPageMemberRow[];
  const posts = (postsResult.data || []) as SocialPostRow[];

  const postIds = posts.map((post) => post.id);
  const [imagesResult, commentsResult] = postIds.length
    ? await Promise.all([
        supabase
          .from("social_post_images")
          .select("id,post_id,storage_path,url,filename,mime_type,size_bytes,position")
          .in("post_id", postIds)
          .order("position", { ascending: true }),
        supabase
          .from("social_post_comments")
          .select("id,post_id,user_id,body,created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true }),
      ])
    : [
        { data: [] as SocialPostImageRow[], error: null },
        { data: [] as SocialPostCommentRow[], error: null },
      ];

  const postImages = (imagesResult.data || []) as SocialPostImageRow[];
  const postComments = (commentsResult.data || []) as SocialPostCommentRow[];

  const actorIds = Array.from(
    new Set([
      socialPage.created_by,
      ...members.map((member) => member.user_id),
      ...posts.map((post) => post.user_id),
      ...postComments.map((comment) => comment.user_id),
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

  const memberByUserId = new Map<string, SocialPageMemberRow>();
  members.forEach((member) => memberByUserId.set(member.user_id, member));

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

  const permissionWarning =
    canManageResult.error && !isSupabaseMissingFunctionError(canManageResult.error)
      ? `Could not verify page management permission (${canManageResult.error.message}).`
      : canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)
        ? `Could not verify page edit permission (${canEditResult.error.message}).`
        : null;

  const dataWarning = membersResult.error || postsResult.error || imagesResult.error || commentsResult.error;

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

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = String(authData.user?.id || "").trim();
    const authEmail = authData.user?.email;
    if (!authUserId) {
      logWarn("social.post.create.unauthenticated", {
        action_id: actionId,
        page_id: pageId,
      });
      redirect("/login");
    }

    const userByAuthIdResult = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (userByAuthIdResult.error) {
      logError("social.post.create.lookup_by_auth_id_error", {
        action_id: actionId,
        page_id: pageId,
        auth_user_id: authUserId,
        error: userByAuthIdResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Could not verify your user profile" }));
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
      logError("social.post.create.lookup_by_email_error", {
        action_id: actionId,
        page_id: pageId,
        auth_email: authEmail,
        error: userByEmailResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Could not verify your user profile" }));
    }

    const user = userByAuthIdResult.data || userByEmailResult?.data || null;

    if (!user?.id) {
      logWarn("social.post.create.user_profile_missing", {
        action_id: actionId,
        page_id: pageId,
        auth_user_id: authUserId,
        auth_email: authEmail,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Missing user profile" }));
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
        user_id: user.id,
        body,
      })
      .select("id")
      .single();

    if (insertPostError || !insertedPost?.id) {
      logError("social.post.create.insert_failed", {
        action_id: actionId,
        page_id: pageId,
        user_id: user.id,
        error: insertPostError,
      });
      const insertMessage = String(insertPostError?.message || "Unable to post update");
      const friendlyMessage = /row-level security/i.test(insertMessage)
        ? "Post creation failed due to a policy mismatch. Contact support if this persists."
        : insertMessage;
      redirect(buildSocialDetailUrl(pageId, { error: friendlyMessage }));
    }

    const images = parsedImages.filter((image) =>
      image.storage_path.startsWith(`${pageId}/${user.id}/`)
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
          user_id: user.id,
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
      user_id: user.id,
      image_count: images.length,
    });

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(buildSocialDetailUrl(pageId, { success: "Update posted" }));
  }

  async function addComment(formData: FormData) {
    "use server";
    const actionId = randomUUID();
    const supabase = createSupabaseServerClient();

    const postId = String(formData.get("post_id") || "").trim();
    const body = String(formData.get("body") || "").trim();

    logInfo("social.comment.create.start", {
      action_id: actionId,
      page_id: pageId,
      post_id: postId,
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

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = String(authData.user?.id || "").trim();
    const authEmail = authData.user?.email;
    if (!authUserId) {
      logWarn("social.comment.create.unauthenticated", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
      });
      redirect("/login");
    }

    const userByAuthIdResult = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (userByAuthIdResult.error) {
      logError("social.comment.create.lookup_by_auth_id_error", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        auth_user_id: authUserId,
        error: userByAuthIdResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Could not verify your user profile" }));
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
      logError("social.comment.create.lookup_by_email_error", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        auth_email: authEmail,
        error: userByEmailResult.error,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Could not verify your user profile" }));
    }

    const user = userByAuthIdResult.data || userByEmailResult?.data || null;

    if (!user?.id) {
      logWarn("social.comment.create.user_profile_missing", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        auth_user_id: authUserId,
        auth_email: authEmail,
      });
      redirect(buildSocialDetailUrl(pageId, { error: "Missing user profile" }));
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

    const { error: commentError } = await supabaseAdmin.from("social_post_comments").insert({
      post_id: postId,
      user_id: user.id,
      body,
    });

    if (commentError) {
      logError("social.comment.create.insert_failed", {
        action_id: actionId,
        page_id: pageId,
        post_id: postId,
        user_id: user.id,
        error: commentError,
      });
      redirect(buildSocialDetailUrl(pageId, { error: commentError.message }));
    }

    logInfo("social.comment.create.success", {
      action_id: actionId,
      page_id: pageId,
      post_id: postId,
      user_id: user.id,
    });

    revalidatePath(`/social/${pageId}`);
    revalidatePath("/social");
    redirect(`/social/${pageId}#post-${postId}`);
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

    if (!canManageResult.error && !canManageResult.data) {
      redirect(buildSocialDetailUrl(pageId, { error: "Only page managers can add members" }));
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = String(authData.user?.id || "").trim();
    const authEmail = authData.user?.email;
    if (!authUserId) {
      redirect("/login");
    }

    const userByAuthIdResult = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    const userByEmailResult =
      !userByAuthIdResult.data && authEmail
        ? await supabase
            .from("users")
            .select("id")
            .eq("email", authEmail)
            .maybeSingle()
        : null;
    const user = userByAuthIdResult.data || userByEmailResult?.data || null;

    if (!user?.id) {
      redirect(buildSocialDetailUrl(pageId, { error: "Missing user profile" }));
    }

    const { error } = await supabase
      .from("social_page_members")
      .upsert(
        {
          page_id: pageId,
          user_id: userId,
          role,
          created_by_user_id: user.id,
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

    if (!canManageResult.error && !canManageResult.data) {
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

    if (!canManageResult.error && !canManageResult.data) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Social page</p>
          <h1 className="text-2xl font-semibold text-slate-900">{socialPage.name}</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            {socialPage.description || "No description added yet."}
          </p>
        </div>
        <Link
          href="/social"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Back to Social
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
              Private page
            </span>
            <span>Owner: {ownerLabel}</span>
            <span>Created: {toDateTimeLabel(socialPage.created_at)}</span>
          </div>
          <span>{posts.length} recent posts</span>
        </div>
      </section>

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className="space-y-5">
          <SocialPostComposer socialPageId={pageId} onPost={createPost} canPost={canPost} />

          <div className="space-y-4">
            {posts.length ? (
              posts.map((post) => {
                const postUser = userById.get(post.user_id);
                const postLabel = toUserLabel(postUser);
                const postInitials = toInitials(postLabel);
                const postAvatarUrl = toAvatarUrl(postUser);
                const postImagesForItem = imagesByPostId.get(post.id) || [];
                const commentsForPost = commentsByPostId.get(post.id) || [];

                return (
                  <article
                    id={`post-${post.id}`}
                    key={post.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold tracking-wide text-slate-700">
                          {postAvatarUrl ? (
                            <Image
                              src={postAvatarUrl}
                              alt={`${postLabel} avatar`}
                              fill
                              unoptimized
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
                        </div>
                      </div>
                    </header>

                    <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{post.body}</p>

                    {postImagesForItem.length ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {postImagesForItem.map((image) => (
                          <a
                            key={image.id}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                          >
                            <div className="relative aspect-[4/3]">
                              <Image
                                src={image.url}
                                alt={image.filename || "Post image"}
                                fill
                                unoptimized
                                sizes="(max-width: 768px) 100vw, 420px"
                                className="object-cover transition duration-150 group-hover:scale-[1.02]"
                              />
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Comments ({commentsForPost.length})
                      </p>

                      <SocialCommentComposer postId={post.id} canPost={canPost} onComment={addComment} />

                      <div className="mt-3 space-y-2">
                        {commentsForPost.length ? (
                          commentsForPost.map((comment) => {
                            const commentUser = userById.get(comment.user_id);
                            const commentLabel = toUserLabel(commentUser);
                            const commentAvatarUrl = toAvatarUrl(commentUser);
                            const commentInitials = toInitials(commentLabel);
                            return (
                              <article
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
                                        unoptimized
                                        sizes="28px"
                                        className="object-cover"
                                      />
                                    ) : (
                                      commentInitials
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs text-slate-500">
                                      <span className="font-semibold text-slate-700">{commentLabel}</span> -{" "}
                                      {toDateTimeLabel(comment.created_at)}
                                    </p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
                                  </div>
                                </div>
                              </article>
                            );
                          })
                        ) : (
                          <p className="text-xs text-slate-500">No comments yet.</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
                No posts yet. Share the first update for this page.
              </section>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Page access</h2>
            <p className="mt-1 text-xs text-slate-600">
              Access is private. Add people manually to grant entry.
            </p>

            {canManagePage ? (
              <form action={addMember} className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
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
            ) : (
              <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                You can view members, but only page managers can edit access.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Members</h3>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {memberUserIds.size}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                    {toAvatarUrl(ownerUser) ? (
                      <Image
                        src={toAvatarUrl(ownerUser)}
                        alt={`${ownerLabel} avatar`}
                        fill
                        unoptimized
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
                    <div key={member.id} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700">
                          {memberAvatarUrl ? (
                            <Image
                              src={memberAvatarUrl}
                              alt={`${memberLabel} avatar`}
                              fill
                              unoptimized
                              sizes="28px"
                              className="object-cover"
                            />
                          ) : (
                            memberInitials
                          )}
                        </span>
                        <p className="text-xs font-semibold text-slate-900">{memberLabel}</p>
                      </div>

                      {canManagePage ? (
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
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-600">
                          {member.role === "manager" ? "Manager" : "Member"}
                        </p>
                      )}
                    </div>
                  );
                })}

              {!members.filter((member) => member.user_id !== socialPage.created_by).length ? (
                <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  No additional members yet.
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

