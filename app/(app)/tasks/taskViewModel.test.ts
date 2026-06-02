import { describe, expect, it } from "vitest";
import {
  buildEffectiveTaskList,
  buildEffectiveTaskStatusMap,
  buildHiddenTaskStatusSet,
  buildLocallyVisibleQuickTasks,
  buildNextSubtaskDueDateMap,
  filterTasksByHiddenStatus,
  filterSubtasksByHiddenStatus,
  groupTasksByStatus,
  mergeServerTaskRecordMap,
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

  it("filters subtasks by hidden status while respecting effective status changes", () => {
    const hiddenStatusSet = buildHiddenTaskStatusSet(["completed", "cancelled"]);
    const subtasks = [
      { id: "subtask-1", title: "Open subtask", status: "to_do" },
      { id: "subtask-2", title: "Done subtask", status: "completed" },
      { id: "subtask-3", title: "Locally completed", status: "to_do" },
      { id: "subtask-4", title: "Cancelled subtask", status: "Cancelled" },
    ];

    expect(
      filterSubtasksByHiddenStatus({
        subtasks,
        hiddenStatusSet,
        effectiveStatusByTaskId: new Map([["subtask-3", "completed"]]),
        shouldHideHiddenStatuses: true,
      }).map((subtask) => subtask.id)
    ).toEqual(["subtask-1"]);
  });

  it("returns the original subtask array when hidden-status filtering is off", () => {
    const hiddenStatusSet = buildHiddenTaskStatusSet(["completed"]);
    const subtasks = [{ id: "subtask-1", title: "Done subtask", status: "completed" }];

    expect(
      filterSubtasksByHiddenStatus({
        subtasks,
        hiddenStatusSet,
        effectiveStatusByTaskId: new Map(),
        shouldHideHiddenStatuses: false,
      })
    ).toBe(subtasks);
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

  it("keeps locally-created quick tasks visible until the server returns them", () => {
    const quickCreatedTasks = [
      { id: "task-4", title: "Quick task", status: "to_do" },
      { id: "task-2", title: "Already returned", status: "completed" },
    ];

    expect(
      buildLocallyVisibleQuickTasks({
        quickCreatedTasks,
        serverTasks: tasks,
      }).map((task) => task.id)
    ).toEqual(["task-4"]);

    expect(
      buildEffectiveTaskList({
        quickCreatedTasks,
        serverTasks: tasks,
      }).map((task) => task.id)
    ).toEqual(["task-4", "task-1", "task-2", "task-3"]);
  });

  it("returns the original server task array when no local quick tasks are visible", () => {
    const effectiveTasks = buildEffectiveTaskList({
      quickCreatedTasks: [{ id: "task-1", title: "Already returned", status: "to_do" }],
      serverTasks: tasks,
    });

    expect(effectiveTasks).toBe(tasks);
  });

  it("merges quick-created maps while letting server values win", () => {
    expect(
      mergeServerTaskRecordMap({
        quickCreatedValues: { "task-1": ["local-user"], "task-4": ["new-user"] },
        serverValues: { "task-1": ["server-user"], "task-2": [] },
      })
    ).toEqual({
      "task-1": ["server-user"],
      "task-2": [],
      "task-4": ["new-user"],
    });
  });

  it("builds next-subtask due dates from loaded subtasks only when enabled", () => {
    const effectiveStatusByTaskId = new Map<string, string>([
      ["subtask-2", "completed"],
    ]);
    const nextDueDateMap = buildNextSubtaskDueDateMap({
      enabled: true,
      initialNextSubtaskDueDateByTaskId: { "task-1": "2026-06-10", "task-2": "2026-06-09" },
      visibleTasks: tasks,
      loadedSubtasksByParentId: {
        "task-1": [
          { id: "subtask-1", status: "to_do", due_date: "2026-06-08" },
          { id: "subtask-2", status: "to_do", due_date: "2026-06-01" },
          { id: "subtask-3", status: "cancelled", due_date: "2026-06-02" },
        ],
      },
      effectiveStatusByTaskId,
    });

    expect(nextDueDateMap).toEqual({
      "task-1": "2026-06-08",
      "task-2": "2026-06-09",
    });
    expect(
      buildNextSubtaskDueDateMap({
        enabled: false,
        initialNextSubtaskDueDateByTaskId: { "task-1": "2026-06-10" },
        visibleTasks: tasks,
        loadedSubtasksByParentId: {},
        effectiveStatusByTaskId,
      })
    ).toEqual({});
  });
});
