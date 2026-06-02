import { describe, expect, it } from "vitest";
import {
  buildProjectFilterPersistenceKey,
  buildProjectListQuery,
  buildProjectListUrl,
  filterAllowedValues,
  normalizeProjectSortDir,
  normalizeProjectSortKey,
  normalizeStorageList,
  normalizeVisibleProjectColumns,
  type ProjectFilterState,
  type ProjectTableColumnId,
} from "./projectTableViewState";

describe("project table view state helpers", () => {
  const emptyFilters: ProjectFilterState = {
    client: [],
    status: [],
    assignee: [],
  };

  it("normalizes persisted string lists by trimming, deduping, and dropping blanks", () => {
    expect(normalizeStorageList([" client-1 ", "", null, "client-2", "client-1"])).toEqual([
      "client-1",
      "client-2",
    ]);
    expect(normalizeStorageList("client-1")).toEqual([]);
  });

  it("filters stored values against allowed values", () => {
    expect(
      filterAllowedValues(["active", "stale", "paused"], new Set(["active", "paused"]))
    ).toEqual(["active", "paused"]);
  });

  it("keeps required project columns and removes unknown persisted columns", () => {
    const knownColumnIds: ProjectTableColumnId[] = [
      "project",
      "client",
      "status",
      "end",
    ];

    expect(
      normalizeVisibleProjectColumns(["status", "unknown", "status"], knownColumnIds)
    ).toEqual(["project", "status"]);
  });

  it("falls back to all known columns when required columns are unavailable", () => {
    const knownColumnIds: ProjectTableColumnId[] = ["client", "status"];

    expect(normalizeVisibleProjectColumns(["unknown"], knownColumnIds)).toEqual(
      knownColumnIds
    );
  });

  it("normalizes project sort keys and directions with fallbacks", () => {
    expect(normalizeProjectSortKey(" OPEN_TASKS ", "name")).toBe("open_tasks");
    expect(normalizeProjectSortKey("bad", "created")).toBe("created");
    expect(normalizeProjectSortDir(" DESC ", "asc")).toBe("desc");
    expect(normalizeProjectSortDir("bad", "asc")).toBe("asc");
  });

  it("builds default project list query with explicit hide and sort markers", () => {
    expect(
      buildProjectListQuery({
        filters: emptyFilters,
        sortKey: "name",
        sortDir: "asc",
        view: "table",
        hideCompleted: true,
        includeWatching: false,
      })
    ).toBe("hide=1&sort=name&dir=asc");
  });

  it("builds full project list query from filters, sort, view, and watch state", () => {
    expect(
      buildProjectListQuery({
        filters: {
          client: ["client-1", "client-2"],
          status: ["active", "paused"],
          assignee: ["user-1", "unassigned"],
        },
        sortKey: "open_tasks",
        sortDir: "desc",
        view: "board",
        hideCompleted: false,
        includeWatching: true,
      })
    ).toBe(
      "client=client-1%2Cclient-2&status=active%2Cpaused&assignee=user-1%2Cunassigned&hide=0&watch=1&sort=open_tasks&dir=desc&view=board"
    );
  });

  it("builds project list URLs without a dangling question mark", () => {
    expect(
      buildProjectListUrl("/projects", {
        filters: emptyFilters,
        sortKey: "created",
        sortDir: "desc",
        view: "gantt",
        hideCompleted: true,
        includeWatching: false,
      })
    ).toBe("/projects?hide=1&sort=created&dir=desc&view=gantt");
  });

  it("normalizes project filter persistence keys", () => {
    expect(
      buildProjectFilterPersistenceKey({
        userId: " user-1 ",
        scope: " /Projects ",
      })
    ).toBe("resolvable.project-filters.v1:user-1:/projects");
    expect(
      buildProjectFilterPersistenceKey({ userId: "", scope: "/projects" })
    ).toBeNull();
  });
});
