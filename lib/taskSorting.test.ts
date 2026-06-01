import { describe, expect, it } from "vitest";
import { normalizeTaskSortKey, sortTasksForDisplay } from "./taskSorting";

describe("taskSorting", () => {
  it("normalizes queue sorting", () => {
    expect(normalizeTaskSortKey("queue")).toBe("queue");
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
});
