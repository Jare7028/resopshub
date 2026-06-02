import { describe, expect, it } from "vitest";

import {
  compareSortableValues,
  countActiveEditableTableFilters,
  filterAndSortEditableTableRecords,
  formatOptionsInput,
  getCellFieldClassName,
  getCellToneClass,
  getEditableControlDefaultValue,
  getEditableCurrencySelector,
  getEditableMenuInteractionSelector,
  getEditablePopoverSelector,
  isEmptyCellValue,
  isEditableCurrencySelectorTarget,
  isEditableMenuInteractionTarget,
  hasEditablePopoverOpen,
  getElementFromEventTarget,
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

  it("normalizes editable form defaults and selectors", () => {
    const selectOptions = [
      { value: "first", defaultSelected: false },
      { value: "second", defaultSelected: true },
    ];
    const selectOptionsCollection = Object.assign(selectOptions, {
      item(index: number): (typeof selectOptions)[number] | null {
        return selectOptions[index] ?? null;
      },
    });

    expect(
      getEditableControlDefaultValue({
        defaultValue: "Original",
      } as HTMLInputElement)
    ).toBe("Original");

    expect(
      getEditableControlDefaultValue({
        options: selectOptionsCollection,
      } as unknown as HTMLSelectElement)
    ).toBe("second");

    expect(getEditablePopoverSelector("data-inventory-popover")).toBe(
      'details[data-inventory-popover="true"][open]'
    );
    expect(getEditableCurrencySelector("data-inventory-currency-selector")).toBe(
      '[data-inventory-currency-selector="true"]'
    );
    expect(
      getEditableMenuInteractionSelector({
        popoverDataAttribute: "data-inventory-popover",
        currencySelectorDataAttribute: "data-inventory-currency-selector",
      })
    ).toContain('[data-inventory-popover="true"]');
  });

  it("handles editable menu target checks without a browser document", () => {
    expect(hasEditablePopoverOpen("data-inventory-popover")).toBe(false);
    expect(getElementFromEventTarget(null)).toBeNull();

    const target = {
      closest(selector: string) {
        return selector.includes("data-inventory-popover") ? this : null;
      },
    } as unknown as Element;

    expect(
      isEditableMenuInteractionTarget(target, {
        popoverDataAttribute: "data-inventory-popover",
        currencySelectorDataAttribute: "data-inventory-currency-selector",
      })
    ).toBe(true);
    expect(isEditableCurrencySelectorTarget(target, "data-inventory-currency-selector")).toBe(
      false
    );
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

  it("counts active editable-table filters", () => {
    expect(
      countActiveEditableTableFilters({
        fullNameFilter: " Ana ",
        clientFilters: ["client-1"],
        columnTextFilters: { col_1: " value ", col_2: "" },
        columnOptionFilters: { col_3: ["A"], col_4: [] },
      })
    ).toBe(4);
  });

  it("filters and sorts editable-table records through visible columns", () => {
    const records = [
      { id: "record-3", full_name: "Zoe", client_id: "client-2" },
      { id: "record-2", full_name: "Ana", client_id: null },
      { id: "record-1", full_name: "Ana", client_id: "client-1" },
    ];
    const columns = [
      { id: "role", kind: "text" },
      { id: "score", kind: "number" },
      { id: "hidden", kind: "text" },
    ];
    const valuesByRecordId: Record<
      string,
      Record<string, { option_value?: string | null; text_value?: string | null }>
    > = {
      "record-1": {
        role: { option_value: "Lead", text_value: "Support lead" },
        score: { option_value: null, text_value: "20" },
        hidden: { option_value: null, text_value: "secret" },
      },
      "record-2": {
        role: { option_value: "", text_value: "Support agent" },
        score: { option_value: null, text_value: "10" },
        hidden: { option_value: null, text_value: "secret" },
      },
      "record-3": {
        role: { option_value: "Lead", text_value: "Operations lead" },
        score: { option_value: null, text_value: "30" },
        hidden: { option_value: null, text_value: "secret" },
      },
    };

    const filtered = filterAndSortEditableTableRecords({
      records,
      columns,
      visibleColumns: columns.filter((column) => column.id !== "hidden"),
      valuesByRecordId,
      fullNameFilter: "",
      clientFilters: ["client-1", "__none__"],
      columnTextFilters: { role: "support", hidden: "secret" },
      columnOptionFilters: { role: ["Lead", "__none__"] },
      clientNameById: { "client-1": "Beta", "client-2": "Alpha" },
      sortKey: "column:score",
      sortDir: "desc",
      noneFilterValue: "__none__",
      getColumnTextValue(record, column) {
        return valuesByRecordId[record.id]?.[column.id]?.text_value || "";
      },
      getColumnSortValue(record, column) {
        if (column.id === "score") {
          return parseSortableNumber(valuesByRecordId[record.id]?.[column.id]?.text_value);
        }
        return valuesByRecordId[record.id]?.[column.id]?.text_value || null;
      },
    });

    expect(filtered.map((record) => record.id)).toEqual(["record-1", "record-2"]);
  });

  it("uses name and ID tie-breakers when editable-table sort values match", () => {
    const records = [
      { id: "record-2", full_name: "Ana", client_id: "client-1" },
      { id: "record-1", full_name: "Ana", client_id: "client-1" },
      { id: "record-3", full_name: "Bea", client_id: "client-1" },
    ];

    const sorted = filterAndSortEditableTableRecords({
      records,
      columns: [{ id: "score" }],
      visibleColumns: [{ id: "score" }],
      valuesByRecordId: {
        "record-1": { score: { text_value: "5" } },
        "record-2": { score: { text_value: "5" } },
        "record-3": { score: { text_value: "5" } },
      },
      fullNameFilter: "",
      columnTextFilters: {},
      columnOptionFilters: {},
      sortKey: "column:score",
      sortDir: "asc",
      noneFilterValue: "__none__",
      getColumnTextValue() {
        return "";
      },
      getColumnSortValue() {
        return 5;
      },
    });

    expect(sorted.map((record) => record.id)).toEqual(["record-1", "record-2", "record-3"]);
  });
});
