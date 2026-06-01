import { describe, expect, it } from "vitest";
import { resolveTaskTableState, type TaskTablePreferenceRow } from "./taskTablePreferences";

const savedPreferences: TaskTablePreferenceRow = {
  status: ["in_progress"],
  priority: ["critical"],
  assignee: ["user-1"],
  due: "overdue",
  client: ["client-1"],
  project: ["project-1"],
  hide_completed: false,
  include_watching: true,
  sort_key: "due",
  sort_dir: "asc",
  view_mode: "board",
};

describe("resolveTaskTableState", () => {
  it("lets URL preference params override saved preferences", () => {
    const state = resolveTaskTableState({
      preferences: savedPreferences,
      searchParams: {
        status: "to_do,done",
        priority: "low",
        assignee: "user-2",
        due: "next_7",
        sort: "priority",
        dir: "desc",
        view: "table",
        q: " renewal notes ",
        page: "3",
      },
    });

    expect(state.shouldUseSavedPreferences).toBe(false);
    expect(state.selectedStatusesRaw).toEqual(["to_do", "done"]);
    expect(state.selectedPrioritiesRaw).toEqual(["low"]);
    expect(state.selectedAssigneesRaw).toEqual(["user-2"]);
    expect(state.selectedDue).toBe("next_7");
    expect(state.sortKey).toBe("priority");
    expect(state.sortDir).toBe("desc");
    expect(state.selectedView).toBe("table");
    expect(state.searchQuery).toBe("renewal notes");
    expect(state.currentPage).toBe(3);
  });

  it("preserves a saved all-assignees preference", () => {
    const state = resolveTaskTableState({
      preferences: {
        ...savedPreferences,
        assignee: [],
      },
      searchParams: {},
    });

    expect(state.shouldUseSavedPreferences).toBe(true);
    expect(state.selectedAssigneesRaw).toEqual([]);
  });

  it("leaves defaults available when no saved preferences exist", () => {
    const state = resolveTaskTableState({
      preferences: null,
      searchParams: {},
    });

    expect(state.shouldUseSavedPreferences).toBe(false);
    expect(state.selectedAssigneesRaw).toEqual([]);
    expect(state.hideCompleted).toBe(true);
    expect(state.includeWatching).toBe(false);
    expect(state.sortKey).toBe("created");
    expect(state.sortDir).toBe("desc");
  });
});
