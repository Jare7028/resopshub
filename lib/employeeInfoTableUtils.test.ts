import { describe, expect, it } from "vitest";

import {
  compareSortableValues,
  formatOptionsInput,
  getCellFieldClassName,
  getCellToneClass,
  isEmptyCellValue,
  isLeaveDateColumn,
  normalizeColumnToken,
  parseOptionsJson,
  parseSortableDateStamp,
  parseSortableNumber,
  shouldHighlightEmptyStateForColumn,
  toDateInputValue,
} from "./employeeInfoTableUtils";

describe("employeeInfoTableUtils", () => {
  it("normalizes option arrays for inputs and filters", () => {
    expect(parseOptionsJson([" Alpha ", "", null, "Beta"])).toEqual(["Alpha", "Beta"]);
    expect(parseOptionsJson({ source: "clients" })).toEqual([]);
    expect(formatOptionsInput([" Alpha ", "Beta"])).toBe("Alpha, Beta");
  });

  it("normalizes date and empty cell values", () => {
    expect(toDateInputValue("2026-06-02T09:30:00Z")).toBe("2026-06-02");
    expect(toDateInputValue("not-a-date")).toBe("");
    expect(isEmptyCellValue("   ")).toBe(true);
    expect(isEmptyCellValue("0")).toBe(false);
  });

  it("normalizes column tokens and column highlight rules", () => {
    expect(normalizeColumnToken(" Reason for Leaving ")).toBe("reason_for_leaving");
    expect(shouldHighlightEmptyStateForColumn({ key: "leave_date", label: "Leave date" })).toBe(
      false
    );
    expect(shouldHighlightEmptyStateForColumn({ key: "job_title", label: "Job Title" })).toBe(
      true
    );
    expect(isLeaveDateColumn({ key: "custom", label: "Date of leave" })).toBe(true);
    expect(isLeaveDateColumn({ key: "start_date", label: "Start date" })).toBe(false);
  });

  it("builds stable empty-cell class names", () => {
    expect(getCellToneClass(true)).toBe("bg-red-50/60");
    expect(getCellToneClass(false)).toBe("");
    expect(
      getCellFieldClassName({
        isEmpty: true,
        minWidthClass: "min-w-40",
        extraClassName: "font-medium",
      })
    ).toContain("border-red-200 bg-red-50/70");
  });

  it("parses sortable numbers from formatted values", () => {
    expect(parseSortableNumber("1,234.50")).toBe(1234.5);
    expect(parseSortableNumber("$1,234")).toBe(1234);
    expect(parseSortableNumber("-")).toBeNull();
    expect(parseSortableNumber("not available")).toBeNull();
  });

  it("parses sortable dates at a stable UTC midday stamp", () => {
    expect(parseSortableDateStamp("2026-06-02")).toBe(Date.UTC(2026, 5, 2, 12, 0, 0, 0));
    expect(parseSortableDateStamp("invalid")).toBeNull();
  });

  it("keeps empty sort values last in both directions", () => {
    expect(compareSortableValues(null, "Alpha", "asc")).toBeGreaterThan(0);
    expect(compareSortableValues(null, "Alpha", "desc")).toBeGreaterThan(0);
    expect(compareSortableValues("Beta", "alpha", "asc")).toBeGreaterThan(0);
    expect(compareSortableValues("Beta", "alpha", "desc")).toBeLessThan(0);
    expect(compareSortableValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareSortableValues(2, 10, "desc")).toBeGreaterThan(0);
  });
});
