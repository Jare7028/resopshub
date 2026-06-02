import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
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

export type QuickCreateTaskScope = {
  clientId?: string | null;
  projectId?: string | null;
  context?: string;
  revalidatePaths?: string[];
};

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

export async function quickCreateTaskFromForm(
  formData: FormData,
  scope: QuickCreateTaskScope = {}
): Promise<QuickCreateTaskResult> {
  const context = String(scope.context || "tasks.quickCreate").trim() || "tasks.quickCreate";
  const scopedClientId = String(scope.clientId || "").trim() || null;
  const scopedProjectId = String(scope.projectId || "").trim() || null;
  const revalidatePaths = Array.from(
    new Set(
      ["/tasks", ...(scope.revalidatePaths || [])].filter(
        (path) => path && path.startsWith("/") && !path.startsWith("//")
      )
    )
  );
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, `${context}.auth`);
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
      context,
      title,
      status: "to_do",
      priority: "medium",
      clientId: scopedClientId,
      projectId: scopedProjectId,
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
    client_id: scopedClientId,
    project_id: scopedProjectId,
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
        error: formatDbError(`${context}.subtasks.insert`, subtaskInsertError),
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
          error: formatDbError(`${context}.subtask_assignees.insert`, subtaskAssigneesError),
        };
      }
    }
  }

  revalidatePaths.forEach((path) => revalidatePath(path));

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
      client_id: scopedClientId,
      project_id: scopedProjectId,
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
