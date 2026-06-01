import { describe, expect, it } from "vitest";
import {
  getLoginQuickReadTaskDueDateCutoff,
  summarizeLoginQuickReadTasks,
  type LoginQuickReadTaskRow,
} from "./loginQuickReadSummary";

describe("login quick-read task summaries", () => {
  it("builds a local due-date cutoff for the next 24 hours", () => {
    const now = new Date(2026, 5, 1, 10, 30, 0);
    expect(getLoginQuickReadTaskDueDateCutoff(now)).toBe("2026-06-02");
  });

  it("splits overdue and next-24-hour tasks while filtering closed statuses", () => {
    const now = new Date(2026, 5, 1, 12, 0, 0);
    const taskRows: LoginQuickReadTaskRow[] = [
      {
        id: "hidden",
        title: "Completed",
        status: "completed",
        due_date: "2026-05-30",
        due_time: "09:00",
      },
      {
        id: "future",
        title: "Too far out",
        status: "to_do",
        due_date: "2026-06-02",
        due_time: "13:01",
      },
      {
        id: "soon-b",
        title: "Soon later",
        status: "to_do",
        due_date: "2026-06-02",
        due_time: "11:00",
      },
      {
        id: "overdue",
        title: "Overdue task",
        status: "in_progress",
        due_date: "2026-06-01",
        due_time: "08:00",
      },
      {
        id: "soon-a",
        title: "Soon earlier",
        status: "to_do",
        due_date: "2026-06-01",
        due_time: "14:00",
      },
    ];

    const result = summarizeLoginQuickReadTasks({
      taskRows,
      hiddenTaskStatusSet: new Set(["completed"]),
      now,
    });

    expect(result.overdueItems.map((item) => item.id)).toEqual(["overdue"]);
    expect(result.dueSoonItems.map((item) => item.id)).toEqual(["soon-a", "soon-b"]);
  });

  it("uses a stable task URL and fallback title", () => {
    const result = summarizeLoginQuickReadTasks({
      taskRows: [
        {
          id: "task 1",
          title: " ",
          status: "to_do",
          due_date: "2026-06-01",
          due_time: "14:00",
        },
      ],
      hiddenTaskStatusSet: new Set(),
      now: new Date(2026, 5, 1, 12, 0, 0),
    });

    expect(result.dueSoonItems[0]).toMatchObject({
      id: "task 1",
      title: "Untitled task",
      url: "/tasks/task%201",
    });
  });
});
