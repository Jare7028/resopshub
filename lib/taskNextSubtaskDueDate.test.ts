import { describe, expect, it } from "vitest";
import { getNextSubtaskDueDate } from "./taskNextSubtaskDueDate";

describe("getNextSubtaskDueDate", () => {
  it("returns null when no subtasks exist", () => {
    expect(getNextSubtaskDueDate({ subtasks: [] })).toBeNull();
  });

  it("returns null when all open subtasks have no due date", () => {
    const result = getNextSubtaskDueDate({
      subtasks: [
        { id: "a", status: "to_do", due_date: null },
        { id: "b", status: "in_progress", due_date: "" },
      ],
    });
    expect(result).toBeNull();
  });

  it("returns earliest due date among open subtasks", () => {
    const result = getNextSubtaskDueDate({
      subtasks: [
        { id: "a", status: "to_do", due_date: "2026-04-10" },
        { id: "b", status: "in_progress", due_date: "2026-03-05" },
        { id: "c", status: "blocked", due_date: "2026-03-12" },
      ],
    });
    expect(result).toBe("2026-03-05");
  });

  it("ignores completed and cancelled subtasks", () => {
    const result = getNextSubtaskDueDate({
      subtasks: [
        { id: "a", status: "completed", due_date: "2026-01-01" },
        { id: "b", status: "cancelled", due_date: "2026-01-02" },
        { id: "c", status: "to_do", due_date: "2026-02-01" },
      ],
    });
    expect(result).toBe("2026-02-01");
  });

  it("uses optimistic effective status overrides", () => {
    const result = getNextSubtaskDueDate({
      subtasks: [
        { id: "a", status: "to_do", due_date: "2026-01-10" },
        { id: "b", status: "to_do", due_date: "2026-01-20" },
      ],
      effectiveStatusByTaskId: new Map([
        ["a", "completed"],
      ]),
    });
    expect(result).toBe("2026-01-20");
  });
});
