"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";

function safeReturnTo(value: unknown, fallback: string) {
  const next = String(value || "").trim();
  if (!next) return fallback;
  // Only allow internal redirects.
  if (!next.startsWith("/")) return fallback;
  return next;
}

export async function updateTaskInlineAction(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const taskId = String(formData.get("task_id") || "").trim();
  const clientId = String(formData.get("client_id") || "").trim();
  const projectId = String(formData.get("project_id") || "").trim();
  const status = String(formData.get("status") || "").trim();
  const priority = String(formData.get("priority") || "").trim();
  const assignee = String(formData.get("assignee_user_id") || "").trim();
  const startDate = String(formData.get("start_date") || "").trim();
  const dueDate = String(formData.get("due_date") || "").trim();
  const dueTime = String(formData.get("due_time") || "").trim();
  const assigneeIds = formData
    .getAll("assignee_user_ids")
    .map((value) => String(value).trim())
    .filter(Boolean);

  const returnTo = safeReturnTo(formData.get("return_to"), "/tasks");
  const updates: Record<string, string | null> = {};

  if (!taskId) {
    redirect(returnTo.includes("?") ? `${returnTo}&error=Missing%20task%20id` : `${returnTo}?error=Missing%20task%20id`);
  }

  if (formData.has("status")) {
    updates.status = normalizeTaskStatusOrDefault(status);
  }
  if (formData.has("client_id")) {
    updates.client_id = clientId || null;
  }
  if (formData.has("project_id")) {
    updates.project_id = projectId || null;
  }
  if (formData.has("priority")) {
    updates.priority = priority || null;
  }
  if (formData.has("assignee_user_id")) {
    updates.assignee_user_id = assignee || null;
  }
  if (formData.has("start_date")) {
    updates.start_date = startDate || null;
  }
  if (formData.has("due_date")) {
    updates.due_date = dueDate || null;
  }
  if (formData.has("due_time")) {
    updates.due_time = dueTime || null;
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);
    if (error) {
      redirect(
        returnTo.includes("?")
          ? `${returnTo}&error=${encodeURIComponent(error.message)}`
          : `${returnTo}?error=${encodeURIComponent(error.message)}`
      );
    }
  }

  if (formData.has("assignee_user_ids")) {
    const uniqueIds = Array.from(new Set(assigneeIds));
    await supabase.from("task_assignees").delete().eq("task_id", taskId);
    if (uniqueIds.length) {
      const inserts = uniqueIds.map((userId) => ({ task_id: taskId, user_id: userId }));
      const { error: assigneeError } = await supabase.from("task_assignees").insert(inserts);
      if (assigneeError) {
        redirect(
          returnTo.includes("?")
            ? `${returnTo}&error=${encodeURIComponent(assigneeError.message)}`
            : `${returnTo}?error=${encodeURIComponent(assigneeError.message)}`
        );
      }
    }
    // Keep legacy single-assignee column roughly in sync with the first selected assignee.
    const { error: primaryAssigneeError } = await supabase
      .from("tasks")
      .update({ assignee_user_id: uniqueIds[0] || null })
      .eq("id", taskId);
    if (primaryAssigneeError) {
      redirect(
        returnTo.includes("?")
          ? `${returnTo}&error=${encodeURIComponent(primaryAssigneeError.message)}`
          : `${returnTo}?error=${encodeURIComponent(primaryAssigneeError.message)}`
      );
    }
  }

  const pathOnly = returnTo.split("?")[0] || "/tasks";
  revalidatePath(pathOnly);
  return { ok: true };
}
