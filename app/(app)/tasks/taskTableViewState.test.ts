import { describe, expect, it } from "vitest";
import {
  buildPersistedTaskFilterState,
  buildTaskFilterPersistenceKey,
  buildTaskListQuery,
  buildTaskListUrl,
  buildTaskListUrlFromQuery,
  buildTaskPreferenceFormData,
  filterAllowedValues,
  getNextTaskSortDir,
  normalizePersistedTaskFilters,
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

  it("joins task list URLs from query strings and supports an empty-query fallback", () => {
    expect(buildTaskListUrlFromQuery({ basePath: "/tasks", query: "page=2" })).toBe(
      "/tasks?page=2"
    );
    expect(buildTaskListUrlFromQuery({ basePath: "/tasks", query: "?page=2" })).toBe(
      "/tasks?page=2"
    );
    expect(
      buildTaskListUrlFromQuery({
        basePath: "/tasks",
        query: "",
        fallbackPath: "/tasks?return=1",
      })
    ).toBe("/tasks?return=1");
  });

  it("toggles the current sort direction and resets new sort keys to ascending", () => {
    expect(
      getNextTaskSortDir({
        currentSortKey: "due",
        currentSortDir: "asc",
        nextSortKey: "due",
      })
    ).toBe("desc");

    expect(
      getNextTaskSortDir({
        currentSortKey: "due",
        currentSortDir: "desc",
        nextSortKey: "due",
      })
    ).toBe("asc");

    expect(
      getNextTaskSortDir({
        currentSortKey: "due",
        currentSortDir: "asc",
        nextSortKey: "priority",
      })
    ).toBe("asc");
  });

  it("builds persisted task filter state with copied list fields", () => {
    const filters: TaskFilterState = {
      status: ["open"],
      priority: ["high"],
      assignee: ["user-1"],
      due: "overdue",
      client: ["client-1"],
      project: ["project-1"],
    };
    const persisted = buildPersistedTaskFilterState({
      filters,
      sortKey: "due",
      sortDir: "asc",
      view: "board",
      hideCompleted: false,
      includeWatching: true,
    });

    filters.status.push("closed");
    filters.assignee.push("user-2");

    expect(persisted).toEqual({
      status: ["open"],
      priority: ["high"],
      assignee: ["user-1"],
      due: "overdue",
      client: ["client-1"],
      project: ["project-1"],
      hideCompleted: false,
      includeWatching: true,
      sortKey: "due",
      sortDir: "asc",
      view: "board",
    });
  });

  it("builds task preference form data with normalized CSV fields", () => {
    const formData = buildTaskPreferenceFormData({
      filters: {
        status: [" open ", "open", ""],
        priority: ["high", " medium "],
        assignee: ["user-1", "user-1", " user-2 "],
        due: "",
        client: ["client-1"],
        project: [" project-1 "],
      },
      sortKey: "due",
      sortDir: "asc",
      view: "board",
      hideCompleted: false,
      includeWatching: true,
    });

    expect(formData.get("status")).toBe("open");
    expect(formData.get("priority")).toBe("high,medium");
    expect(formData.get("assignee")).toBe("user-1,user-2");
    expect(formData.get("due")).toBe("all");
    expect(formData.get("hide_completed")).toBe("0");
    expect(formData.get("include_watching")).toBe("1");
    expect(formData.get("sort_key")).toBe("due");
    expect(formData.get("sort_dir")).toBe("asc");
    expect(formData.get("view_mode")).toBe("board");
  });

  it("normalizes persisted task filters against currently allowed values", () => {
    const restored = normalizePersistedTaskFilters({
      parsed: {
        status: ["open", "stale"],
        priority: ["high", "missing"],
        assignee: ["user-1", "unknown", "unassigned"],
        due: "overdue",
        client: ["client-1", "missing"],
        project: ["project-1"],
        hideCompleted: false,
        includeWatching: true,
        sortKey: "due",
        sortDir: "asc",
        view: "board",
      },
      initialFilters: emptyFilters,
      statusOptions: ["open", "closed"],
      priorityOptions: ["high"],
      users: [{ id: "user-1" }],
      dueOptions: [{ value: "all" }, { value: "overdue" }],
      clients: [{ id: "client-1" }],
      projects: [{ id: "project-1" }],
      fallbackHideCompleted: true,
      fallbackIncludeWatching: false,
      fallbackSortKey: "created",
      fallbackSortDir: "desc",
      fallbackView: "table",
    });

    expect(restored).toEqual({
      filters: {
        status: ["open"],
        priority: ["high"],
        assignee: ["user-1", "unassigned"],
        due: "overdue",
        client: ["client-1"],
        project: ["project-1"],
      },
      hideCompleted: false,
      includeWatching: true,
      sortKey: "due",
      sortDir: "asc",
      view: "board",
    });
  });

  it("falls back when persisted task filters are missing or invalid", () => {
    const restored = normalizePersistedTaskFilters({
      parsed: {
        assignee: ["unknown"],
        due: "missing",
        sortKey: "bad-key",
        sortDir: "bad-dir",
        view: "bad-view",
      },
      initialFilters: {
        ...emptyFilters,
        assignee: ["fallback-user"],
      },
      statusOptions: ["open"],
      priorityOptions: ["high"],
      users: [{ id: "user-1" }],
      dueOptions: [{ value: "all" }],
      clients: [{ id: "client-1" }],
      projects: [{ id: "project-1" }],
      fallbackHideCompleted: true,
      fallbackIncludeWatching: false,
      fallbackSortKey: "created",
      fallbackSortDir: "desc",
      fallbackView: "gantt",
    });

    expect(restored.filters.assignee).toEqual(["fallback-user"]);
    expect(restored.filters.due).toBe("all");
    expect(restored.hideCompleted).toBe(true);
    expect(restored.includeWatching).toBe(false);
    expect(restored.sortKey).toBe("created");
    expect(restored.sortDir).toBe("desc");
    expect(restored.view).toBe("gantt");
  });

  it("normalizes task filter persistence keys", () => {
    expect(buildTaskFilterPersistenceKey({ userId: " user-1 ", scope: " /Tasks " })).toBe(
      "resolvable.task-filters.v1:user-1:/tasks"
    );
    expect(buildTaskFilterPersistenceKey({ userId: "", scope: "/tasks" })).toBeNull();
  });
});
