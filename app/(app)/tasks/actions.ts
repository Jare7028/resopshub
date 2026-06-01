"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { resolveAssignmentTargetsToUserIds } from "@/lib/assignmentGroups";
import { parseCsvParam } from "@/lib/queryParams";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
} from "@/lib/taskSorting";

function safeReturnTo(value: unknown, fallback: string) {
  const next = String(value || "").trim();
  if (!next) return fallback;
  // Only allow internal redirects.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

export async function updateTaskInlineAction(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const taskId = String(formData.get("task_id") || "").trim();
  const clientId = String(formData.get("client_id") || "").trim();
  const projectId = String(formData.get("project_id") || "").trim();
  const status = String(formData.get("status") || "").trim();
  const priority = String(formData.get("priority") || "").trim();
  const startDate = String(formData.get("start_date") || "").trim();
  const dueDate = String(formData.get("due_date") || "").trim();
  const dueTime = String(formData.get("due_time") || "").trim();
  const returnTo = safeReturnTo(formData.get("return_to"), "/tasks");
  const assigneesUpdated = formData.has("assignee_user_ids");
  const assigneeResolution = await resolveAssignmentTargetsToUserIds(
    supabase,
    formData.getAll("assignee_user_ids")
  );
  if (assigneeResolution.error) {
    return { ok: false, error: assigneeResolution.error };
  }
  const assigneeIds = assigneeResolution.userIds.filter(
    (value) => Boolean(value) && value !== "unassigned"
  );

  if (!taskId) {
    return { ok: false, error: "Missing task id" };
  }

  const { data, error } = await supabase.rpc("update_task_inline", {
    p_task_id: taskId,
    p_has_status: formData.has("status"),
    p_status: formData.has("status") ? normalizeTaskStatusOrDefault(status) : null,
    p_has_priority: formData.has("priority"),
    p_priority: formData.has("priority") ? priority || null : null,
    p_has_client_id: formData.has("client_id"),
    p_client_id: formData.has("client_id") ? clientId || null : null,
    p_has_project_id: formData.has("project_id"),
    p_project_id: formData.has("project_id") ? projectId || null : null,
    p_has_start_date: formData.has("start_date"),
    p_start_date: formData.has("start_date") ? startDate || null : null,
    p_has_due_date: formData.has("due_date"),
    p_due_date: formData.has("due_date") ? dueDate || null : null,
    p_has_due_time: formData.has("due_time"),
    p_due_time: formData.has("due_time") ? dueTime || null : null,
    p_has_assignees: assigneesUpdated,
    p_assignee_user_ids: assigneesUpdated ? Array.from(new Set(assigneeIds)) : [],
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const pathOnly = returnTo.split("?")[0] || "/tasks";
  revalidatePath(pathOnly);
  return { ok: true, task: Array.isArray(data) ? data[0] || null : null };
}

function normalizePreferenceValues(value: unknown) {
  return parseCsvParam(value)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeViewMode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "gantt" || normalized === "board" ? normalized : "table";
}

export async function saveTaskTablePreferencesAction(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData.user;
  if (!authUser?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const authEmail = String(authUser.email || "").trim();
  const currentUserProfileQuery = supabase.from("users").select("id");
  const { data: currentUserProfile, error: profileError } = await (authEmail
    ? currentUserProfileQuery.eq("email", authEmail).maybeSingle()
    : currentUserProfileQuery.eq("id", authUser.id).maybeSingle());

  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  const currentAppUserId = currentUserProfile?.id || null;
  if (!currentAppUserId) {
    return { ok: false, error: "User profile not found" };
  }

  const due = String(formData.get("due") || "all").trim();
  const normalizedDue =
    due === "overdue" || due === "next_7" || due === "none" ? due : "all";
  const { error } = await supabase.from("user_task_table_preferences").upsert(
    {
      user_id: currentAppUserId,
      status: normalizePreferenceValues(formData.get("status")),
      priority: normalizePreferenceValues(formData.get("priority")),
      assignee: normalizePreferenceValues(formData.get("assignee")),
      client: normalizePreferenceValues(formData.get("client")),
      project: normalizePreferenceValues(formData.get("project")),
      due: normalizedDue,
      hide_completed: String(formData.get("hide_completed") || "1") !== "0",
      include_watching: String(formData.get("include_watching") || "0") === "1",
      sort_key: normalizeTaskSortKey(String(formData.get("sort_key") || "")),
      sort_dir: normalizeTaskSortDir(String(formData.get("sort_dir") || "")),
      view_mode: normalizeViewMode(formData.get("view_mode")),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
