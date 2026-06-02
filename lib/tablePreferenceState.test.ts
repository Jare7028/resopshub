import { describe, expect, it } from "vitest";

import {
  getScopedTablePreferenceStorageKey,
  normalizeTablePreferenceIdList,
  readTableFiltersState,
  readTableVisibilityState,
  serializeTableFiltersState,
  serializeTableVisibilityState,
} from "./tablePreferenceState";

describe("tablePreferenceState", () => {
  it("normalizes IDs and scoped storage keys", () => {
    expect(normalizeTablePreferenceIdList([" a ", "", "a", null, "b"])).toEqual(["a", "b"]);
    expect(getScopedTablePreferenceStorageKey("filters", { userId: " user-1 " })).toBe(
      "filters:user-1"
    );
    expect(getScopedTablePreferenceStorageKey("filters")).toBe("filters:anonymous");
  });

  it("reads visibility state from scoped or legacy storage", () => {
    const fallbackState = { showClientColumn: true, visibleColumnIds: ["a", "b"] };
    const knownColumnIds = new Set(["a", "b", "c"]);
    const state = readTableVisibilityState({
      scopedRaw: JSON.stringify({
        show_client_column: false,
        visible_column_ids: ["b", "missing", "b"],
        known_column_ids: ["a", "b"],
      }),
      legacyRaw: JSON.stringify({ visible_column_ids: ["a"] }),
      knownColumnIds,
      fallbackState,
    });

    expect(state).toEqual({ showClientColumn: false, visibleColumnIds: ["b", "c"] });
  });

  it("supports inventory legacy visibility that exposes new columns without stored known IDs", () => {
    const fallbackState = { showClientColumn: true, visibleColumnIds: ["a", "b", "c"] };
    const baseArgs = {
      scopedRaw: JSON.stringify({ show_client_column: true, visible_column_ids: ["a"] }),
      knownColumnIds: new Set(["a", "b", "c"]),
      fallbackState,
    };

    expect(readTableVisibilityState(baseArgs).visibleColumnIds).toEqual(["a"]);
    expect(
      readTableVisibilityState({
        ...baseArgs,
        addNewColumnsWithoutStoredKnownIds: true,
      }).visibleColumnIds
    ).toEqual(["a", "b", "c"]);
  });

  it("serializes visibility state and can preserve newly discovered columns", () => {
    const serialized = serializeTableVisibilityState({
      state: {
        showClientColumn: false,
        visibleColumnIds: ["a", "a"],
        knownColumnIds: ["a", "b", "c"],
      },
      existingRaw: JSON.stringify({ known_column_ids: ["a", "b"] }),
      preserveNewColumnsFromExistingKnownIds: true,
    });

    expect(serialized.visibleColumnIds).toEqual(["a", "c"]);
    expect(JSON.parse(serialized.json)).toEqual({
      show_client_column: false,
      visible_column_ids: ["a", "c"],
      known_column_ids: ["a", "b", "c"],
    });
  });

  it("reads filters while pruning unknown clients and columns", () => {
    const fallbackState = {
      fullNameFilter: "",
      clientFilters: [],
      columnTextFilters: {},
      columnOptionFilters: {},
    };
    const state = readTableFiltersState({
      raw: JSON.stringify({
        full_name_filter: "Ana",
        client_filters: ["client-1", "missing", "client-1"],
        column_text_filters: { col_1: " value ", missing: "ignored", col_2: " " },
        column_option_filters: { col_1: ["A", "A", ""], missing: ["B"] },
      }),
      knownColumnIds: new Set(["col_1", "col_2"]),
      knownClientIds: new Set(["client-1"]),
      fallbackState,
    });

    expect(state).toEqual({
      fullNameFilter: "Ana",
      clientFilters: ["client-1"],
      columnTextFilters: { col_1: " value " },
      columnOptionFilters: { col_1: ["A"] },
    });
  });

  it("serializes filters while pruning stale IDs", () => {
    const serialized = serializeTableFiltersState({
      fullNameFilter: "Ana",
      clientFilters: ["client-1", "missing"],
      columnTextFilters: { col_1: "x", missing: "ignored", col_2: "" },
      columnOptionFilters: { col_1: ["A", "A"], missing: ["B"] },
      knownColumnIds: ["col_1", "col_2"],
      knownClientIds: ["client-1"],
    });

    expect(JSON.parse(serialized)).toEqual({
      full_name_filter: "Ana",
      client_filters: ["client-1"],
      column_text_filters: { col_1: "x" },
      column_option_filters: { col_1: ["A"] },
    });
  });
});
