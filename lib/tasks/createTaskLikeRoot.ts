import { randomUUID } from "node:crypto";
import { DEFAULT_EDITOR_CONTENT } from "../editorContent";
import { normalizeTaskStatusOrDefault } from "../taskStatus";
import { extractPlainText } from "../tiptapText";
import type { createSupabaseServerClient } from "../supabase/server";

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

function logTaskCreate(
  level: "info" | "warn" | "error",
  event: string,
  payload: Record<string, unknown>
) {
  const entry = {
    scope: "task.create",
    event,
    at: new Date().toISOString(),
    ...payload,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

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
  content?: unknown | null;
  contentText?: string | null;
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
  content = null,
  contentText = null,
}: CreateTaskLikeRootParams): Promise<CreateTaskLikeRootResult> {
  const operationId = randomUUID();
  const startedAtMs = Date.now();
  const normalizedStatus = normalizeTaskStatusOrDefault(String(status || "to_do"));
  const normalizedPriority = String(priority || "medium").trim() || "medium";
  const normalizedDueDate = String(dueDate || "").trim() || null;
  const normalizedDueTime = String(dueTime || "").trim() || null;
  const normalizedStartDate = String(startDate || "").trim() || null;
  const normalizedTitle = String(title || "").trim();

  logTaskCreate("info", "start", {
    operationId,
    context,
    parentTaskId,
    clientId,
    projectId,
    createdByUserId,
    titleLength: normalizedTitle.length,
    status: normalizedStatus,
    priority: normalizedPriority,
    hasStartDate: Boolean(normalizedStartDate),
    hasDueDate: Boolean(normalizedDueDate),
    hasDueTime: Boolean(normalizedDueTime),
    hasRecurrence: Boolean(recurrenceValues),
  });

  if (!normalizedTitle) {
    logTaskCreate("warn", "validation_failed", {
      operationId,
      context,
      reason: "title_required",
      elapsedMs: Date.now() - startedAtMs,
    });
    throw new TaskCreateInputError(`${context}.input`, "Title is required");
  }

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
  const normalizedContent = content || DEFAULT_EDITOR_CONTENT;
  const normalizedContentText =
    String(contentText || "").trim() || extractPlainText(normalizedContent);

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
  logTaskCreate("info", "assignees_normalized", {
    operationId,
    context,
    explicitAssigneeCount: normalizedAssigneeIds.length,
    effectiveAssigneeCount: effectiveAssigneeIds.length,
    hasPrimaryAssignee: Boolean(primaryAssignee),
  });

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
    content: normalizedContent,
    content_text: normalizedContentText || defaultContentText,
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
    logTaskCreate("error", "tasks_insert_failed", {
      operationId,
      context,
      taskId,
      elapsedMs: Date.now() - startedAtMs,
      error: {
        message: taskInsertError.message,
        code: taskInsertError.code,
        details: taskInsertError.details,
        hint: taskInsertError.hint,
      },
    });
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
      logTaskCreate("error", "assignees_insert_failed", {
        operationId,
        context,
        taskId,
        elapsedMs: Date.now() - startedAtMs,
        assigneeCount: assigneeRows.length,
        error: {
          message: assigneeInsertError.message,
          code: assigneeInsertError.code,
          details: assigneeInsertError.details,
          hint: assigneeInsertError.hint,
        },
      });
      throw new TaskCreateDbError(
        `${context}.task_assignees.insert`,
        assigneeInsertError
      );
    }
  }

  logTaskCreate("info", "success", {
    operationId,
    context,
    taskId,
    elapsedMs: Date.now() - startedAtMs,
    effectiveAssigneeCount: effectiveAssigneeIds.length,
  });

  return {
    taskId,
    primaryAssignee: primaryAssignee || null,
    effectiveAssigneeIds,
  };
}
