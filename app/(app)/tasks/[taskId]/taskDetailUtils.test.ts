import { describe, expect, it } from "vitest";
import {
  buildSubtasksReturnParams,
  buildSubtasksReturnUrl,
  buildSubtasksToggleUrl,
  buildTaskUrl,
  formatDbError,
  getRelationName,
  getUserDisplayName,
  normalizeTaskDueFilter,
  normalizeTaskSubtaskView,
} from "./taskDetailUtils";

describe("task detail utilities", () => {
  it("builds task tab URLs with transient messages", () => {
    expect(buildTaskUrl("task-1", "details")).toBe("/tasks/task-1");
    expect(
      buildTaskUrl("task-1", "subtasks", {
        error: "Missing title",
        created: "sub-1",
      })
    ).toBe("/tasks/task-1?tab=subtasks&error=Missing+title&created=sub-1");
    expect(
      buildTaskUrl("task-1", "details", {
        addField: "1",
        success: "Saved",
      })
    ).toBe("/tasks/task-1?success=Saved&add_field=1");
  });

  it("formats database errors with optional diagnostics", () => {
    expect(formatDbError("tasks.detail", null)).toBe("tasks.detail");
    expect(
      formatDbError("tasks.detail", {
        message: "Failed",
        code: "23505",
        details: "duplicate",
        hint: "pick another value",
      })
    ).toBe(
      "[tasks.detail] | Failed | code=23505 | details=duplicate | hint=pick another value"
    );
  });

  it("normalizes subtask view and due filters", () => {
    const allowedDueValues = new Set(["all", "overdue", "next_7", "none"]);
    expect(normalizeTaskSubtaskView("board")).toBe("board");
    expect(normalizeTaskSubtaskView(" GANTT ")).toBe("gantt");
    expect(normalizeTaskSubtaskView("calendar")).toBe("table");
    expect(normalizeTaskDueFilter("next_7", allowedDueValues)).toBe("next_7");
    expect(normalizeTaskDueFilter("bad", allowedDueValues)).toBe("all");
  });

  it("resolves relation and user display labels", () => {
    expect(getRelationName({ name: "Client A" }, "Unknown client")).toBe("Client A");
    expect(getRelationName([{ name: "Project A" }], "Unknown project")).toBe("Project A");
    expect(getRelationName([], "Unknown project")).toBe("Unknown project");

    const assigneeMap = new Map([
      ["u1", "Ada"],
      ["u2", null],
    ]);
    expect(getUserDisplayName(null, assigneeMap)).toBe("System");
    expect(getUserDisplayName("u1", assigneeMap)).toBe("Ada");
    expect(getUserDisplayName("u2", assigneeMap)).toBe("Unknown user");
    expect(getUserDisplayName("missing", assigneeMap)).toBe("Unknown user");
  });

  it("builds subtask return and toggle URLs", () => {
    const params = buildSubtasksReturnParams({
      selectedStatuses: ["to_do", "in_progress"],
      selectedPriorities: ["high"],
      selectedAssignees: ["u1"],
      selectedDue: "overdue",
      selectedClientIds: ["c1"],
      selectedProjectIds: ["p1"],
      hideCompleted: true,
      sortKey: "due",
      sortDir: "asc",
      selectedSubtaskView: "board",
    });

    expect(buildSubtasksReturnUrl("task-1", params)).toBe(
      "/tasks/task-1?tab=subtasks&status=to_do%2Cin_progress&priority=high&assignee=u1&due=overdue&client=c1&project=p1&hide=1&sort=due&dir=asc&view=board"
    );
    expect(buildSubtasksToggleUrl("task-1", params, true)).toContain("hide=0");

    const tableParams = buildSubtasksReturnParams({
      selectedStatuses: [],
      selectedPriorities: [],
      selectedAssignees: [],
      selectedDue: "all",
      selectedClientIds: [],
      selectedProjectIds: [],
      hideCompleted: false,
      sortKey: "created",
      sortDir: "desc",
      selectedSubtaskView: "table",
    });
    expect(buildSubtasksReturnUrl("task-1", tableParams)).toBe(
      "/tasks/task-1?tab=subtasks&hide=0&sort=created&dir=desc"
    );
  });
});
