import { describe, expect, it } from "vitest";
import {
  buildTaskFilterPersistenceKey,
  buildTaskListQuery,
  buildTaskListUrl,
  filterAllowedValues,
  normalizeStorageList,
  normalizeVisibleTaskColumns,
  type TaskFilterState,
  type TaskTableColumnId,
} from "./taskTableViewState";

describe("task table view state helpers", () => {
  const emptyFilters: TaskFilterState = {
    status: [],
    priority: [],
    assignee: [],
    due: "all",
    client: [],
    project: [],
  };

  it("normalizes persisted string lists by trimming, deduping, and dropping blanks", () => {
    expect(normalizeStorageList([" open ", "", null, "closed", "open"])).toEqual([
      "open",
      "closed",
    ]);
    expect(normalizeStorageList("open")).toEqual([]);
  });

  it("filters stored values against the currently allowed set", () => {
    expect(
      filterAllowedValues(["open", "stale", "closed"], new Set(["open", "closed"]))
    ).toEqual(["open", "closed"]);
  });

  it("keeps required task columns and removes unknown persisted columns", () => {
    const knownColumnIds: TaskTableColumnId[] = ["task", "client", "status", "due"];

    expect(
      normalizeVisibleTaskColumns(["status", "unknown", "status"], knownColumnIds)
    ).toEqual(["task", "status"]);
  });

  it("keeps the required task column when no stored columns are usable", () => {
    const knownColumnIds: TaskTableColumnId[] = ["task", "client", "status"];

    expect(normalizeVisibleTaskColumns(["unknown"], knownColumnIds)).toEqual(["task"]);
  });

  it("falls back to all known columns when no stored columns or required columns are usable", () => {
    const knownColumnIds: TaskTableColumnId[] = ["client", "status"];

    expect(normalizeVisibleTaskColumns(["unknown"], knownColumnIds)).toEqual(knownColumnIds);
  });

  it("builds default task list query with explicit all-assignees marker", () => {
    expect(
      buildTaskListQuery({
        filters: emptyFilters,
        sortKey: "created",
        sortDir: "desc",
        view: "table",
        hideCompleted: true,
        includeWatching: false,
      })
    ).toBe("assignee=all");
  });

  it("builds full task list query from filters, sort, view, search, page, and fixed params", () => {
    expect(
      buildTaskListQuery({
        filters: {
          status: ["open", "open", "blocked"],
          priority: [" high ", "medium"],
          assignee: ["user-1", "user-2"],
          due: "overdue",
          client: ["client-1"],
          project: ["project-1"],
        },
        sortKey: "due",
        sortDir: "asc",
        view: "board",
        hideCompleted: false,
        includeWatching: true,
        searchQuery: " urgent task ",
        page: 3,
        fixedParams: { clientId: " client-1 ", empty: "" },
      })
    ).toBe(
      "clientId=client-1&status=open%2Cblocked&priority=high%2Cmedium&assignee=user-1%2Cuser-2&client=client-1&project=project-1&due=overdue&hide=0&watch=1&sort=due&dir=asc&view=board&q=urgent+task&page=3"
    );
  });

  it("builds task list URLs without a dangling question mark", () => {
    expect(
      buildTaskListUrl("/tasks", {
        filters: emptyFilters,
        sortKey: "created",
        sortDir: "desc",
        view: "table",
        hideCompleted: true,
        includeWatching: false,
      })
    ).toBe("/tasks?assignee=all");
  });

  it("normalizes task filter persistence keys", () => {
    expect(buildTaskFilterPersistenceKey({ userId: " user-1 ", scope: " /Tasks " })).toBe(
      "resolvable.task-filters.v1:user-1:/tasks"
    );
    expect(buildTaskFilterPersistenceKey({ userId: "", scope: "/tasks" })).toBeNull();
  });
});
