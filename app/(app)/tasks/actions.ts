"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { resolveAssignmentTargetsToUserIds } from "@/lib/assignmentGroups";

function safeReturnTo(value: unknown, fallback: string) {
  const next = String(value || "").trim();
  if (!next) return fallback;
  // Only allow internal redirects.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

function buildReturnToErrorUrl(returnTo: string, message: string) {
  return returnTo.includes("?")
    ? `${returnTo}&error=${encodeURIComponent(message)}`
    : `${returnTo}?error=${encodeURIComponent(message)}`;
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
  const returnTo = safeReturnTo(formData.get("return_to"), "/tasks");
  const assigneeResolution = await resolveAssignmentTargetsToUserIds(
    supabase,
    formData.getAll("assignee_user_ids")
  );
  if (assigneeResolution.error) {
    redirect(
      returnTo.includes("?")
        ? `${returnTo}&error=${encodeURIComponent(assigneeResolution.error)}`
        : `${returnTo}?error=${encodeURIComponent(assigneeResolution.error)}`
    );
  }
  const assigneeIds = assigneeResolution.userIds.filter(
    (value) => Boolean(value) && value !== "unassigned"
  );
  const updates: Record<string, string | null> = {};
  const assigneesUpdated = formData.has("assignee_user_ids");
  let rollbackTaskSnapshot:
    | {
        status: string | null;
        client_id: string | null;
        project_id: string | null;
        priority: string | null;
        assignee_user_id: string | null;
        start_date: string | null;
        due_date: string | null;
        due_time: string | null;
      }
    | null = null;
  let taskUpdated = false;

  if (!taskId) {
    redirect(buildReturnToErrorUrl(returnTo, "Missing task id"));
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

  if (Object.keys(updates).length && assigneesUpdated) {
    const { data: taskSnapshot, error: taskSnapshotError } = await supabase
      .from("tasks")
      .select(
        "status,client_id,project_id,priority,assignee_user_id,start_date,due_date,due_time"
      )
      .eq("id", taskId)
      .maybeSingle();
    if (taskSnapshotError) {
      redirect(buildReturnToErrorUrl(returnTo, taskSnapshotError.message));
    }
    rollbackTaskSnapshot = taskSnapshot || null;
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);
    if (error) {
      redirect(buildReturnToErrorUrl(returnTo, error.message));
    }
    taskUpdated = true;
  }

  if (assigneesUpdated) {
    const uniqueIds = Array.from(new Set(assigneeIds));
    const { error: replaceAssigneesError } = await supabase.rpc("replace_task_assignees", {
      p_task_id: taskId,
      p_assignee_user_ids: uniqueIds,
    });
    if (replaceAssigneesError) {
      if (taskUpdated && rollbackTaskSnapshot) {
        const { error: rollbackError } = await supabase
          .from("tasks")
          .update(rollbackTaskSnapshot)
          .eq("id", taskId);
        if (rollbackError) {
          console.error("[tasks.inline.rollback]", rollbackError.message);
        }
      }
      redirect(buildReturnToErrorUrl(returnTo, replaceAssigneesError.message));
    }
  }

  const pathOnly = returnTo.split("?")[0] || "/tasks";
  revalidatePath(pathOnly);
  return { ok: true };
}
