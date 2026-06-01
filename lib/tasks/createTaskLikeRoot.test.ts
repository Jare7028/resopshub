import { describe, expect, it } from "vitest";
import { plainTextToTiptapDoc } from "../plainTextToTiptapDoc";
import { extractPlainText } from "../tiptapText";
import { createTaskLikeRoot } from "./createTaskLikeRoot";

function createInsertRecorder() {
  const inserts: Record<string, unknown[]> = {};
  const supabase = {
    from(table: string) {
      return {
        insert(payload: unknown | unknown[]) {
          inserts[table] = Array.isArray(payload) ? payload : [payload];
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { supabase, inserts };
}

describe("createTaskLikeRoot", () => {
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
});
