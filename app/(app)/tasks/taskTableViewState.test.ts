import { describe, expect, it } from "vitest";
import {
  filterAllowedValues,
  normalizeStorageList,
  normalizeVisibleTaskColumns,
  type TaskTableColumnId,
} from "./taskTableViewState";

describe("task table view state helpers", () => {
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
});
