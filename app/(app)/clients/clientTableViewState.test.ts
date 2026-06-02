import { describe, expect, it } from "vitest";
import {
  buildClientFilterPersistenceKey,
  buildClientListQuery,
  buildClientListUrl,
  filterAllowedValues,
  normalizeClientSortDir,
  normalizeClientSortKey,
  normalizeStorageList,
  normalizeVisibleClientColumns,
  type ClientFilterState,
  type ClientTableColumnId,
} from "./clientTableViewState";

describe("client table view state helpers", () => {
  const emptyFilters: ClientFilterState = {
    q: "",
    status: [],
    industry: [],
  };

  it("normalizes persisted string lists by trimming, deduping, and dropping blanks", () => {
    expect(normalizeStorageList([" active ", "", null, "paused", "active"])).toEqual([
      "active",
      "paused",
    ]);
    expect(normalizeStorageList("active")).toEqual([]);
  });

  it("filters stored values against allowed values", () => {
    expect(
      filterAllowedValues(["health", "unknown", "finance"], new Set(["health", "finance"]))
    ).toEqual(["health", "finance"]);
  });

  it("keeps required client columns and removes unknown persisted columns", () => {
    const knownColumnIds: ClientTableColumnId[] = [
      "name",
      "status",
      "industry",
      "delete",
    ];

    expect(
      normalizeVisibleClientColumns(["status", "unknown", "status"], knownColumnIds)
    ).toEqual(["name", "status"]);
  });

  it("falls back to all known columns when required columns are unavailable", () => {
    const knownColumnIds: ClientTableColumnId[] = ["status", "industry"];

    expect(normalizeVisibleClientColumns(["unknown"], knownColumnIds)).toEqual(
      knownColumnIds
    );
  });

  it("normalizes client sort keys and directions with fallbacks", () => {
    expect(normalizeClientSortKey(" INDUSTRY ", "name")).toBe("industry");
    expect(normalizeClientSortKey("bad", "start")).toBe("start");
    expect(normalizeClientSortDir(" DESC ", "asc")).toBe("desc");
    expect(normalizeClientSortDir("bad", "asc")).toBe("asc");
  });

  it("builds default client list query with explicit sort markers", () => {
    expect(
      buildClientListQuery({
        filters: emptyFilters,
        sortKey: "name",
        sortDir: "asc",
        view: "table",
      })
    ).toBe("sort=name&dir=asc");
  });

  it("builds full client list query from search, filters, sort, and view", () => {
    expect(
      buildClientListQuery({
        filters: {
          q: " acme ",
          status: ["active", "paused"],
          industry: ["health", "finance"],
        },
        sortKey: "start",
        sortDir: "desc",
        view: "gantt",
      })
    ).toBe(
      "q=acme&status=active%2Cpaused&industry=health%2Cfinance&sort=start&dir=desc&view=gantt"
    );
  });

  it("builds client list URLs without a dangling question mark", () => {
    expect(
      buildClientListUrl("/clients", {
        filters: emptyFilters,
        sortKey: "status",
        sortDir: "asc",
        view: "board",
      })
    ).toBe("/clients?sort=status&dir=asc&view=board");
  });

  it("normalizes client filter persistence keys", () => {
    expect(
      buildClientFilterPersistenceKey({
        userId: " user-1 ",
        scope: " /Clients ",
      })
    ).toBe("resolvable.client-filters.v1:user-1:/clients");
    expect(buildClientFilterPersistenceKey({ userId: "", scope: "/clients" })).toBeNull();
  });
});
