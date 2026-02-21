import { randomUUID } from "node:crypto";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { normalizeTaskStatusOrDefault } from "@/lib/taskStatus";
import { extractPlainText } from "@/lib/tiptapText";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

const defaultContentText = extractPlainText(DEFAULT_EDITOR_CONTENT);

type DbErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

type RecurrenceValues = {
  recurrence_frequency?: string | null;
  recurrence_interval?: number | null;
  recurrence_weekdays?: number[] | null;
  recurrence_month_day?: number | null;
  recurrence_month_week?: number | null;
  recurrence_month_weekday?: number | null;
  recurrence_start_date?: string | null;
  recurrence_end_date?: string | null;
  recurrence_lead_days?: number | null;
  recurrence_next_date?: string | null;
  recurrence_timezone?: string | null;
};

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

export type CreateTaskLikeRootParams = {
  supabase: SupabaseServerClient;
  context: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  parentTaskId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  startDate?: string | null;
  createdByUserId: string;
  assigneeUserId?: string | null;
  assigneeUserIds?: string[];
  defaultAssigneeUserId?: string | null;
  recurrenceValues?: RecurrenceValues | null;
};

export type CreateTaskLikeRootResult = {
  taskId: string;
  primaryAssignee: string | null;
  effectiveAssigneeIds: string[];
};

export class TaskCreateInputError extends Error {
  context: string;

  constructor(context: string, message: string) {
    super(message);
    this.name = "TaskCreateInputError";
    this.context = context;
  }
}

export class TaskCreateDbError extends Error {
  context: string;
  dbError: DbErrorLike;

  constructor(context: string, dbError: DbErrorLike) {
    super(dbError.message);
    this.name = "TaskCreateDbError";
    this.context = context;
    this.dbError = dbError;
  }
}

export async function createTaskLikeRoot({
  supabase,
  context,
  title,
  status,
  priority,
  clientId = null,
  projectId = null,
  parentTaskId = null,
  dueDate = null,
  dueTime = null,
  startDate = null,
  createdByUserId,
  assigneeUserId = "",
  assigneeUserIds = [],
  defaultAssigneeUserId = null,
  recurrenceValues = null,
}: CreateTaskLikeRootParams): Promise<CreateTaskLikeRootResult> {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) {
    throw new TaskCreateInputError(`${context}.input`, "Title is required");
  }

  const normalizedStatus = normalizeTaskStatusOrDefault(String(status || "to_do"));
  const normalizedPriority = String(priority || "medium").trim() || "medium";
  const normalizedDueDate = String(dueDate || "").trim() || null;
  const normalizedDueTime = String(dueTime || "").trim() || null;
  const normalizedStartDate = String(startDate || "").trim() || null;

  const normalizedAssigneeIds = Array.from(
    new Set(
      (assigneeUserIds || [])
        .map((value) => String(value).trim())
        .filter(Boolean)
        .filter((value) => value !== "unassigned")
    )
  );

  const normalizedAssigneeUserId = String(assigneeUserId || "").trim();
  const normalizedDefaultAssigneeUserId = String(defaultAssigneeUserId || "").trim();

  const primaryAssignee =
    normalizedAssigneeIds[0] ||
    normalizedAssigneeUserId ||
    normalizedDefaultAssigneeUserId ||
    "";
  const effectiveAssigneeIds = normalizedAssigneeIds.length
    ? normalizedAssigneeIds
    : primaryAssignee
      ? [primaryAssignee]
      : [];

  const taskId = randomUUID();
  const payload: Record<string, unknown> = {
    id: taskId,
    client_id: clientId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    title: normalizedTitle,
    status: normalizedStatus,
    priority: normalizedPriority,
    due_date: normalizedDueDate,
    due_time: normalizedDueTime,
    assignee_user_id: primaryAssignee || null,
    created_by_user_id: createdByUserId,
    content: DEFAULT_EDITOR_CONTENT,
    content_text: defaultContentText,
  };

  if (normalizedStartDate) {
    payload.start_date = normalizedStartDate;
  }

  if (recurrenceValues) {
    for (const [key, value] of Object.entries(recurrenceValues)) {
      if (typeof value === "undefined") continue;
      payload[key] = value;
    }
  }

  const { error: taskInsertError } = await supabase.from("tasks").insert(payload);
  if (taskInsertError) {
    throw new TaskCreateDbError(`${context}.tasks.insert`, taskInsertError);
  }

  if (effectiveAssigneeIds.length) {
    const assigneeRows = effectiveAssigneeIds.map((userId) => ({
      task_id: taskId,
      user_id: userId,
    }));
    const { error: assigneeInsertError } = await supabase
      .from("task_assignees")
      .insert(assigneeRows);
    if (assigneeInsertError) {
      throw new TaskCreateDbError(
        `${context}.task_assignees.insert`,
        assigneeInsertError
      );
    }
  }

  return {
    taskId,
    primaryAssignee: primaryAssignee || null,
    effectiveAssigneeIds,
  };
}
