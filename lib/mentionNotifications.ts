import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  extractMentionHandles,
  resolveMentionHandlesToRecipients,
} from "@/lib/mentions";
import { logWarn } from "@/lib/vercelLogger";

type MentionSourceType =
  | "personal_page"
  | "client_note"
  | "task"
  | "social_post"
  | "social_comment"
  | "chat_message"
  | "feature_suggestion"
  | "feature_suggestion_comment"
  | "form_submission_comment";

type MentionNotificationInput = {
  actorAuthUserId: string | null;
  previousText: string | null | undefined;
  nextText: string;
  sourceType: MentionSourceType;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null | undefined;
  allowedRecipientUserIds?: string[] | null | undefined;
};

type MentionUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  status?: string | null;
};

type MentionPrefsRow = {
  user_id: string;
  mentions_enabled?: boolean | null;
  mention_task?: boolean | null;
  mention_notes?: boolean | null;
  mention_chat?: boolean | null;
  mention_social?: boolean | null;
  mention_feature_suggestion?: boolean | null;
  mention_form_submission?: boolean | null;
  mention_quiz?: boolean | null;
};

const MENTION_USER_CACHE_TTL_MS = 60_000;
let mentionCandidatesCache:
  | {
      expiresAt: number;
      rows: MentionUserRow[];
    }
  | null = null;

const SOURCE_LABEL: Record<MentionSourceType, string> = {
  personal_page: "personal page",
  client_note: "client note",
  task: "task",
  social_post: "social post",
  social_comment: "social comment",
  chat_message: "chat message",
  feature_suggestion: "feature suggestion",
  feature_suggestion_comment: "feature suggestion comment",
  form_submission_comment: "form submission comment",
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";
  return code === "42703" || message.includes("does not exist");
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";
  return code === "42P01" || message.includes("does not exist");
}

function resolveMentionPrefKey(sourceType: MentionSourceType) {
  if (sourceType === "task") return "mention_task";
  if (sourceType === "personal_page" || sourceType === "client_note") {
    return "mention_notes";
  }
  if (sourceType === "chat_message") return "mention_chat";
  if (sourceType === "social_post" || sourceType === "social_comment") {
    return "mention_social";
  }
  if (
    sourceType === "feature_suggestion" ||
    sourceType === "feature_suggestion_comment"
  ) {
    return "mention_feature_suggestion";
  }
  if (sourceType === "form_submission_comment") return "mention_form_submission";
  return null;
}

function mentionPrefsAllowSource(
  prefs: MentionPrefsRow | null | undefined,
  sourceType: MentionSourceType
) {
  if (!prefs) {
    return true;
  }
  if (prefs.mentions_enabled === false) {
    return false;
  }
  const prefKey = resolveMentionPrefKey(sourceType);
  if (!prefKey) {
    return true;
  }
  const value = prefs[prefKey];
  return value !== false;
}

function buildExcerpt(text: string, handles: string[]) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 220) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  let start = 0;
  for (const handle of handles) {
    const index = lower.indexOf(`@${handle}`);
    if (index >= 0) {
      start = Math.max(0, index - 80);
      break;
    }
  }

  const snippet = normalized.slice(start, start + 220).trim();
  if (!snippet) {
    return null;
  }
  const prefix = start > 0 ? "..." : "";
  const suffix = start + 220 < normalized.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

async function fetchMentionCandidates() {
  const now = Date.now();
  if (mentionCandidatesCache && mentionCandidatesCache.expiresAt > now) {
    return mentionCandidatesCache.rows;
  }

  const supabaseAdmin = createSupabaseAdminClient();

  const fullQuery = await supabaseAdmin
    .from("users")
    .select("id,email,full_name,status");

  if (!fullQuery.error) {
    const rows = (fullQuery.data || []) as MentionUserRow[];
    mentionCandidatesCache = {
      expiresAt: now + MENTION_USER_CACHE_TTL_MS,
      rows,
    };
    return rows;
  }

  if (!isMissingColumnError(fullQuery.error)) {
    throw new Error(fullQuery.error.message);
  }

  const fallbackQuery = await supabaseAdmin
    .from("users")
    .select("id,email,full_name");

  if (fallbackQuery.error) {
    throw new Error(fallbackQuery.error.message);
  }

  const fallbackRows = (fallbackQuery.data || []) as MentionUserRow[];
  mentionCandidatesCache = {
    expiresAt: now + MENTION_USER_CACHE_TTL_MS,
    rows: fallbackRows,
  };
  return fallbackRows;
}

async function fetchMentionPreferenceMap(userIds: string[]) {
  const normalizedIds = Array.from(
    new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!normalizedIds.length) {
    return new Map<string, MentionPrefsRow>();
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const withExpandedColumns = await supabaseAdmin
    .from("user_notification_preferences")
    .select(
      "user_id,mentions_enabled,mention_task,mention_notes,mention_chat,mention_social,mention_feature_suggestion,mention_form_submission,mention_quiz"
    )
    .in("user_id", normalizedIds);

  if (!withExpandedColumns.error) {
    const map = new Map<string, MentionPrefsRow>();
    ((withExpandedColumns.data || []) as MentionPrefsRow[]).forEach((row) => {
      if (row?.user_id) {
        map.set(row.user_id, row);
      }
    });
    return map;
  }

  if (
    isMissingTableError(withExpandedColumns.error) ||
    isMissingColumnError(withExpandedColumns.error)
  ) {
    return new Map<string, MentionPrefsRow>();
  }

  throw new Error(withExpandedColumns.error.message);
}

export async function notifyMentionedUsersFromTextChange(
  input: MentionNotificationInput
) {
  if (!input.actorAuthUserId) {
    return;
  }

  const nextHandles = extractMentionHandles(input.nextText);
  if (!nextHandles.length) {
    return;
  }

  const previousHandles = new Set(
    extractMentionHandles(String(input.previousText || ""))
  );
  const addedHandles = nextHandles.filter((handle) => !previousHandles.has(handle));

  if (!addedHandles.length) {
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logWarn("mentions.notify.service_role_missing", {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
    return;
  }

  const allUsers = await fetchMentionCandidates();
  const activeUsers = allUsers.filter(
    (user) => String(user.status || "active").toLowerCase() !== "disabled"
  );
  const allowedRecipientUserIds = new Set(
    (Array.isArray(input.allowedRecipientUserIds) ? input.allowedRecipientUserIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const candidateUsers = allowedRecipientUserIds.size
    ? activeUsers.filter((user) => allowedRecipientUserIds.has(user.id))
    : activeUsers;
  const mentionMap = resolveMentionHandlesToRecipients(addedHandles, candidateUsers);
  mentionMap.delete(input.actorAuthUserId);

  if (!mentionMap.size) {
    return;
  }

  const mentionRecipientIds = Array.from(mentionMap.keys());
  const mentionPreferenceMap = await fetchMentionPreferenceMap(mentionRecipientIds);
  const filteredMentionEntries = Array.from(mentionMap.entries()).filter(
    ([recipientUserId]) =>
      mentionPrefsAllowSource(
        mentionPreferenceMap.get(recipientUserId),
        input.sourceType
      )
  );
  if (!filteredMentionEntries.length) {
    return;
  }

  const sourceLabel = SOURCE_LABEL[input.sourceType] || "item";
  const excerpt = buildExcerpt(input.nextText, addedHandles);
  const sourceTitle = String(input.sourceTitle || "").trim();
  const supabaseAdmin = createSupabaseAdminClient();
  const notifications = filteredMentionEntries.map(
    ([recipientUserId, recipientHandles]) => ({
      user_id: recipientUserId,
      actor_user_id: input.actorAuthUserId,
      type: "user_mentioned",
      task_id: null,
      title: `Mentioned in a ${sourceLabel}`,
      body: sourceTitle || excerpt || null,
      metadata: {
        source_type: input.sourceType,
        source_id: input.sourceId,
        source_url: input.sourceUrl,
        source_title: sourceTitle || null,
        mentioned_handles: recipientHandles,
        excerpt,
      },
    })
  );

  if (!notifications.length) {
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("notifications")
    .insert(notifications);

  if (insertError) {
    throw new Error(insertError.message);
  }
}
