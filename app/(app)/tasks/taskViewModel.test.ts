import { describe, expect, it } from "vitest";
import {
  buildEffectiveTaskStatusMap,
  buildHiddenTaskStatusSet,
  filterTasksByHiddenStatus,
  groupTasksByStatus,
  normalizeTaskStatusKey,
  shouldHideHiddenTaskStatuses,
} from "./taskViewModel";

type TestTask = {
  id: string;
  title: string;
  status: string | null;
};

const tasks: TestTask[] = [
  { id: "task-1", title: "Open task", status: "to_do" },
  { id: "task-2", title: "Done task", status: "completed" },
  { id: "task-3", title: "Blocked task", status: "blocked" },
];

describe("task view model helpers", () => {
  it("normalizes status keys for comparison", () => {
    expect(normalizeTaskStatusKey(" In Progress ")).toBe("in_progress");
    expect(normalizeTaskStatusKey(null)).toBe("");
  });

  it("decides whether hidden statuses should be filtered", () => {
    const hiddenStatusSet = buildHiddenTaskStatusSet(["completed"]);

    expect(
      shouldHideHiddenTaskStatuses({
        hideCompleted: true,
        hiddenStatusSet,
        selectedStatusValues: [],
      })
    ).toBe(true);
    expect(
      shouldHideHiddenTaskStatuses({
        hideCompleted: true,
        hiddenStatusSet,
        selectedStatusValues: ["completed"],
      })
    ).toBe(false);
    expect(
      shouldHideHiddenTaskStatuses({
        hideCompleted: false,
        hiddenStatusSet,
        selectedStatusValues: [],
      })
    ).toBe(false);
  });

  it("filters hidden statuses while respecting optimistic status changes", () => {
    const hiddenStatusSet = buildHiddenTaskStatusSet(["completed"]);

    expect(
      filterTasksByHiddenStatus({
        tasks,
        hiddenStatusSet,
        optimisticStatusByTaskId: { "task-1": "completed" },
        shouldHideHiddenStatuses: true,
      }).map((task) => task.id)
    ).toEqual(["task-3"]);
  });

  it("returns the original task array when hidden-status filtering is off", () => {
    const hiddenStatusSet = buildHiddenTaskStatusSet(["completed"]);

    expect(
      filterTasksByHiddenStatus({
        tasks,
        hiddenStatusSet,
        optimisticStatusByTaskId: {},
        shouldHideHiddenStatuses: false,
      })
    ).toBe(tasks);
  });

  it("builds effective status maps with optimistic overrides", () => {
    const statusMap = buildEffectiveTaskStatusMap(tasks, { "task-1": "completed" });

    expect(statusMap.get("task-1")).toBe("completed");
    expect(statusMap.get("task-2")).toBe("completed");
    expect(statusMap.get("task-3")).toBe("blocked");
  });

  it("groups board tasks into configured status buckets with fallback", () => {
    const statusMap = buildEffectiveTaskStatusMap(tasks, {
      "task-3": "unexpected",
    });
    const buckets = groupTasksByStatus({
      tasks,
      statusOptions: ["to_do", "completed"],
      effectiveStatusByTaskId: statusMap,
    });

    expect(buckets.get("to_do")?.map((task) => task.id)).toEqual([
      "task-1",
      "task-3",
    ]);
    expect(buckets.get("completed")?.map((task) => task.id)).toEqual(["task-2"]);
  });
});
