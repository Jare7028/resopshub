import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_CONTENT } from "../editorContent";
import { plainTextToTiptapDoc } from "../plainTextToTiptapDoc";
import { extractPlainText } from "../tiptapText";
import {
  TaskCreateDbError,
  TaskCreateInputError,
  createTaskLikeRoot,
} from "./createTaskLikeRoot";

type InsertError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

function createInsertRecorder(errors: Partial<Record<string, InsertError>> = {}) {
  const inserts: Record<string, unknown[]> = {};
  const supabase = {
    from(table: string) {
      return {
        insert(payload: unknown | unknown[]) {
          inserts[table] = Array.isArray(payload) ? payload : [payload];
          return Promise.resolve({ error: errors[table] || null });
        },
      };
    },
  };

  return { supabase, inserts };
}

describe("createTaskLikeRoot", () => {
  it("rejects blank task titles before inserting rows", async () => {
    const { supabase, inserts } = createInsertRecorder();

    await expect(
      createTaskLikeRoot({
        supabase: supabase as never,
        context: "test.blank",
        title: "   ",
        createdByUserId: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toBeInstanceOf(TaskCreateInputError);

    expect(inserts).toEqual({});
  });

  it("preserves supplied content and searchable text while cloning task-like roots", async () => {
    const { supabase, inserts } = createInsertRecorder();
    const content = plainTextToTiptapDoc("Template notes\nSecond paragraph");
    const contentText = extractPlainText(content);

    const result = await createTaskLikeRoot({
      supabase: supabase as never,
      context: "test.createTask",
      title: "Template clone",
      status: "to_do",
      priority: "high",
      createdByUserId: "00000000-0000-0000-0000-000000000001",
      assigneeUserIds: [
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000003",
      ],
      content,
      contentText,
    });

    expect(result.taskId).toBeTruthy();
    expect(inserts.tasks).toHaveLength(1);
    expect(inserts.tasks[0]).toMatchObject({
      title: "Template clone",
      priority: "high",
      content,
      content_text: contentText,
      assignee_user_id: "00000000-0000-0000-0000-000000000002",
    });
    expect(inserts.task_assignees).toEqual([
      {
        task_id: result.taskId,
        user_id: "00000000-0000-0000-0000-000000000002",
      },
      {
        task_id: result.taskId,
        user_id: "00000000-0000-0000-0000-000000000003",
      },
    ]);
  });

  it("normalizes recurrence fields, dates, status aliases, and assignees", async () => {
    const { supabase, inserts } = createInsertRecorder();

    const result = await createTaskLikeRoot({
      supabase: supabase as never,
      context: "test.normalized",
      title: "  Recurring follow up  ",
      status: "backlog",
      priority: "  ",
      clientId: "client-1",
      projectId: "project-1",
      parentTaskId: "parent-1",
      dueDate: " 2026-06-10 ",
      dueTime: " 09:30 ",
      startDate: " 2026-06-03 ",
      createdByUserId: "creator-1",
      assigneeUserId: "fallback-1",
      assigneeUserIds: ["assignee-2", "unassigned", " assignee-2 ", ""],
      defaultAssigneeUserId: "default-1",
      recurrenceValues: {
        recurrence_frequency: "weekly",
        recurrence_interval: 2,
        recurrence_weekdays: [1, 3],
        recurrence_start_date: "2026-06-03",
        recurrence_end_date: "2026-12-31",
      },
    });

    expect(result.primaryAssignee).toBe("assignee-2");
    expect(result.effectiveAssigneeIds).toEqual(["assignee-2"]);
    expect(inserts.tasks[0]).toMatchObject({
      client_id: "client-1",
      project_id: "project-1",
      parent_task_id: "parent-1",
      title: "Recurring follow up",
      status: "to_do",
      priority: "medium",
      due_date: "2026-06-10",
      due_time: "09:30",
      start_date: "2026-06-03",
      assignee_user_id: "assignee-2",
      created_by_user_id: "creator-1",
      recurrence_frequency: "weekly",
      recurrence_interval: 2,
      recurrence_weekdays: [1, 3],
      recurrence_start_date: "2026-06-03",
      recurrence_end_date: "2026-12-31",
    });
    expect(inserts.task_assignees).toEqual([
      { task_id: result.taskId, user_id: "assignee-2" },
    ]);
  });

  it("uses default content and skips assignee rows when no assignee is available", async () => {
    const { supabase, inserts } = createInsertRecorder();

    const result = await createTaskLikeRoot({
      supabase: supabase as never,
      context: "test.unassigned",
      title: "Unassigned task",
      createdByUserId: "creator-1",
      assigneeUserId: " ",
      assigneeUserIds: ["unassigned", ""],
      defaultAssigneeUserId: " ",
    });

    expect(result.primaryAssignee).toBeNull();
    expect(result.effectiveAssigneeIds).toEqual([]);
    expect(inserts.tasks[0]).toMatchObject({
      title: "Unassigned task",
      assignee_user_id: null,
      content: DEFAULT_EDITOR_CONTENT,
      content_text: "",
    });
    expect(inserts.task_assignees).toBeUndefined();
  });

  it("throws task insert database errors with context", async () => {
    const { supabase, inserts } = createInsertRecorder({
      tasks: { message: "insert failed", code: "23505", details: "duplicate" },
    });

    await expect(
      createTaskLikeRoot({
        supabase: supabase as never,
        context: "test.db",
        title: "Task insert failure",
        createdByUserId: "creator-1",
      })
    ).rejects.toMatchObject({
      name: "TaskCreateDbError",
      context: "test.db.tasks.insert",
      dbError: { message: "insert failed", code: "23505" },
    } satisfies Partial<TaskCreateDbError>);

    expect(inserts.tasks).toHaveLength(1);
    expect(inserts.task_assignees).toBeUndefined();
  });

  it("throws assignee insert database errors after creating the task row", async () => {
    const { supabase, inserts } = createInsertRecorder({
      task_assignees: { message: "assignee insert failed", code: "42501" },
    });

    await expect(
      createTaskLikeRoot({
        supabase: supabase as never,
        context: "test.assigneeDb",
        title: "Assignee failure",
        createdByUserId: "creator-1",
        assigneeUserIds: ["assignee-1"],
      })
    ).rejects.toMatchObject({
      name: "TaskCreateDbError",
      context: "test.assigneeDb.task_assignees.insert",
      dbError: { message: "assignee insert failed", code: "42501" },
    } satisfies Partial<TaskCreateDbError>);

    expect(inserts.tasks).toHaveLength(1);
    expect(inserts.task_assignees).toEqual([
      {
        task_id: (inserts.tasks[0] as { id: string }).id,
        user_id: "assignee-1",
      },
    ]);
  });
});
