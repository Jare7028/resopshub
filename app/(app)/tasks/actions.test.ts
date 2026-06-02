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
import { quickCreateTaskAction, updateTaskInlineAction } from "./actions";
import { quickCreateTaskFromForm } from "./quickCreateTask";

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

const TASK_ID = "00000000-0000-4000-8000-000000000001";
const USER_A_ID = "00000000-0000-4000-8000-000000000002";
const USER_B_ID = "00000000-0000-4000-8000-000000000003";
const GROUP_ID = "00000000-0000-4000-8000-000000000004";

function createInlineTaskForm(entries: Record<string, string | string[] | undefined>) {
  const formData = new FormData();
  Object.entries(entries).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => formData.append(key, entry));
      return;
    }
    if (typeof value !== "undefined") {
      formData.set(key, value);
    }
  });
  return formData;
}

function createInlineSupabaseMock({
  rpcData = [{ id: TASK_ID, title: "Updated task" }],
  rpcError = null,
  groupMembers = [],
  groupMembersError = null,
}: {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  groupMembers?: Array<{ group_id: string; user_id: string }>;
  groupMembersError?: { message: string; code?: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError });
  const groupMembersResult = {
    in: vi.fn().mockResolvedValue({
      data: groupMembers,
      error: groupMembersError,
    }),
  };
  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "assignment_group_members") {
        return {
          select: vi.fn(() => groupMembersResult),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  mockedCreateSupabaseServerClient.mockReturnValue(
    supabase as unknown as ReturnType<typeof createSupabaseServerClient>
  );
  return { supabase, rpc, groupMembersResult };
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

  it("creates scoped quick tasks for client and project task pages", async () => {
    const { insertCalls } = createSupabaseMock({
      authUser: { id: "auth-user-1", email: "user@example.com" },
      profile: { id: "app-user-1", status: "active" },
    });

    const result = await quickCreateTaskFromForm(
      createQuickTaskForm({
        title: "Client project task",
        notes: "Scoped notes",
        subtasks: ["Scoped subtask"],
      }),
      {
        context: "clients.tasks.quickCreate",
        clientId: "client-1",
        projectId: "project-1",
        revalidatePaths: ["/clients/client-1/tasks", "/projects/project-1/tasks"],
      }
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.task).toMatchObject({
      title: "Client project task",
      client_id: "client-1",
      project_id: "project-1",
      assignee_user_id: "app-user-1",
    });
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]).toMatchObject({
      parent_task_id: result.task.id,
      title: "Scoped subtask",
      client_id: "client-1",
      project_id: "project-1",
      assignee_user_ids: ["app-user-1"],
    });

    expect(insertCalls.tasks[0]).toMatchObject({
      title: "Client project task",
      client_id: "client-1",
      project_id: "project-1",
      content: plainTextToTiptapDoc("Scoped notes"),
      content_text: "Scoped notes",
    });
    expect(insertCalls.tasks[1]).toEqual([
      expect.objectContaining({
        parent_task_id: result.task.id,
        title: "Scoped subtask",
        client_id: "client-1",
        project_id: "project-1",
      }),
    ]);
    expect(mockedGetCurrentRequestUser).toHaveBeenCalledWith(
      expect.anything(),
      "clients.tasks.quickCreate.auth"
    );
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/tasks");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1/tasks");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
  });
});

describe("updateTaskInlineAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes status aliases, de-duplicates assignees, and revalidates the safe return path", async () => {
    const { rpc } = createInlineSupabaseMock();

    const result = await updateTaskInlineAction(
      createInlineTaskForm({
        task_id: TASK_ID,
        status: "Backlog",
        priority: "high",
        start_date: "2026-06-03",
        due_date: "2026-06-04",
        due_time: "09:15",
        return_to: "/tasks?status=to_do",
        assignee_user_ids: [USER_B_ID, USER_A_ID, USER_B_ID, "unassigned"],
      })
    );

    expect(result).toEqual({
      ok: true,
      task: { id: TASK_ID, title: "Updated task" },
    });
    expect(rpc).toHaveBeenCalledWith("update_task_inline", {
      p_task_id: TASK_ID,
      p_has_status: true,
      p_status: "to_do",
      p_has_priority: true,
      p_priority: "high",
      p_has_client_id: false,
      p_client_id: null,
      p_has_project_id: false,
      p_project_id: null,
      p_has_start_date: true,
      p_start_date: "2026-06-03",
      p_has_due_date: true,
      p_due_date: "2026-06-04",
      p_has_due_time: true,
      p_due_time: "09:15",
      p_has_assignees: true,
      p_assignee_user_ids: [USER_A_ID, USER_B_ID],
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("expands assignment groups before calling the inline update RPC", async () => {
    const { rpc, groupMembersResult } = createInlineSupabaseMock({
      groupMembers: [
        { group_id: GROUP_ID, user_id: USER_B_ID },
        { group_id: GROUP_ID, user_id: USER_A_ID },
      ],
    });

    const result = await updateTaskInlineAction(
      createInlineTaskForm({
        task_id: TASK_ID,
        return_to: "/tasks",
        assignee_user_ids: [USER_A_ID, `group:${GROUP_ID}`],
      })
    );

    expect(result.ok).toBe(true);
    expect(groupMembersResult.in).toHaveBeenCalledWith("group_id", [GROUP_ID]);
    expect(rpc).toHaveBeenCalledWith(
      "update_task_inline",
      expect.objectContaining({
        p_has_assignees: true,
        p_assignee_user_ids: [USER_A_ID, USER_B_ID],
      })
    );
  });

  it("returns assignment resolution errors before mutating", async () => {
    const { rpc } = createInlineSupabaseMock({
      groupMembersError: { message: "assignment group lookup failed" },
    });

    const result = await updateTaskInlineAction(
      createInlineTaskForm({
        task_id: TASK_ID,
        assignee_user_ids: [`group:${GROUP_ID}`],
      })
    );

    expect(result).toEqual({
      ok: false,
      error: "assignment group lookup failed",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects missing task ids before calling the inline update RPC", async () => {
    const { rpc } = createInlineSupabaseMock();

    const result = await updateTaskInlineAction(createInlineTaskForm({ status: "completed" }));

    expect(result).toEqual({ ok: false, error: "Missing task id" });
    expect(rpc).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns RPC errors without revalidating", async () => {
    createInlineSupabaseMock({
      rpcError: { message: "update failed" },
    });

    const result = await updateTaskInlineAction(
      createInlineTaskForm({
        task_id: TASK_ID,
        status: "completed",
      })
    );

    expect(result).toEqual({ ok: false, error: "update failed" });
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});
