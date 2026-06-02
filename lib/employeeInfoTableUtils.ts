export type EmployeeInfoTableSortDir = "asc" | "desc";
export type EditableTableSortKey = "full_name" | "client" | `column:${string}`;

type EmployeeInfoColumnIdentity = {
  key: string | null | undefined;
  label: string | null | undefined;
};

export type EditableTableRecordIdentity = {
  id: string;
  full_name: string | null | undefined;
  client_id?: string | null | undefined;
};

export type EditableTableColumnIdentity = {
  id: string;
};

export type EditableTableCellValue = {
  option_value?: string | null | undefined;
  text_value?: string | null | undefined;
};

export type EditableTableFiltersInput = {
  fullNameFilter: string;
  clientFilters?: readonly string[];
  columnTextFilters: Record<string, string>;
  columnOptionFilters: Record<string, string[]>;
};

type FilterAndSortEditableTableRecordsInput<
  TRecord extends EditableTableRecordIdentity,
  TColumn extends EditableTableColumnIdentity,
  TValue extends EditableTableCellValue,
> = EditableTableFiltersInput & {
  records: readonly TRecord[];
  columns: readonly TColumn[];
  visibleColumns: readonly TColumn[];
  valuesByRecordId: Record<string, Record<string, TValue | undefined> | undefined>;
  clientNameById?: Record<string, string | undefined>;
  sortKey: EditableTableSortKey;
  sortDir: EmployeeInfoTableSortDir;
  noneFilterValue: string;
  getColumnTextValue: (record: TRecord, column: TColumn) => string;
  getColumnSortValue: (record: TRecord, column: TColumn) => string | number | null;
};

export function parseOptionsJson(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function formatOptionsInput(value: unknown) {
  return parseOptionsJson(value).join(", ");
}

export function toDateInputValue(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function isEmptyCellValue(value: string | null | undefined) {
  return String(value || "").trim() === "";
}

export function normalizeColumnToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS = new Set(["leave_date", "reason_for_leaving"]);
const LEAVE_DATE_COLUMN_TOKENS = new Set(["leave_date", "leaving_date", "date_of_leaving"]);

export function shouldHighlightEmptyStateForColumn(column: EmployeeInfoColumnIdentity) {
  const keyToken = normalizeColumnToken(column.key);
  const labelToken = normalizeColumnToken(column.label);
  return (
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(keyToken) &&
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(labelToken)
  );
}

export function isLeaveDateColumn(column: EmployeeInfoColumnIdentity) {
  const keyToken = normalizeColumnToken(column.key);
  const labelToken = normalizeColumnToken(column.label);
  return [keyToken, labelToken].some(
    (token) =>
      LEAVE_DATE_COLUMN_TOKENS.has(token) ||
      token.includes("leave_date") ||
      token.includes("date_of_leave")
  );
}

export function getCellFieldClassName(args: {
  isEmpty: boolean;
  minWidthClass: string;
  extraClassName?: string;
}) {
  const toneClassName = args.isEmpty
    ? "border-red-200 bg-red-50/70"
    : "border-slate-300 bg-white";
  return `${args.minWidthClass} rounded-md border ${toneClassName} px-2 py-1.5 text-sm text-slate-700 ${
    args.extraClassName || ""
  }`.trim();
}

export function getCellToneClass(isEmpty: boolean) {
  return isEmpty ? "bg-red-50/60" : "";
}

export type EditableCellControl = HTMLInputElement | HTMLSelectElement;

const EDITABLE_CELL_CONTROL_SELECTOR =
  'input[name="value"], select[name="value"], select[name="currency_code"]';
const EDITABLE_CELL_PRIMARY_VALUE_SELECTOR = 'input[name="value"], select[name="value"]';

export type EditableTableInteractionConfig = {
  popoverDataAttribute: string;
  currencySelectorDataAttribute: string;
};

export function syncEditableCellHighlight(
  control: EditableCellControl,
  shouldHighlight = true
) {
  const form = control.form;
  const primaryValueControl =
    form?.querySelector<EditableCellControl>(EDITABLE_CELL_PRIMARY_VALUE_SELECTOR) || control;
  const isEmpty = shouldHighlight && isEmptyCellValue(primaryValueControl.value);

  const visibleControls = form ? getEditableFormControls(form) : [control];

  visibleControls.forEach((field) => {
    field.classList.toggle("border-red-200", isEmpty);
    field.classList.toggle("bg-red-50/70", isEmpty);
    field.classList.toggle("border-slate-300", !isEmpty);
    field.classList.toggle("bg-white", !isEmpty);
  });

  const cell = control.closest("td");
  if (cell) {
    cell.classList.toggle("bg-red-50/60", isEmpty);
  }
}

export function getEditableFormControls(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<EditableCellControl>(EDITABLE_CELL_CONTROL_SELECTOR));
}

export function getEditableControlDefaultValue(control: EditableCellControl) {
  if (!("options" in control)) {
    return control.defaultValue;
  }

  const defaultOption = Array.from(control.options).find((option) => option.defaultSelected);
  if (defaultOption) return defaultOption.value;
  return control.options.item(0)?.value ?? "";
}

export function isEditableFormDirty(form: HTMLFormElement) {
  return getEditableFormControls(form).some(
    (field) => field.value !== getEditableControlDefaultValue(field)
  );
}

export function resetEditableFormControlsToDefault(form: HTMLFormElement) {
  getEditableFormControls(form).forEach((field) => {
    field.value = getEditableControlDefaultValue(field);
  });
}

export function getEditablePopoverSelector(popoverDataAttribute: string) {
  return `details[${popoverDataAttribute}="true"][open]`;
}

export function hasEditablePopoverOpen(popoverDataAttribute: string) {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(getEditablePopoverSelector(popoverDataAttribute)));
}

export function getElementFromEventTarget(target: EventTarget | null) {
  if (!target) return null;
  if (typeof Element !== "undefined" && target instanceof Element) return target;
  if (typeof Node !== "undefined" && target instanceof Node) return target.parentElement;
  return null;
}

export function getEditableCurrencySelector(currencySelectorDataAttribute: string) {
  return `[${currencySelectorDataAttribute}="true"]`;
}

export function isEditableCurrencySelectorTarget(
  target: Element | null,
  currencySelectorDataAttribute: string
) {
  return Boolean(target?.closest(getEditableCurrencySelector(currencySelectorDataAttribute)));
}

export function getEditableMenuInteractionSelector(config: EditableTableInteractionConfig) {
  return [
    "button",
    "a",
    "summary",
    '[role="button"]',
    '[role="menuitem"]',
    `[${config.popoverDataAttribute}="true"]`,
    getEditableCurrencySelector(config.currencySelectorDataAttribute),
  ].join(", ");
}

export function isEditableMenuInteractionTarget(
  target: Element | null,
  config: EditableTableInteractionConfig
) {
  if (!target) return false;
  return Boolean(target.closest(getEditableMenuInteractionSelector(config)));
}

export function countActiveEditableTableFilters({
  fullNameFilter,
  clientFilters = [],
  columnTextFilters,
  columnOptionFilters,
}: EditableTableFiltersInput) {
  let count = 0;
  if (fullNameFilter.trim()) count += 1;
  if (clientFilters.length) count += 1;
  count += Object.values(columnTextFilters).filter((value) => String(value || "").trim()).length;
  count += Object.values(columnOptionFilters).filter((values) => values.length > 0).length;
  return count;
}

export function filterAndSortEditableTableRecords<
  TRecord extends EditableTableRecordIdentity,
  TColumn extends EditableTableColumnIdentity,
  TValue extends EditableTableCellValue,
>({
  records,
  columns,
  visibleColumns,
  valuesByRecordId,
  fullNameFilter,
  clientFilters = [],
  columnTextFilters,
  columnOptionFilters,
  clientNameById = {},
  sortKey,
  sortDir,
  noneFilterValue,
  getColumnTextValue,
  getColumnSortValue,
}: FilterAndSortEditableTableRecordsInput<TRecord, TColumn, TValue>) {
  const normalizedFullNameFilter = fullNameFilter.trim().toLowerCase();
  const selectedClientSet = new Set(clientFilters);
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const visibleColumnById = new Map(visibleColumns.map((column) => [column.id, column]));
  const columnTextFilterEntries = Object.entries(columnTextFilters).filter(
    ([columnId, value]) => visibleColumnById.has(columnId) && Boolean(String(value || "").trim())
  );
  const columnOptionFilterEntries = Object.entries(columnOptionFilters).filter(
    ([columnId, values]) => visibleColumnById.has(columnId) && values.length > 0
  );

  const next = records.filter((record) => {
    if (
      normalizedFullNameFilter &&
      !String(record.full_name || "").toLowerCase().includes(normalizedFullNameFilter)
    ) {
      return false;
    }

    if (selectedClientSet.size > 0) {
      const clientValue = record.client_id || noneFilterValue;
      if (!selectedClientSet.has(clientValue)) {
        return false;
      }
    }

    for (const [columnId, values] of columnOptionFilterEntries) {
      const column = visibleColumnById.get(columnId);
      if (!column) continue;
      const valueRow = valuesByRecordId[record.id]?.[column.id];
      const optionValue = String(valueRow?.option_value || "").trim() || noneFilterValue;
      if (!values.includes(optionValue)) {
        return false;
      }
    }

    for (const [columnId, filterValue] of columnTextFilterEntries) {
      const column = visibleColumnById.get(columnId);
      if (!column) continue;
      const cellText = getColumnTextValue(record, column).toLowerCase();
      if (!cellText.includes(String(filterValue || "").trim().toLowerCase())) {
        return false;
      }
    }

    return true;
  });

  next.sort((left, right) => {
    const getRecordSortValue = (record: TRecord) => {
      if (sortKey === "full_name") {
        return String(record.full_name || "").trim().toLowerCase();
      }
      if (sortKey === "client") {
        return String(record.client_id ? clientNameById[record.client_id] || "" : "")
          .trim()
          .toLowerCase();
      }
      const columnId = sortKey.slice("column:".length);
      const column = columnById.get(columnId);
      return column ? getColumnSortValue(record, column) : null;
    };

    const primary = compareSortableValues(
      getRecordSortValue(left),
      getRecordSortValue(right),
      sortDir
    );
    if (primary !== 0) return primary;

    const secondary = compareSortableValues(
      String(left.full_name || "").trim().toLowerCase(),
      String(right.full_name || "").trim().toLowerCase(),
      "asc"
    );
    if (secondary !== 0) return secondary;

    return compareSortableValues(left.id, right.id, "asc");
  });

  return next;
}

export function parseSortableNumber(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/[^0-9.+-]/g, "");
  if (
    !normalized ||
    normalized === "-" ||
    normalized === "+" ||
    normalized === "." ||
    normalized === "-." ||
    normalized === "+."
  ) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSortableDateStamp(value: string | null | undefined) {
  const normalized = toDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
}

export function compareSortableValues(
  left: string | number | null,
  right: string | number | null,
  dir: EmployeeInfoTableSortDir
) {
  const leftEmpty =
    left == null || (typeof left === "string" && String(left).trim().length === 0);
  const rightEmpty =
    right == null || (typeof right === "string" && String(right).trim().length === 0);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  let base = 0;
  if (typeof left === "number" && typeof right === "number") {
    base = left - right;
  } else {
    base = String(left).localeCompare(String(right), undefined, {
      sensitivity: "base",
    });
  }

  return dir === "asc" ? base : -base;
}
