import { describe, expect, it } from "vitest";
import {
  normalizeTaskSortDir,
  normalizeTaskSortKey,
  sortTasksForDisplay,
} from "./taskSorting";

describe("taskSorting", () => {
  it("normalizes supported and unsupported sort inputs", () => {
    expect(normalizeTaskSortKey("queue")).toBe("queue");
    expect(normalizeTaskSortKey(" Due ")).toBe("due");
    expect(normalizeTaskSortKey("unknown")).toBe("created");
    expect(normalizeTaskSortDir(" asc ")).toBe("asc");
    expect(normalizeTaskSortDir("DESC")).toBe("desc");
    expect(normalizeTaskSortDir("sideways")).toBe("desc");
  });

  it("puts overdue critical work first in my queue sorting", () => {
    const tasks = [
      {
        id: "later-low",
        title: "Later low",
        priority: "low",
        due_date: "2026-06-20",
        created_at: "2026-06-01T10:00:00Z",
      },
      {
        id: "overdue-critical",
        title: "Overdue critical",
        priority: "critical",
        due_date: "2026-05-30",
        created_at: "2026-06-01T11:00:00Z",
      },
      {
        id: "due-soon-high",
        title: "Due soon high",
        priority: "high",
        due_date: "2026-06-02",
        created_at: "2026-06-01T12:00:00Z",
      },
    ];

    const sorted = sortTasksForDisplay({
      tasks,
      sortKey: "queue",
      sortDir: "desc",
      today: "2026-06-01",
    });

    expect(sorted.map((task) => task.id)).toEqual([
      "overdue-critical",
      "due-soon-high",
      "later-low",
    ]);
  });

  it("sorts by relation names without mutating the original task list", () => {
    const tasks = [
      { id: "b", title: "Task B", clients: [{ name: "Zulu Client" }] },
      { id: "a", title: "Task A", clients: { name: "alpha client" } },
      { id: "c", title: "Task C", clients: null },
    ];

    const sorted = sortTasksForDisplay({
      tasks,
      sortKey: "client",
      sortDir: "asc",
    });

    expect(sorted.map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(tasks.map((task) => task.id)).toEqual(["b", "a", "c"]);
    expect(sorted).not.toBe(tasks);
  });

  it("sorts status and priority using product-specific ranks", () => {
    const tasks = [
      { id: "unknown", status: "waiting", priority: "none" },
      { id: "done", status: "done", priority: "low" },
      { id: "todo", status: "to_do", priority: "critical" },
      { id: "doing", status: "in_progress", priority: "medium" },
    ];

    expect(
      sortTasksForDisplay({
        tasks,
        sortKey: "status",
        sortDir: "asc",
        statusOrder: ["to_do", "in_progress", "done"],
      }).map((task) => task.id)
    ).toEqual(["todo", "doing", "done", "unknown"]);

    expect(
      sortTasksForDisplay({
        tasks,
        sortKey: "priority",
        sortDir: "desc",
      }).map((task) => task.id)
    ).toEqual(["todo", "doing", "done", "unknown"]);
  });

  it("sorts by primary assignee display labels", () => {
    const tasks = [
      {
        id: "fallback-email",
        assignee_user_id: "user-3",
      },
      {
        id: "multi-assignee",
        assignee_user_id: "user-1",
      },
      {
        id: "unassigned",
      },
    ];

    const sorted = sortTasksForDisplay({
      tasks,
      sortKey: "assignees",
      sortDir: "asc",
      assigneesByTask: {
        "multi-assignee": ["user-2", "user-1"],
      },
      users: [
        { id: "user-1", full_name: "Zara Owner", email: "zara@example.com" },
        { id: "user-2", full_name: "Amy Assignee", email: "amy@example.com" },
        { id: "user-3", full_name: null, email: "ben@example.com" },
      ],
    });

    expect(sorted.map((task) => task.id)).toEqual([
      "multi-assignee",
      "fallback-email",
      "unassigned",
    ]);
  });

  it("keeps missing dates last and applies deterministic id tiebreakers", () => {
    const tasks = [
      { id: "same-b", due_date: "2026-06-02" },
      { id: "missing" },
      { id: "same-a", due_date: "2026-06-02" },
      { id: "earlier", due_date: "2026-06-01" },
    ];

    expect(
      sortTasksForDisplay({
        tasks,
        sortKey: "due",
        sortDir: "asc",
      }).map((task) => task.id)
    ).toEqual(["earlier", "same-a", "same-b", "missing"]);

    expect(
      sortTasksForDisplay({
        tasks,
        sortKey: "due",
        sortDir: "desc",
      }).map((task) => task.id)
    ).toEqual(["same-a", "same-b", "earlier", "missing"]);
  });
});
