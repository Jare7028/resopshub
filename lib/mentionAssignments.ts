import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractMentionHandles,
  resolveMentionHandlesToRecipients,
} from "@/lib/mentions";

type MentionAssignableSourceType = "task" | "client_note" | "personal_page";

type MentionAssignmentInput = {
  actorAuthUserId: string | null;
  previousText: string | null | undefined;
  nextText: string;
  sourceType: MentionAssignableSourceType;
  sourceId: string;
};

type MentionUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  status?: string | null;
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
  return code === "42P01" || message.includes("relation") || message.includes("does not exist");
}

async function fetchMentionCandidates() {
  let client: ReturnType<typeof createSupabaseAdminClient> | ReturnType<typeof createSupabaseServerClient>;
  try {
    client = createSupabaseAdminClient();
  } catch {
    client = createSupabaseServerClient();
  }

  const fullQuery = await client
    .from("users")
    .select("id,email,full_name,status");

  if (!fullQuery.error) {
    return (fullQuery.data || []) as MentionUserRow[];
  }

  if (!isMissingColumnError(fullQuery.error)) {
    throw new Error(fullQuery.error.message);
  }

  const fallbackQuery = await client
    .from("users")
    .select("id,email,full_name");

  if (fallbackQuery.error) {
    throw new Error(fallbackQuery.error.message);
  }

  return (fallbackQuery.data || []) as MentionUserRow[];
}

export async function syncMentionAssignmentsFromTextChange(
  input: MentionAssignmentInput
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

  const allUsers = await fetchMentionCandidates();
  const activeUsers = allUsers.filter(
    (user) => String(user.status || "active").toLowerCase() !== "disabled"
  );
  const mentionMap = resolveMentionHandlesToRecipients(addedHandles, activeUsers);
  mentionMap.delete(input.actorAuthUserId);
  if (!mentionMap.size) {
    return;
  }

  const mentionedUserIds = Array.from(mentionMap.keys());
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const writeClient = hasServiceRole
    ? createSupabaseAdminClient()
    : createSupabaseServerClient();

  if (input.sourceType === "task") {
    const assigneeRows = mentionedUserIds.map((userId) => ({
      task_id: input.sourceId,
      user_id: userId,
    }));
    const { error: assigneeError } = await writeClient
      .from("task_assignees")
      .upsert(assigneeRows, {
        onConflict: "task_id,user_id",
        ignoreDuplicates: true,
      });
    if (assigneeError) {
      throw new Error(assigneeError.message);
    }

    const primaryMentionedUserId = mentionedUserIds[0] || null;
    if (primaryMentionedUserId) {
      const { error: updateError } = await writeClient
        .from("tasks")
        .update({ assignee_user_id: primaryMentionedUserId })
        .eq("id", input.sourceId)
        .is("assignee_user_id", null);
      if (updateError) {
        throw new Error(updateError.message);
      }
    }
    return;
  }

  if (!hasServiceRole) {
    console.warn(
      "[mentions.assign] Missing SUPABASE_SERVICE_ROLE_KEY; non-task mention assignments skipped."
    );
    return;
  }

  const mentionRows = mentionedUserIds.map((userId) => ({
    source_type: input.sourceType,
    source_id: input.sourceId,
    user_id: userId,
    mentioned_by_user_id: input.actorAuthUserId,
  }));

  const { error: mentionError } = await writeClient
    .from("text_mention_assignees")
    .upsert(mentionRows, {
      onConflict: "source_type,source_id,user_id",
      ignoreDuplicates: true,
    });

  if (mentionError && !isMissingTableError(mentionError)) {
    throw new Error(mentionError.message);
  }
}
