import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  extractMentionHandles,
  resolveMentionHandlesToRecipients,
} from "@/lib/mentions";

type MentionSourceType = "personal_page" | "client_note" | "task";

type MentionNotificationInput = {
  actorAuthUserId: string | null;
  previousText: string | null | undefined;
  nextText: string;
  sourceType: MentionSourceType;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null | undefined;
};

type MentionUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  status?: string | null;
};

const SOURCE_LABEL: Record<MentionSourceType, string> = {
  personal_page: "personal page",
  client_note: "client note",
  task: "task",
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
  const supabaseAdmin = createSupabaseAdminClient();

  const fullQuery = await supabaseAdmin
    .from("users")
    .select("id,email,full_name,status");

  if (!fullQuery.error) {
    return (fullQuery.data || []) as MentionUserRow[];
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

  return (fallbackQuery.data || []) as MentionUserRow[];
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
    console.warn(
      "[mentions.notify] Missing SUPABASE_SERVICE_ROLE_KEY; mention notifications skipped."
    );
    return;
  }

  const allUsers = await fetchMentionCandidates();
  const activeUsers = allUsers.filter(
    (user) => String(user.status || "active").toLowerCase() !== "disabled"
  );
  const mentionMap = resolveMentionHandlesToRecipients(addedHandles, activeUsers);
  mentionMap.delete(input.actorAuthUserId);

  if (!mentionMap.size) {
    return;
  }

  const sourceLabel = SOURCE_LABEL[input.sourceType] || "item";
  const excerpt = buildExcerpt(input.nextText, addedHandles);
  const sourceTitle = String(input.sourceTitle || "").trim();
  const supabaseAdmin = createSupabaseAdminClient();
  const notifications = Array.from(mentionMap.entries()).map(
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
