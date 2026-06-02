import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/currentUser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/currentUser")>(
    "@/lib/supabase/currentUser"
  );
  return {
    ...actual,
    getCurrentRequestUser: vi.fn(),
  };
});

import { revalidatePath } from "next/cache";
import { plainTextToTiptapDoc } from "@/lib/plainTextToTiptapDoc";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { quickCreateTaskAction } from "./actions";

const mockedCreateSupabaseServerClient = vi.mocked(createSupabaseServerClient);
const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedGetCurrentRequestUser = vi.mocked(getCurrentRequestUser);

type AuthUser = {
  id: string;
  email?: string | null;
};

type ProfileRow = {
  id: string | null;
  status?: string | null;
};

function createQuickTaskForm({
  title,
  notes,
  subtasks = [],
}: {
  title?: string;
  notes?: string;
  subtasks?: string[];
}) {
  const formData = new FormData();
  if (typeof title !== "undefined") formData.set("title", title);
  if (typeof notes !== "undefined") formData.set("notes", notes);
  subtasks.forEach((subtask) => formData.append("subtask_titles", subtask));
  return formData;
}

function createSupabaseMock({
  authUser,
  profile,
  profileError = null,
  insertErrors = [],
}: {
  authUser: AuthUser | null;
  profile?: ProfileRow | null;
  profileError?: { message: string } | null;
  insertErrors?: Array<{ message: string; code?: string } | null>;
}) {
  const insertCalls: Record<string, unknown[]> = {};
  const pendingInsertErrors = [...insertErrors];
  const profileResult = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: profile ?? null,
      error: profileError,
    }),
  };

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
    },
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => profileResult),
          })),
        };
      }

      return {
        insert: vi.fn((payload: unknown) => {
          if (!insertCalls[table]) insertCalls[table] = [];
          insertCalls[table].push(payload);
          return Promise.resolve({ error: pendingInsertErrors.shift() ?? null });
        }),
      };
    }),
  };

  mockedCreateSupabaseServerClient.mockReturnValue(
    supabase as unknown as ReturnType<typeof createSupabaseServerClient>
  );
  mockedGetCurrentRequestUser.mockResolvedValue(
    authUser
      ? {
          id: authUser.id,
          email: authUser.email ?? null,
          user_metadata: null,
        }
      : null
  );

  return { insertCalls, profileResult, supabase };
}

describe("quickCreateTaskAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated quick task creation before profile or insert work", async () => {
    const { supabase } = createSupabaseMock({ authUser: null });

    const result = await quickCreateTaskAction(
      createQuickTaskForm({ title: "Call customer" })
    );

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects disabled user profiles before inserting a task", async () => {
    const { insertCalls } = createSupabaseMock({
      authUser: { id: "auth-user-1", email: "disabled@example.com" },
      profile: { id: "app-user-1", status: "disabled" },
    });

    const result = await quickCreateTaskAction(
      createQuickTaskForm({ title: "Call customer" })
    );

    expect(result).toEqual({
      ok: false,
      error: "Your user profile is disabled",
    });
    expect(insertCalls.tasks).toBeUndefined();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("validates title, note, and subtask title limits before inserting", async () => {
    createSupabaseMock({
      authUser: { id: "auth-user-1", email: "user@example.com" },
      profile: { id: "app-user-1", status: "active" },
    });

    await expect(quickCreateTaskAction(createQuickTaskForm({}))).resolves.toEqual({
      ok: false,
      error: "Title is required",
    });
    await expect(
      quickCreateTaskAction(createQuickTaskForm({ title: "x".repeat(181) }))
    ).resolves.toEqual({
      ok: false,
      error: "Title must be 180 characters or fewer",
    });
    await expect(
      quickCreateTaskAction(
        createQuickTaskForm({ title: "Task", notes: "x".repeat(12001) })
      )
    ).resolves.toEqual({
      ok: false,
      error: "Task notes are too long",
    });
    await expect(
      quickCreateTaskAction(
        createQuickTaskForm({ title: "Task", subtasks: ["x".repeat(181)] })
      )
    ).resolves.toEqual({
      ok: false,
      error: "Subtask titles must be 180 characters or fewer",
    });
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("creates a quick task with notes and subtasks without route-modal data", async () => {
    const { insertCalls } = createSupabaseMock({
      authUser: { id: "auth-user-1", email: "user@example.com" },
      profile: { id: "app-user-1", status: "active" },
    });

    const result = await quickCreateTaskAction(
      createQuickTaskForm({
        title: "  Follow up with ACME  ",
        notes: "Call notes\nSecond line",
        subtasks: [" First step ", "", "Second step"],
      })
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.task).toMatchObject({
      title: "Follow up with ACME",
      status: "to_do",
      priority: "medium",
      assignee_user_id: "app-user-1",
      client_id: null,
      project_id: null,
    });
    expect(result.assigneeUserIds).toEqual(["app-user-1"]);
    expect(result.openSubtaskCount).toBe(2);
    expect(result.subtasks.map((subtask) => subtask.title)).toEqual([
      "First step",
      "Second step",
    ]);

    expect(insertCalls.tasks).toHaveLength(2);
    expect(insertCalls.tasks[0]).toMatchObject({
      title: "Follow up with ACME",
      status: "to_do",
      priority: "medium",
      assignee_user_id: "app-user-1",
      created_by_user_id: "auth-user-1",
      content_text: "Call notes\nSecond line",
      content: plainTextToTiptapDoc("Call notes\nSecond line"),
    });

    const rootTask = insertCalls.tasks[0] as { id: string };
    const subtaskPayload = insertCalls.tasks[1] as Array<{
      id: string;
      parent_task_id: string;
      title: string;
      assignee_user_id: string | null;
      created_by_user_id: string;
    }>;
    expect(subtaskPayload).toHaveLength(2);
    expect(subtaskPayload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parent_task_id: rootTask.id,
          title: "First step",
          assignee_user_id: "app-user-1",
          created_by_user_id: "auth-user-1",
        }),
        expect.objectContaining({
          parent_task_id: rootTask.id,
          title: "Second step",
          assignee_user_id: "app-user-1",
          created_by_user_id: "auth-user-1",
        }),
      ])
    );
    expect(insertCalls.task_assignees).toHaveLength(2);
    expect(insertCalls.task_assignees[0]).toEqual([
      { task_id: rootTask.id, user_id: "app-user-1" },
    ]);
    expect(insertCalls.task_assignees[1]).toEqual(
      subtaskPayload.map((subtask) => ({
        task_id: subtask.id,
        user_id: "app-user-1",
      }))
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/tasks");
  });
});
