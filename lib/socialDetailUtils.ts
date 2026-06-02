export type SocialPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type SocialPageMemberRow = {
  id: string;
  page_id: string;
  user_id: string;
  role: "member" | "manager";
  created_at: string;
};

export type SocialPostRow = {
  id: string;
  page_id: string;
  user_id: string;
  body: string;
  is_pinned: boolean;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialPostImageRow = {
  id: string;
  post_id: string;
  storage_path: string;
  url: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
};

export type SocialPostCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialPostViewRow = {
  post_id: string;
  user_id: string;
  viewed_at: string;
};

export type SocialPostReactionRow = {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type SocialCommentReactionRow = {
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type SocialPageReadRow = {
  page_id: string;
  user_id: string;
  last_read_at: string;
};

export type SocialUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  avatar_url: string | null;
};

export type PostImageInput = {
  storage_path: string;
  url: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

export type SocialPostFilter = "all" | "pinned" | "mine" | "unread";
export type SocialDetailPanel = "none" | "compose" | "edit";

export const SOCIAL_REACTION_OPTIONS = ["👍", "❤️", "🎉", "🔥", "👏"] as const;
export const SOCIAL_POSTS_PAGE_SIZE = 20;
export const SOCIAL_REACTION_OPTION_SET = new Set<string>(SOCIAL_REACTION_OPTIONS);

export function parsePostImagesJson(raw: string): PostImageInput[] {
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
      const mimeType =
        String(row.mime_type || "application/octet-stream").trim() ||
        "application/octet-stream";
      const sizeRaw = Number(row.size_bytes);
      const sizeBytes =
        Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.round(sizeRaw) : 0;

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

export function toUserLabel(
  user: { full_name: string | null; email: string | null } | null | undefined
) {
  if (!user) return "Unknown user";
  return user.full_name || user.email || "Unknown user";
}

export function toInitials(label: string) {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export function toAvatarUrl(
  user: { avatar_url: string | null } | null | undefined
) {
  return String(user?.avatar_url || "").trim();
}

export function toDateTimeLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

export function toViewerSummary(viewerLabels: string[]) {
  if (!viewerLabels.length) return "No views yet";
  if (viewerLabels.length === 1) return `Seen by ${viewerLabels[0]}`;
  if (viewerLabels.length === 2) {
    return `Seen by ${viewerLabels[0]} and ${viewerLabels[1]}`;
  }
  return `Seen by ${viewerLabels[0]}, ${viewerLabels[1]} +${viewerLabels.length - 2}`;
}

export function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function normalizePostFilter(value: string): SocialPostFilter {
  if (value === "pinned") return "pinned";
  if (value === "mine") return "mine";
  if (value === "unread") return "unread";
  return "all";
}

export function normalizeRole(value: string): "member" | "manager" {
  return value === "manager" ? "manager" : "member";
}

export function normalizeSocialPanel(value: string): SocialDetailPanel {
  if (value === "compose") return "compose";
  if (value === "edit") return "edit";
  return "none";
}

export function buildSocialDetailUrl(
  pageId: string,
  extra?: { error?: string; success?: string },
  options?: {
    q?: string;
    filter?: SocialPostFilter;
    p?: number;
    panel?: SocialDetailPanel | null;
  }
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
