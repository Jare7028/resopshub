"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { resolveAssignmentTargetsToUserIds } from "@/lib/assignmentGroups";
import { parseCsvParam } from "@/lib/queryParams";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
} from "@/lib/taskSorting";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { plainTextToTiptapDoc } from "@/lib/plainTextToTiptapDoc";
import { extractPlainText } from "@/lib/tiptapText";
import {
  createTaskLikeRoot,
  TaskCreateDbError,
  TaskCreateInputError,
} from "@/lib/tasks/createTaskLikeRoot";

const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

export type QuickCreateTaskResult =
  | {
      ok: true;
      task: {
        id: string;
        title: string;
        status: string | null;
        priority: string | null;
        start_date: string | null;
        due_date: string | null;
        due_time: string | null;
        created_at: string | null;
        assignee_user_id: string | null;
        client_id: string | null;
        project_id: string | null;
        clients: null;
        projects: null;
      };
      assigneeUserIds: string[];
      openSubtaskCount: number;
      subtasks: Array<{
        id: string;
        parent_task_id: string;
        title: string;
        status: string | null;
        priority: string | null;
        start_date: string | null;
        due_date: string | null;
        due_time: string | null;
        assignee_user_id: string | null;
        client_id: string | null;
        project_id: string | null;
        clients: null;
        projects: null;
        assignee_user_ids: string[];
      }>;
    }
  | {
      ok: false;
      error: string;
    };

function safeReturnTo(value: unknown, fallback: string) {
  const next = String(value || "").trim();
  if (!next) return fallback;
  // Only allow internal redirects.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

function formatDbError(
  context: string,
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null | undefined
) {
  if (!error) return context;
  const parts = [`[${context}]`, error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

export async function quickCreateTaskAction(
  formData: FormData
): Promise<QuickCreateTaskResult> {
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "tasks.quickCreate.auth");
  if (!authUser?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const authEmail = String(authUser.email || "").trim();
  const currentUserProfileQuery = supabase.from("users").select("id,status");
  const { data: currentUserProfile, error: profileError } = await (authEmail
    ? currentUserProfileQuery.eq("email", authEmail).maybeSingle()
    : currentUserProfileQuery.eq("id", authUser.id).maybeSingle());

  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  const currentAppUserId = String(currentUserProfile?.id || "").trim();
  if (!currentAppUserId) {
    return { ok: false, error: "User profile not found" };
  }

  const currentUserStatus = String(currentUserProfile?.status || "active")
    .trim()
    .toLowerCase();
  if (currentUserStatus === "disabled") {
    return { ok: false, error: "Your user profile is disabled" };
  }

  const title = String(formData.get("title") || "").trim();
  if (!title) {
    return { ok: false, error: "Title is required" };
  }
  if (title.length > 180) {
    return { ok: false, error: "Title must be 180 characters or fewer" };
  }

  const notesText = String(formData.get("notes") || "").trim();
  if (notesText.length > 12000) {
    return { ok: false, error: "Task notes are too long" };
  }

  const subtaskTitles = formData
    .getAll("subtask_titles")
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 20);
  if (subtaskTitles.some((subtaskTitle) => subtaskTitle.length > 180)) {
    return { ok: false, error: "Subtask titles must be 180 characters or fewer" };
  }

  const content = notesText ? plainTextToTiptapDoc(notesText) : DEFAULT_EDITOR_CONTENT;
  const contentText = notesText || defaultContentText;

  let taskId = "";
  let primaryAssignee: string | null = currentAppUserId;
  let effectiveAssigneeIds: string[] = [currentAppUserId];
  try {
    const created = await createTaskLikeRoot({
      supabase,
      context: "tasks.quickCreate",
      title,
      status: "to_do",
      priority: "medium",
      createdByUserId: authUser.id,
      defaultAssigneeUserId: currentAppUserId,
      content,
      contentText,
    });
    taskId = created.taskId;
    primaryAssignee = created.primaryAssignee;
    effectiveAssigneeIds = created.effectiveAssigneeIds;
  } catch (error) {
    if (error instanceof TaskCreateDbError) {
      return { ok: false, error: formatDbError(error.context, error.dbError) };
    }
    if (error instanceof TaskCreateInputError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create task",
    };
  }

  const createdAt = new Date().toISOString();
  const subtasks = subtaskTitles.map((subtaskTitle) => ({
    id: randomUUID(),
    client_id: null,
    project_id: null,
    parent_task_id: taskId,
    title: subtaskTitle,
    status: normalizeTaskStatusOrDefault("to_do"),
    priority: "medium",
    start_date: null,
    due_date: null,
    due_time: null,
    assignee_user_id: primaryAssignee,
    created_by_user_id: authUser.id,
    content: DEFAULT_EDITOR_CONTENT,
    content_text: defaultContentText,
  }));

  if (subtasks.length) {
    const { error: subtaskInsertError } = await supabase.from("tasks").insert(subtasks);
    if (subtaskInsertError) {
      return {
        ok: false,
        error: formatDbError("tasks.quickCreate.subtasks.insert", subtaskInsertError),
      };
    }

    const subtaskAssigneeRows = subtasks.flatMap((subtask) =>
      effectiveAssigneeIds.map((userId) => ({ task_id: subtask.id, user_id: userId }))
    );
    if (subtaskAssigneeRows.length) {
      const { error: subtaskAssigneesError } = await supabase
        .from("task_assignees")
        .insert(subtaskAssigneeRows);
      if (subtaskAssigneesError) {
        return {
          ok: false,
          error: formatDbError(
            "tasks.quickCreate.subtask_assignees.insert",
            subtaskAssigneesError
          ),
        };
      }
    }
  }

  revalidatePath("/tasks");

  return {
    ok: true,
    task: {
      id: taskId,
      title,
      status: "to_do",
      priority: "medium",
      start_date: null,
      due_date: null,
      due_time: null,
      created_at: createdAt,
      assignee_user_id: primaryAssignee,
      client_id: null,
      project_id: null,
      clients: null,
      projects: null,
    },
    assigneeUserIds: effectiveAssigneeIds,
    openSubtaskCount: subtasks.length,
    subtasks: subtasks.map((subtask) => ({
      id: subtask.id,
      parent_task_id: taskId,
      title: subtask.title,
      status: subtask.status,
      priority: subtask.priority,
      start_date: subtask.start_date,
      due_date: subtask.due_date,
      due_time: subtask.due_time,
      assignee_user_id: subtask.assignee_user_id,
      client_id: subtask.client_id,
      project_id: subtask.project_id,
      clients: null,
      projects: null,
      assignee_user_ids: effectiveAssigneeIds,
    })),
  };
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
  const authUser = await getCurrentRequestUser(
    supabase,
    "tasks.table_preferences.auth"
  );
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
