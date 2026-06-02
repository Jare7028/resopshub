import { describe, expect, it, vi } from "vitest";
import { fetchLoginQuickReadTaskRows } from "./loginQuickReadTaskRows";

function createAssigneeQuery(rows: Array<{ task_id: string | null }>) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));

  return {
    query: { select },
    mocks: { select, eq, limit },
  };
}

function createTaskQuery(rows: Array<Record<string, string | null>>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = {
    select: vi.fn((...args: unknown[]) => {
      calls.push(["select", args]);
      return query;
    }),
    not: vi.fn((...args: unknown[]) => {
      calls.push(["not", args]);
      return query;
    }),
    lte: vi.fn((...args: unknown[]) => {
      calls.push(["lte", args]);
      return query;
    }),
    neq: vi.fn((...args: unknown[]) => {
      calls.push(["neq", args]);
      return query;
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.push(["order", args]);
      return query;
    }),
    limit: vi.fn((...args: unknown[]) => {
      calls.push(["limit", args]);
      return query;
    }),
    eq: vi.fn((...args: unknown[]) => {
      calls.push(["eq", args]);
      return query;
    }),
    or: vi.fn((...args: unknown[]) => {
      calls.push(["or", args]);
      return query;
    }),
    then: (
      resolve: (result: { data: Array<Record<string, string | null>>; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    calls,
  };

  return query;
}

describe("fetchLoginQuickReadTaskRows", () => {
  it("uses the SQL RPC when it is available", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "task-1",
          title: "Due task",
          status: "to_do",
          due_date: "2026-06-02",
          due_time: "09:00",
        },
      ],
      error: null,
    });
    const from = vi.fn();

    const result = await fetchLoginQuickReadTaskRows({
      supabase: { rpc, from },
      userId: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      dueDateCutoff: "2026-06-02",
    });

    expect(result.source).toBe("rpc");
    expect(result.taskRows).toEqual([
      {
        id: "task-1",
        title: "Due task",
        status: "to_do",
        due_date: "2026-06-02",
        due_time: "09:00",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("login_quick_read_tasks", {
      p_user_id: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      p_due_date_cutoff: "2026-06-02",
      p_limit: 600,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to the bounded compatibility query when the RPC is missing", async () => {
    const assignees = createAssigneeQuery([
      { task_id: "11111111-1111-4111-8111-111111111111" },
      { task_id: "11111111-1111-4111-8111-111111111111" },
      { task_id: "22222222-2222-4222-8222-222222222222" },
    ]);
    const tasks = createTaskQuery([
      {
        id: "task-2",
        title: "Fallback task",
        status: "to_do",
        due_date: "2026-06-02",
        due_time: "10:00",
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "task_assignees") return assignees.query;
      if (table === "tasks") return tasks;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fetchLoginQuickReadTaskRows({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        }),
        from,
      },
      userId: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      dueDateCutoff: "2026-06-02",
      limit: 50,
    });

    expect(result.source).toBe("compatibility");
    expect(result.taskRows.map((row) => row.id)).toEqual(["task-2"]);
    expect(assignees.mocks.select).toHaveBeenCalledWith("task_id");
    expect(assignees.mocks.eq).toHaveBeenCalledWith(
      "user_id",
      "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871"
    );
    expect(assignees.mocks.limit).toHaveBeenCalledWith(50);
    expect(tasks.or).toHaveBeenCalledWith(
      "assignee_user_id.eq.5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871,id.in.(11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222)"
    );
  });

  it("logs a real RPC error before using the compatibility path", async () => {
    const logError = vi.fn();
    const assignees = createAssigneeQuery([]);
    const tasks = createTaskQuery([]);
    const from = vi.fn((table: string) => {
      if (table === "task_assignees") return assignees.query;
      if (table === "tasks") return tasks;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fetchLoginQuickReadTaskRows({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "500", message: "RPC failed" },
        }),
        from,
      },
      userId: "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871",
      dueDateCutoff: "2026-06-02",
      logError,
    });

    expect(result).toEqual({ source: "compatibility", taskRows: [] });
    expect(logError).toHaveBeenCalledWith(
      "[quickRead.login_quick_read_tasks]",
      "RPC failed"
    );
    expect(tasks.eq).toHaveBeenCalledWith(
      "assignee_user_id",
      "5f1a2ef3-c1f2-4ee7-8a1d-6f150dcaa871"
    );
  });
});
