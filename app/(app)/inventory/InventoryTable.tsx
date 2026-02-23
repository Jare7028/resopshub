"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import FormulaAutocompleteInput, {
  type FormulaSuggestion,
} from "./FormulaAutocompleteInput";
import FormulaEditorDialog from "./FormulaEditorDialog";
import { EMPLOYEE_INFO_DISPLAY_CURRENCY_SWITCH_INTENT } from "./events";
import {
  EMPLOYEE_INFO_VISIBILITY_EVENT,
  persistEmployeeInfoFilters,
  persistEmployeeInfoVisibility,
  readEmployeeInfoFilters,
  readEmployeeInfoVisibility,
  type EmployeeInfoFiltersState,
  type EmployeeInfoVisibilityState,
} from "./inventoryVisibility";
import {
  EMPLOYEE_INFO_CURRENCY_CODES,
  EMPLOYEE_INFO_FORMULA_CURRENCY_MODES,
  formatEmployeeInfoCurrencyAmount,
  getEmployeeInfoCurrencySymbol,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoDisplayCurrencyCode,
  type EmployeeInfoFormulaCurrencyMode,
} from "@/lib/employeeInfo";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "../_components/TableHeaderFilters";

type ClientRow = {
  id: string;
  name: string;
};

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
};

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula" | "number" | "date" | "currency";
  formula: string | null;
  formula_currency_mode: "display" | "fixed";
  formula_currency_code: "USD" | "GBP" | "MUR";
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  text_value: string | null;
  option_value: string | null;
  money_currency_code: string | null;
};
type EmployeeInfoActionResult = { ok: boolean; error?: string };
type EmployeeInfoSortDir = "asc" | "desc";
type EmployeeInfoSortKey = "full_name" | "client" | `column:${string}`;
type InventoryDropdownSource = "custom" | "employee_names" | "clients";

const currencyLabelByCode: Record<EmployeeInfoCurrencyCode, string> = {
  USD: "USD ($)",
  GBP: "GBP (\u00A3)",
  MUR: "MUR (Rs)",
};
const NONE_FILTER_VALUE = "__none__";
const CURRENCY_SWITCH_INTENT_WINDOW_MS = 1500;

function parseOptionsJson(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseDropdownSource(value: unknown): InventoryDropdownSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "custom";
  }
  const source = String((value as { source?: unknown }).source || "")
    .trim()
    .toLowerCase();
  if (source === "employee_names") return "employee_names";
  if (source === "clients") return "clients";
  return "custom";
}

function formatOptionsInput(value: unknown) {
  return parseOptionsJson(value).join(", ");
}

function toDateInputValue(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isEmptyCellValue(value: string | null | undefined) {
  return String(value || "").trim() === "";
}

function normalizeColumnToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS = new Set(["leave_date", "reason_for_leaving"]);
const LEAVE_DATE_COLUMN_TOKENS = new Set(["leave_date", "leaving_date", "date_of_leaving"]);

function shouldHighlightEmptyStateForColumn(column: EmployeeInfoColumnRow) {
  const keyToken = normalizeColumnToken(column.key);
  const labelToken = normalizeColumnToken(column.label);
  return (
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(keyToken) &&
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(labelToken)
  );
}

function isLeaveDateColumn(column: EmployeeInfoColumnRow) {
  const keyToken = normalizeColumnToken(column.key);
  const labelToken = normalizeColumnToken(column.label);
  return [keyToken, labelToken].some(
    (token) =>
      LEAVE_DATE_COLUMN_TOKENS.has(token) ||
      token.includes("leave_date") ||
      token.includes("date_of_leave")
  );
}

function getCellFieldClassName(args: {
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

function getCellToneClass(isEmpty: boolean) {
  return isEmpty ? "bg-red-50/60" : "";
}

function syncEditableCellHighlight(
  control: HTMLInputElement | HTMLSelectElement,
  shouldHighlight = true
) {
  const form = control.form;
  const primaryValueControl =
    form?.querySelector<HTMLInputElement | HTMLSelectElement>(
      'input[name="value"], select[name="value"]'
    ) || control;
  const isEmpty = shouldHighlight && isEmptyCellValue(primaryValueControl.value);

  const visibleControls = form
    ? Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          'input[name="value"], select[name="value"], select[name="currency_code"]'
        )
      )
    : [control];

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

function getEditableFormControls(form: HTMLFormElement) {
  return Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input[name="value"], select[name="value"], select[name="currency_code"]'
    )
  );
}

function getEditableControlDefaultValue(control: HTMLInputElement | HTMLSelectElement) {
  if (control instanceof HTMLInputElement) {
    return control.defaultValue;
  }

  const defaultOption = Array.from(control.options).find((option) => option.defaultSelected);
  if (defaultOption) return defaultOption.value;
  return control.options.item(0)?.value ?? "";
}

function isEditableFormDirty(form: HTMLFormElement) {
  return getEditableFormControls(form).some(
    (field) => field.value !== getEditableControlDefaultValue(field)
  );
}

function resetEditableFormControlsToDefault(form: HTMLFormElement) {
  getEditableFormControls(form).forEach((field) => {
    field.value = getEditableControlDefaultValue(field);
  });
}

function hasEmployeeInfoPopoverOpen() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('details[data-inventory-popover="true"][open]'));
}

function getElementFromEventTarget(target: EventTarget | null) {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isEmployeeInfoMenuInteractionTarget(target: Element | null) {
  if (!target) return false;
  return Boolean(
    target.closest(
      'button, a, summary, [role="button"], [role="menuitem"], [data-inventory-popover="true"], [data-inventory-currency-selector="true"]'
    )
  );
}

function parseSortableNumber(value: string | null | undefined) {
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

function parseSortableDateStamp(value: string | null | undefined) {
  const normalized = toDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
}

function compareSortableValues(
  left: string | number | null,
  right: string | number | null,
  dir: EmployeeInfoSortDir
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

function ColumnEditPanel({
  column,
  columnIndex,
  totalColumns,
  formulaSuggestions,
  onUpdateColumn,
  onDeleteColumn,
  onMoveColumn,
}: {
  column: EmployeeInfoColumnRow;
  columnIndex: number;
  totalColumns: number;
  formulaSuggestions: FormulaSuggestion[];
  onUpdateColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onDeleteColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onMoveColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [columnKind, setColumnKind] = useState<EmployeeInfoColumnRow["column_kind"]>(
    column.column_kind
  );
  const [currencyCode, setCurrencyCode] = useState<EmployeeInfoCurrencyCode>(() =>
    parseEmployeeInfoCurrencyCodeFromOptions(column.options_json)
  );
  const [formulaCurrencyMode, setFormulaCurrencyMode] =
    useState<EmployeeInfoFormulaCurrencyMode>(() =>
      normalizeEmployeeInfoFormulaCurrencyMode(column.formula_currency_mode)
    );
  const [formulaCurrencyCode, setFormulaCurrencyCode] = useState<EmployeeInfoCurrencyCode>(() =>
    normalizeEmployeeInfoCurrencyCode(column.formula_currency_code)
  );
  const [formulaValue, setFormulaValue] = useState(column.formula || "");
  const [isFormulaEditorOpen, setIsFormulaEditorOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const updateFormRef = useRef<HTMLFormElement | null>(null);
  const dropdownSource = parseDropdownSource(column.options_json);
  const initialLabel = column.label;
  const initialKind = column.column_kind;
  const initialDropdownOptions = formatOptionsInput(column.options_json);
  const initialDropdownSource = dropdownSource;
  const initialFormula = column.formula || "";
  const initialCurrencyCode = parseEmployeeInfoCurrencyCodeFromOptions(column.options_json);
  const initialFormulaCurrencyMode = normalizeEmployeeInfoFormulaCurrencyMode(
    column.formula_currency_mode
  );
  const initialFormulaCurrencyCode = normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);

  useEffect(() => {
    if (columnKind !== "formula" && isFormulaEditorOpen) {
      setIsFormulaEditorOpen(false);
    }
  }, [columnKind, isFormulaEditorOpen]);

  const runAction = (
    event: FormEvent<HTMLFormElement>,
    action: (formData: FormData) => Promise<EmployeeInfoActionResult>,
    options?: { closeDetails?: boolean; refresh?: boolean }
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await action(formData);
      if (!result?.ok) {
        if (result?.error) window.alert(result.error);
        return;
      }
      if (options?.closeDetails && detailsRef.current) {
        detailsRef.current.open = false;
      }
      if (options?.refresh !== false) {
        router.refresh();
      }
    });
  };

  useEffect(() => {
    const onDocumentMouseDown = (event: globalThis.MouseEvent) => {
      if (isFormulaEditorOpen) return;
      const details = detailsRef.current;
      const updateForm = updateFormRef.current;
      if (!details?.open || !updateForm) return;

      const target = event.target as Node | null;
      if (target && details.contains(target)) return;

      const formData = new FormData(updateForm);
      const nextLabel = String(formData.get("label") || "");
      const nextKind = String(formData.get("column_kind") || "");
      const nextDropdownOptions = String(formData.get("dropdown_options") || "");
      const nextDropdownSource = String(formData.get("dropdown_source") || "custom").trim();
      const nextFormula = String(formData.get("formula") || "");
      const nextCurrencyCode = normalizeEmployeeInfoCurrencyCode(
        String(formData.get("currency_code") || "")
      );
      const nextFormulaCurrencyMode = normalizeEmployeeInfoFormulaCurrencyMode(
        String(formData.get("formula_currency_mode") || "")
      );
      const nextFormulaCurrencyCode = normalizeEmployeeInfoCurrencyCode(
        String(formData.get("formula_currency_code") || "")
      );
      const shouldCompareFormulaCurrencyCode =
        nextKind === "formula" &&
        (nextFormulaCurrencyMode === "fixed" || initialFormulaCurrencyMode === "fixed");
      const shouldCompareDropdownOptions =
        nextKind === "dropdown" &&
        (nextDropdownSource === "custom" || initialDropdownSource === "custom");

      const hasChanges =
        nextLabel !== initialLabel ||
        nextKind !== initialKind ||
        nextDropdownSource !== initialDropdownSource ||
        (shouldCompareDropdownOptions && nextDropdownOptions !== initialDropdownOptions) ||
        nextFormula !== initialFormula ||
        nextCurrencyCode !== initialCurrencyCode ||
        nextFormulaCurrencyMode !== initialFormulaCurrencyMode ||
        (shouldCompareFormulaCurrencyCode && nextFormulaCurrencyCode !== initialFormulaCurrencyCode);

      if (hasChanges) {
        if (!updateForm.reportValidity()) {
          return;
        }
        updateForm.requestSubmit();
      }

      details.open = false;
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, [
    initialCurrencyCode,
    initialDropdownSource,
    initialDropdownOptions,
    initialFormula,
    initialFormulaCurrencyCode,
    initialFormulaCurrencyMode,
    initialKind,
    initialLabel,
    isFormulaEditorOpen,
  ]);

  return (
    <details
      ref={detailsRef}
      className="relative shrink-0"
      data-inventory-popover="true"
    >
      <summary
        className="flex h-6 items-center rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold tracking-normal text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label={`Edit ${column.label}`}
        title={`Edit ${column.label}`}
      >
        Edit
      </summary>
      <div className="absolute right-0 z-[140] mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 text-left normal-case shadow-lg">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <form onSubmit={(event) => runAction(event, onMoveColumn, { refresh: true })}>
            <input type="hidden" name="column_id" value={column.id} />
            <input type="hidden" name="direction" value="left" />
            <button
              type="submit"
              disabled={columnIndex === 0}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move left
            </button>
          </form>
          <form onSubmit={(event) => runAction(event, onMoveColumn, { refresh: true })}>
            <input type="hidden" name="column_id" value={column.id} />
            <input type="hidden" name="direction" value="right" />
            <button
              type="submit"
              disabled={columnIndex === totalColumns - 1}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move right
            </button>
          </form>
        </div>
        <form
          ref={updateFormRef}
          onSubmit={(event) => runAction(event, onUpdateColumn, { closeDetails: true, refresh: true })}
          className="grid gap-2"
        >
          <input type="hidden" name="column_id" value={column.id} />
          <input type="hidden" name="dropdown_source" value={dropdownSource} />
          <input
            name="label"
            defaultValue={column.label}
            placeholder="Column label"
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            required
          />
          <select
            name="column_kind"
            value={columnKind}
            onChange={(event) =>
              setColumnKind(event.currentTarget.value as EmployeeInfoColumnRow["column_kind"])
            }
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="currency">Currency ($)</option>
            <option value="dropdown">Dropdown</option>
            <option value="formula">Formula</option>
          </select>
          {columnKind === "currency" ? (
            <select
              name="currency_code"
              value={currencyCode}
              onChange={(event) =>
                setCurrencyCode(normalizeEmployeeInfoCurrencyCode(event.currentTarget.value))
              }
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {currencyLabelByCode[code]}
                </option>
              ))}
            </select>
          ) : null}
          {columnKind === "dropdown" ? (
            dropdownSource === "custom" ? (
              <input
                name="dropdown_options"
                defaultValue={formatOptionsInput(column.options_json)}
                placeholder="Dropdown options (comma separated)"
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                required
              />
            ) : (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
                {dropdownSource === "employee_names"
                  ? "Options auto-sync from Employee Info names."
                  : "Options auto-sync from Clients."}
              </p>
            )
          ) : null}
          {columnKind === "formula" ? (
            <>
              <FormulaAutocompleteInput
                name="formula"
                value={formulaValue}
                onValueChange={setFormulaValue}
                placeholder='Formula (e.g. =IF(OR(client="Resolvable",client="Dusk"),500,0))'
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                required
                suggestions={formulaSuggestions}
              />
              <button
                type="button"
                onClick={() => setIsFormulaEditorOpen(true)}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Open Formula Editor
              </button>
              <select
                name="formula_currency_mode"
                value={formulaCurrencyMode}
                onChange={(event) =>
                  setFormulaCurrencyMode(
                    normalizeEmployeeInfoFormulaCurrencyMode(event.currentTarget.value)
                  )
                }
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              >
                {EMPLOYEE_INFO_FORMULA_CURRENCY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "display" ? "Follow display currency" : "Fixed currency"}
                  </option>
                ))}
              </select>
              {formulaCurrencyMode === "fixed" ? (
                <select
                  name="formula_currency_code"
                  value={formulaCurrencyCode}
                  onChange={(event) =>
                    setFormulaCurrencyCode(
                      normalizeEmployeeInfoCurrencyCode(event.currentTarget.value)
                    )
                  }
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                >
                  {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {currencyLabelByCode[code]}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : null}
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Save
          </button>
        </form>
        <form
          onSubmit={(event) => runAction(event, onDeleteColumn, { closeDetails: true, refresh: true })}
          className="mt-2"
        >
          <input type="hidden" name="column_id" value={column.id} />
          <button
            type="submit"
            className="h-9 w-full rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            Delete column
          </button>
        </form>
      </div>
      <FormulaEditorDialog
        open={isFormulaEditorOpen}
        title={`Formula Editor: ${column.label}`}
        value={formulaValue}
        onValueChange={setFormulaValue}
        onClose={() => setIsFormulaEditorOpen(false)}
        suggestions={formulaSuggestions}
      />
    </details>
  );
}

export default function InventoryTable({
  records,
  clients,
  employeeNameOptions,
  columns,
  valuesByRecordId,
  formulaValueByRecordIdAndColumnId,
  currencyDisplayValueByRecordIdAndColumnId,
  displayCurrency,
  currentUserId,
  isAdmin,
  formulaSuggestions,
  onCreateRecord,
  onUpdateCell,
  onUpdateColumn,
  onDeleteColumn,
  onMoveColumn,
}: {
  records: EmployeeInfoRecordRow[];
  clients: ClientRow[];
  employeeNameOptions: string[];
  columns: EmployeeInfoColumnRow[];
  valuesByRecordId: Record<string, Record<string, EmployeeInfoValueRow>>;
  formulaValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  currencyDisplayValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  displayCurrency: EmployeeInfoDisplayCurrencyCode;
  currentUserId?: string | null;
  isAdmin: boolean;
  formulaSuggestions: FormulaSuggestion[];
  onCreateRecord: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onUpdateCell: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onUpdateColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onDeleteColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
  onMoveColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const createRecordFormId = "inventory-create-record-form";
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => columns.map((c) => c.id));
  const [sortKey, setSortKey] = useState<EmployeeInfoSortKey>("full_name");
  const [sortDir, setSortDir] = useState<EmployeeInfoSortDir>("asc");
  const [fullNameFilter, setFullNameFilter] = useState("");
  const [columnTextFilters, setColumnTextFilters] = useState<Record<string, string>>({});
  const [columnOptionFilters, setColumnOptionFilters] = useState<Record<string, string[]>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [hasLoadedVisibility, setHasLoadedVisibility] = useState(false);
  const [hasLoadedFilters, setHasLoadedFilters] = useState(false);
  const knownColumnIdsRef = useRef(new Set(columns.map((column) => column.id)));
  const currencySwitchIntentAtRef = useRef(0);
  const lastPointerDownTargetRef = useRef<Element | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenuRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tableRootRef = useRef<HTMLDivElement | null>(null);

  const visibleColumnIdSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]);
  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleColumnIdSet.has(column.id)),
    [columns, visibleColumnIdSet]
  );
  const columnIndexById = useMemo(() => {
    const indexById: Record<string, number> = {};
    columns.forEach((column, index) => {
      indexById[column.id] = index;
    });
    return indexById;
  }, [columns]);
  const clientNameById = useMemo(
    () =>
      clients.reduce<Record<string, string>>((acc, client) => {
        acc[client.id] = client.name;
        return acc;
      }, {}),
    [clients]
  );
  const normalizedEmployeeNameOptions = useMemo(
    () =>
      Array.from(
        new Set(
          employeeNameOptions
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )
      ),
    [employeeNameOptions]
  );
  const getDropdownOptionsForColumn = useCallback(
    (column: EmployeeInfoColumnRow) => {
      const source = parseDropdownSource(column.options_json);
      if (source === "employee_names") {
        return normalizedEmployeeNameOptions;
      }
      if (source === "clients") {
        return clients.map((client) => client.name);
      }
      return parseOptionsJson(column.options_json);
    },
    [clients, normalizedEmployeeNameOptions]
  );
  const leaveDateColumnIds = useMemo(
    () => columns.filter((column) => isLeaveDateColumn(column)).map((column) => column.id),
    [columns]
  );
  const recordIdsWithLeaveDate = useMemo(() => {
    if (!leaveDateColumnIds.length) return new Set<string>();
    const next = new Set<string>();
    records.forEach((record) => {
      const valuesByColumnId = valuesByRecordId[record.id] || {};
      const hasLeaveDate = leaveDateColumnIds.some((columnId) => {
        const rawValue = valuesByColumnId[columnId]?.text_value;
        return Boolean(toDateInputValue(rawValue) || String(rawValue || "").trim());
      });
      if (hasLeaveDate) {
        next.add(record.id);
      }
    });
    return next;
  }, [leaveDateColumnIds, records, valuesByRecordId]);

  useEffect(() => {
    if (hasLoadedVisibility) return;
    const knownColumnIds = new Set(columns.map((column) => column.id));
    const loaded = readEmployeeInfoVisibility(knownColumnIds, {
      showClientColumn: false,
      visibleColumnIds: columns.map((column) => column.id),
    }, { userId: currentUserId });

    setVisibleColumnIds(loaded.visibleColumnIds);
    setHasLoadedVisibility(true);
  }, [columns, currentUserId, hasLoadedVisibility]);

  useEffect(() => {
    if (hasLoadedFilters) return;
    const knownColumnIds = new Set(columns.map((column) => column.id));
    const knownClientIds = new Set(clients.map((client) => client.id));
    const loaded = readEmployeeInfoFilters({
      knownColumnIds,
      knownClientIds,
      fallbackState: {
        fullNameFilter: "",
        clientFilters: [],
        columnTextFilters: {},
        columnOptionFilters: {},
      } satisfies EmployeeInfoFiltersState,
      options: { userId: currentUserId },
    });

    setFullNameFilter(loaded.fullNameFilter);
    setColumnTextFilters(loaded.columnTextFilters);
    setColumnOptionFilters(loaded.columnOptionFilters);
    setHasLoadedFilters(true);
  }, [clients, columns, currentUserId, hasLoadedFilters]);

  useEffect(() => {
    setVisibleColumnIds((previous) => {
      const previousVisibleSet = new Set(previous);
      const previouslyKnownColumnIds = knownColumnIdsRef.current;
      const next = previous.filter((columnId) => columns.some((column) => column.id === columnId));
      columns.forEach((column) => {
        if (!previouslyKnownColumnIds.has(column.id) && !previousVisibleSet.has(column.id)) {
          next.push(column.id);
        }
      });
      knownColumnIdsRef.current = new Set(columns.map((column) => column.id));
      return next;
    });
  }, [columns]);

  useEffect(() => {
    if (!hasLoadedVisibility) return;
    persistEmployeeInfoVisibility({
      showClientColumn: false,
      visibleColumnIds,
      knownColumnIds: columns.map((column) => column.id),
    }, { userId: currentUserId });
  }, [columns, currentUserId, hasLoadedVisibility, visibleColumnIds]);

  useEffect(() => {
    if (!hasLoadedFilters) return;
    persistEmployeeInfoFilters({
      fullNameFilter,
      clientFilters: [],
      columnTextFilters,
      columnOptionFilters,
      knownColumnIds: columns.map((column) => column.id),
      knownClientIds: clients.map((client) => client.id),
      options: { userId: currentUserId },
    });
  }, [
    clients,
    columnOptionFilters,
    columnTextFilters,
    columns,
    currentUserId,
    fullNameFilter,
    hasLoadedFilters,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onVisibilityUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<EmployeeInfoVisibilityState>;
      const detail = customEvent.detail;
      if (!detail) return;

      const knownColumnIds = new Set(columns.map((column) => column.id));
      const normalizedVisibleColumnIds = Array.from(
        new Set(
          (detail.visibleColumnIds || [])
            .map((value) => String(value || "").trim())
            .filter((value) => knownColumnIds.has(value))
        )
      );

      setVisibleColumnIds(normalizedVisibleColumnIds);
    };

    window.addEventListener(EMPLOYEE_INFO_VISIBILITY_EVENT, onVisibilityUpdated);
    return () => {
      window.removeEventListener(EMPLOYEE_INFO_VISIBILITY_EVENT, onVisibilityUpdated);
    };
  }, [columns]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const markCurrencySwitchIntent = () => {
      currencySwitchIntentAtRef.current = Date.now();
    };

    window.addEventListener(
      EMPLOYEE_INFO_DISPLAY_CURRENCY_SWITCH_INTENT,
      markCurrencySwitchIntent
    );
    return () => {
      window.removeEventListener(
        EMPLOYEE_INFO_DISPLAY_CURRENCY_SWITCH_INTENT,
        markCurrencySwitchIntent
      );
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trackPointerDownTarget = (event: PointerEvent) => {
      lastPointerDownTargetRef.current = getElementFromEventTarget(event.target);
    };

    window.addEventListener("pointerdown", trackPointerDownTarget, true);
    return () => {
      window.removeEventListener("pointerdown", trackPointerDownTarget, true);
    };
  }, []);

  useEffect(() => {
    openMenuRef.current = openMenu;
  }, [openMenu]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMenu]);

  useEffect(() => {
    const knownColumnIdSet = new Set(columns.map((column) => column.id));
    const visibleColumnIdSetLocal = new Set(visibleColumns.map((column) => column.id));

    setColumnTextFilters((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([columnId, value]) => {
          return (
            knownColumnIdSet.has(columnId) &&
            visibleColumnIdSetLocal.has(columnId) &&
            Boolean(String(value || "").trim())
          );
        })
      )
    );

    setColumnOptionFilters((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([columnId, values]) => {
          return (
            knownColumnIdSet.has(columnId) &&
            visibleColumnIdSetLocal.has(columnId) &&
            Array.isArray(values) &&
            values.length > 0
          );
        })
      )
    );

    if (sortKey.startsWith("column:")) {
      const sortedColumnId = sortKey.slice("column:".length);
      if (!knownColumnIdSet.has(sortedColumnId) || !visibleColumnIdSetLocal.has(sortedColumnId)) {
        setSortKey("full_name");
        setSortDir("asc");
      }
    }
  }, [columns, sortKey, visibleColumns]);

  const getHighlightPolicyForControl = (control: HTMLInputElement | HTMLSelectElement) => {
    const form = control.form;
    const columnId = String(
      form?.querySelector<HTMLInputElement>('input[name="column_id"]')?.value || ""
    );
    const column = columns.find((item) => item.id === columnId);
    return column ? shouldHighlightEmptyStateForColumn(column) : true;
  };

  const queueTableRefresh = useCallback(() => {
    const attemptRefresh = () => {
      if (openMenuRef.current || hasEmployeeInfoPopoverOpen()) {
        refreshTimeoutRef.current = setTimeout(attemptRefresh, 180);
        return;
      }
      refreshTimeoutRef.current = null;
      router.refresh();
    };

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(attemptRefresh, 180);
  }, [router]);

  const saveControlChange = (control: HTMLInputElement | HTMLSelectElement) => {
    const shouldHighlight = getHighlightPolicyForControl(control);
    syncEditableCellHighlight(control, shouldHighlight);
    const form = control.form;
    if (!form) return;
    if (!isEditableFormDirty(form)) return;
    const formData = new FormData(form);
    startTransition(() => {
      void (async () => {
        const result = await onUpdateCell(formData);
        if (!result?.ok && result?.error) {
          window.alert(result.error);
          return;
        }
        if (result?.ok) {
          queueTableRefresh();
        }
      })();
    });
  };

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    saveControlChange(event.currentTarget);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const shouldHighlight = getHighlightPolicyForControl(event.currentTarget);
    syncEditableCellHighlight(event.currentTarget, shouldHighlight);
  };

  const handleInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    const pointerTarget = lastPointerDownTargetRef.current;
    const blurIntentTarget = relatedTarget || pointerTarget;
    const isCurrencySelectorTarget = Boolean(
      blurIntentTarget?.closest('[data-inventory-currency-selector="true"]')
    );
    const isMenuInteractionTarget = isEmployeeInfoMenuInteractionTarget(blurIntentTarget);
    const isLeavingTableArea = Boolean(
      blurIntentTarget && tableRootRef.current && !tableRootRef.current.contains(blurIntentTarget)
    );
    const withinSwitchIntentWindow =
      Date.now() - currencySwitchIntentAtRef.current < CURRENCY_SWITCH_INTENT_WINDOW_MS;
    if (
      isCurrencySelectorTarget ||
      withinSwitchIntentWindow ||
      isMenuInteractionTarget ||
      isLeavingTableArea
    ) {
      const form = event.currentTarget.form;
      if (form) {
        resetEditableFormControlsToDefault(form);
      }
      const shouldHighlight = getHighlightPolicyForControl(event.currentTarget);
      syncEditableCellHighlight(event.currentTarget, shouldHighlight);
      return;
    }
    saveControlChange(event.currentTarget);
  };

  const handleCreateRecordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await onCreateRecord(formData);
      if (!result?.ok) {
        if (result?.error) window.alert(result.error);
        return;
      }
      setIsAddingRow(false);
      setNewFullName("");
      router.refresh();
    });
  };

  const getColumnTextValue = useCallback(
    (record: EmployeeInfoRecordRow, column: EmployeeInfoColumnRow) => {
      const valueRow = valuesByRecordId[record.id]?.[column.id];
      if (column.column_kind === "formula") {
        return String(formulaValueByRecordIdAndColumnId[record.id]?.[column.id] || "").trim();
      }
      if (column.column_kind === "dropdown") {
        return String(valueRow?.option_value || "").trim();
      }
      if (column.column_kind === "currency") {
        if (displayCurrency !== "ORIGINAL") {
          return String(
            currencyDisplayValueByRecordIdAndColumnId[record.id]?.[column.id] || ""
          ).trim();
        }
        return String(valueRow?.text_value || "").trim();
      }
      if (column.column_kind === "date") {
        return toDateInputValue(valueRow?.text_value);
      }
      return String(valueRow?.text_value || "").trim();
    },
    [
      currencyDisplayValueByRecordIdAndColumnId,
      displayCurrency,
      formulaValueByRecordIdAndColumnId,
      valuesByRecordId,
    ]
  );

  const getColumnSortValue = useCallback(
    (record: EmployeeInfoRecordRow, column: EmployeeInfoColumnRow) => {
      const valueRow = valuesByRecordId[record.id]?.[column.id];

      if (column.column_kind === "dropdown") {
        const value = String(valueRow?.option_value || "").trim();
        return value ? value.toLowerCase() : null;
      }

      if (column.column_kind === "date") {
        return parseSortableDateStamp(valueRow?.text_value);
      }

      if (column.column_kind === "number") {
        return parseSortableNumber(valueRow?.text_value);
      }

      if (column.column_kind === "currency") {
        if (displayCurrency !== "ORIGINAL") {
          const convertedValue =
            currencyDisplayValueByRecordIdAndColumnId[record.id]?.[column.id] || "";
          const convertedNumber = parseSortableNumber(convertedValue);
          if (convertedNumber !== null) {
            return convertedNumber;
          }
        }
        return parseSortableNumber(valueRow?.text_value);
      }

      if (column.column_kind === "formula") {
        const formulaValue = String(
          formulaValueByRecordIdAndColumnId[record.id]?.[column.id] || ""
        ).trim();
        const formulaNumber = parseSortableNumber(formulaValue);
        if (formulaNumber !== null) {
          return formulaNumber;
        }
        return formulaValue ? formulaValue.toLowerCase() : null;
      }

      const textValue = String(valueRow?.text_value || "").trim();
      return textValue ? textValue.toLowerCase() : null;
    },
    [
      currencyDisplayValueByRecordIdAndColumnId,
      displayCurrency,
      formulaValueByRecordIdAndColumnId,
      valuesByRecordId,
    ]
  );

  const applySort = (nextKey: EmployeeInfoSortKey) => {
    if (sortKey === nextKey) {
      setSortDir((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  };

  const headerClass = (key: EmployeeInfoSortKey) =>
    `inline-flex items-center gap-2 hover:text-slate-900 ${
      sortKey === key ? "text-slate-900" : "text-slate-500"
    }`;

  const sortIndicator = (key: EmployeeInfoSortKey) => {
    if (sortKey !== key) return null;
    return (
      <span aria-hidden="true" className="text-[10px] text-slate-400">
        {sortDir === "asc" ? "^" : "v"}
      </span>
    );
  };

  const setColumnTextFilter = (columnId: string, nextValue: string) => {
    setColumnTextFilters((previous) => {
      const normalized = String(nextValue || "");
      if (!normalized.trim()) {
        if (!(columnId in previous)) return previous;
        const next = { ...previous };
        delete next[columnId];
        return next;
      }
      return { ...previous, [columnId]: normalized };
    });
  };

  const setColumnOptionFilter = (columnId: string, nextValues: string[]) => {
    setColumnOptionFilters((previous) => {
      if (!nextValues.length) {
        if (!(columnId in previous)) return previous;
        const next = { ...previous };
        delete next[columnId];
        return next;
      }
      return { ...previous, [columnId]: nextValues };
    });
  };

  const clearAllFilters = () => {
    setFullNameFilter("");
    setColumnTextFilters({});
    setColumnOptionFilters({});
    setOpenMenu(null);
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (fullNameFilter.trim()) count += 1;
    count += Object.values(columnTextFilters).filter((value) => String(value || "").trim()).length;
    count += Object.values(columnOptionFilters).filter((values) => values.length > 0).length;
    return count;
  }, [columnOptionFilters, columnTextFilters, fullNameFilter]);

  const filteredAndSortedRecords = useMemo(() => {
    const normalizedFullNameFilter = fullNameFilter.trim().toLowerCase();
    const visibleColumnById = new Map(visibleColumns.map((column) => [column.id, column]));
    const columnTextFilterEntries = Object.entries(columnTextFilters).filter(([columnId, value]) => {
      return visibleColumnById.has(columnId) && Boolean(String(value || "").trim());
    });
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

      for (const [columnId, values] of columnOptionFilterEntries) {
        const column = visibleColumnById.get(columnId);
        if (!column) continue;
        const valueRow = valuesByRecordId[record.id]?.[column.id];
        const optionValue = String(valueRow?.option_value || "").trim() || NONE_FILTER_VALUE;
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
      const leftValue =
        sortKey === "full_name"
          ? String(left.full_name || "").trim().toLowerCase()
          : sortKey === "client"
          ? String(left.client_id ? clientNameById[left.client_id] || "" : "").trim().toLowerCase()
          : (() => {
              const columnId = sortKey.slice("column:".length);
              const column = columns.find((item) => item.id === columnId);
              return column ? getColumnSortValue(left, column) : null;
            })();

      const rightValue =
        sortKey === "full_name"
          ? String(right.full_name || "").trim().toLowerCase()
          : sortKey === "client"
          ? String(right.client_id ? clientNameById[right.client_id] || "" : "").trim().toLowerCase()
          : (() => {
              const columnId = sortKey.slice("column:".length);
              const column = columns.find((item) => item.id === columnId);
              return column ? getColumnSortValue(right, column) : null;
            })();

      const primary = compareSortableValues(leftValue, rightValue, sortDir);
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
  }, [
    clientNameById,
    columnOptionFilters,
    columnTextFilters,
    columns,
    fullNameFilter,
    records,
    sortDir,
    sortKey,
    valuesByRecordId,
    visibleColumns,
    getColumnSortValue,
    getColumnTextValue,
  ]);

  const hasAnyFilters = activeFilterCount > 0;

  const preventMiddleClickAutoscroll = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  return (
    <div ref={tableRootRef} className="space-y-3">
      <div className="mobile-filter-panel space-y-2 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Filters{hasAnyFilters ? ` (${activeFilterCount})` : ""}
          </p>
          {hasAnyFilters ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              onClick={clearAllFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <input
          type="text"
          value={fullNameFilter}
          onChange={(event) => setFullNameFilter(event.currentTarget.value)}
          placeholder="Filter inventory item..."
          className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
        />
      </div>

      <div
        className="relative overflow-x-auto overflow-y-visible"
        onMouseDown={preventMiddleClickAutoscroll}
        onAuxClick={preventMiddleClickAutoscroll}
      >
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 top-0 z-40 border-r border-slate-200 bg-slate-50 px-4 py-3">
                <div className="relative flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={headerClass("full_name")}
                    onClick={() => applySort("full_name")}
                  >
                    Inventory Item
                    {sortIndicator("full_name")}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Filter full name"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenMenu((current) =>
                          current === "full_name" ? null : "full_name"
                        );
                      }}
                    >
                      <FilterIcon active={Boolean(fullNameFilter.trim())} />
                    </button>
                    <button
                      type="button"
                      aria-label="Add inventory row"
                      title="Add inventory row"
                      onClick={() => setIsAddingRow(true)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      +
                    </button>
                  </div>
                  {openMenu === "full_name" ? (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full z-[150] mt-2 normal-case"
                    >
                      <FilterMenuText
                        title="Inventory Item"
                        value={fullNameFilter}
                        placeholder="Contains..."
                        onApply={setFullNameFilter}
                        onClear={() => setFullNameFilter("")}
                      />
                    </div>
                  ) : null}
                </div>
              </th>
              {visibleColumns.map((column) => {
                const columnSortKey = `column:${column.id}` as EmployeeInfoSortKey;
                const columnMenuKey = `column:${column.id}`;
                const dropdownFilterValues = columnOptionFilters[column.id] || [];
                const textFilterValue = columnTextFilters[column.id] || "";
                const isDropdownFilter = column.column_kind === "dropdown";
                const hasColumnFilter = isDropdownFilter
                  ? dropdownFilterValues.length > 0
                  : Boolean(textFilterValue.trim());

                return (
                  <th key={column.id} className="sticky top-0 z-30 bg-slate-50 px-4 py-3">
                    <div className="relative flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className={headerClass(columnSortKey)}
                        onClick={() => applySort(columnSortKey)}
                      >
                        {column.label}
                        {sortIndicator(columnSortKey)}
                      </button>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          aria-label={`Filter ${column.label}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenMenu((current) =>
                              current === columnMenuKey ? null : columnMenuKey
                            );
                          }}
                        >
                          <FilterIcon active={hasColumnFilter} />
                        </button>
                        {isAdmin ? (
                          <ColumnEditPanel
                            column={column}
                            columnIndex={columnIndexById[column.id] || 0}
                            totalColumns={columns.length}
                            formulaSuggestions={formulaSuggestions}
                            onUpdateColumn={onUpdateColumn}
                            onDeleteColumn={onDeleteColumn}
                            onMoveColumn={onMoveColumn}
                          />
                        ) : null}
                      </div>
                      {openMenu === columnMenuKey ? (
                        <div
                          ref={menuRef}
                          className="absolute right-0 top-full z-[150] mt-2 normal-case"
                        >
                          {isDropdownFilter ? (
                            <FilterMenuMulti
                              title={column.label}
                              options={[
                                { value: NONE_FILTER_VALUE, label: "N/A" },
                                ...getDropdownOptionsForColumn(column).map((option) => ({
                                  value: option,
                                  label: option,
                                })),
                              ]}
                              selectedValues={dropdownFilterValues}
                              onChange={(next) => setColumnOptionFilter(column.id, next)}
                              onClear={() => setColumnOptionFilter(column.id, [])}
                            />
                          ) : (
                            <FilterMenuText
                              title={column.label}
                              value={textFilterValue}
                              placeholder="Contains..."
                              onApply={(next) => setColumnTextFilter(column.id, next)}
                              onClear={() => setColumnTextFilter(column.id, "")}
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {isAddingRow ? (
              <tr className="bg-slate-50/80">
                <td className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50/80 px-4 py-3">
                  <form id={createRecordFormId} onSubmit={handleCreateRecordSubmit} />
                  <div className="flex items-center gap-2">
                    <input
                      form={createRecordFormId}
                      name="full_name"
                      value={newFullName}
                      placeholder="Add inventory item"
                      aria-label="Add inventory item"
                      className="w-full min-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                      onChange={(event) => setNewFullName(event.currentTarget.value)}
                      autoFocus
                      required
                    />
                    <button
                      type="submit"
                      form={createRecordFormId}
                      disabled={!newFullName.trim()}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        setIsAddingRow(false);
                        setNewFullName("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </td>
                {visibleColumns.map((column) => (
                  <td key={`new-record-${column.id}`} className="px-4 py-3 text-xs text-slate-400">
                    {column.column_kind === "formula" ? "auto" : "-"}
                  </td>
                ))}
              </tr>
            ) : null}

            {filteredAndSortedRecords.length ? (
              filteredAndSortedRecords.map((record) => {
                const valuesByColumnId = valuesByRecordId[record.id] || {};
                const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
                const rowHasLeaveDate = recordIdsWithLeaveDate.has(record.id);
                return (
                  <tr key={record.id} className={rowHasLeaveDate ? "bg-rose-50/35" : ""}>
                    <td
                      className={`sticky left-0 z-10 border-r border-slate-200 px-4 py-3 ${
                        rowHasLeaveDate ? "bg-rose-50/35" : "bg-white"
                      }`}
                    >
                      <form>
                        <input type="hidden" name="record_id" value={record.id} />
                        <input type="hidden" name="base_field" value="full_name" />
                        <input
                          name="value"
                          defaultValue={record.full_name}
                          aria-label="Inventory item"
                          className={getCellFieldClassName({
                            isEmpty: isEmptyCellValue(record.full_name),
                            minWidthClass: "w-full min-w-[14rem]",
                          })}
                          onChange={handleInputChange}
                          onBlur={handleInputBlur}
                        />
                      </form>
                    </td>
                    {visibleColumns.map((column) => {
                      const highlightEmptyState = shouldHighlightEmptyStateForColumn(column);
                      if (column.column_kind === "formula") {
                        const formulaValue = formulasByColumnId[column.id] || "";
                        const isEmpty = highlightEmptyState && isEmptyCellValue(formulaValue);
                        return (
                          <td
                            key={column.id}
                            className={`px-4 py-3 text-slate-700 ${getCellToneClass(isEmpty)}`}
                          >
                            {formulaValue || "-"}
                          </td>
                        );
                      }

                      const valueRow = valuesByColumnId[column.id];
                      if (column.column_kind === "dropdown") {
                        const dropdownSource = parseDropdownSource(column.options_json);
                        const options = getDropdownOptionsForColumn(column);
                        const isEmpty = highlightEmptyState && isEmptyCellValue(valueRow?.option_value);
                        const datalistId = `inventory-dropdown-${column.id}-${record.id}`;
                        return (
                          <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                            <form>
                              <input type="hidden" name="record_id" value={record.id} />
                              <input type="hidden" name="column_id" value={column.id} />
                              <input type="hidden" name="column_kind" value={column.column_kind} />
                              {dropdownSource === "employee_names" ? (
                                <>
                                  <input
                                    list={datalistId}
                                    name="value"
                                    defaultValue={valueRow?.option_value || ""}
                                    aria-label={column.label}
                                    placeholder="Search name..."
                                    className={getCellFieldClassName({
                                      isEmpty,
                                      minWidthClass: "w-full min-w-[12rem]",
                                    })}
                                    onChange={handleInputChange}
                                    onBlur={handleInputBlur}
                                  />
                                  <datalist id={datalistId}>
                                    {options.map((option) => (
                                      <option key={option} value={option} />
                                    ))}
                                  </datalist>
                                </>
                              ) : (
                                <select
                                  name="value"
                                  defaultValue={valueRow?.option_value || ""}
                                  aria-label={column.label}
                                  className={getCellFieldClassName({
                                    isEmpty,
                                    minWidthClass: "w-full min-w-[12rem]",
                                  })}
                                  onChange={handleSelectChange}
                                >
                                  <option value="">N/A</option>
                                  {options.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </form>
                          </td>
                        );
                      }

                    if (column.column_kind === "number") {
                      const isEmpty = highlightEmptyState && isEmptyCellValue(valueRow?.text_value);
                      return (
                        <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                            <form>
                              <input type="hidden" name="record_id" value={record.id} />
                              <input type="hidden" name="column_id" value={column.id} />
                              <input type="hidden" name="column_kind" value={column.column_kind} />
                              <input
                                type="number"
                                step="any"
                                inputMode="decimal"
                                name="value"
                                defaultValue={valueRow?.text_value || ""}
                                aria-label={column.label}
                                className={getCellFieldClassName({
                                  isEmpty,
                                  minWidthClass: "w-full min-w-[12rem]",
                                })}
                                onChange={handleInputChange}
                                onBlur={handleInputBlur}
                              />
                            </form>
                          </td>
                      );
                    }

                    if (column.column_kind === "currency") {
                      const isEmpty = highlightEmptyState && isEmptyCellValue(valueRow?.text_value);
                      const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
                        valueRow?.money_currency_code ||
                          parseEmployeeInfoCurrencyCodeFromOptions(column.options_json)
                      );
                      if (displayCurrency !== "ORIGINAL") {
                        const convertedDisplayValue =
                          currencyDisplayValueByRecordIdAndColumnId[record.id]?.[column.id] || "";
                        const sourceDisplayValue = formatEmployeeInfoCurrencyAmount(
                          valueRow?.text_value,
                          sourceCurrencyCode
                        );

                        return (
                          <td
                            key={column.id}
                            className={`px-4 py-3 text-slate-700 ${getCellToneClass(
                              highlightEmptyState && isEmptyCellValue(convertedDisplayValue)
                            )}`}
                          >
                            <div className="min-w-[12rem]">
                              <div>{convertedDisplayValue || "-"}</div>
                              {sourceDisplayValue ? (
                                <p className="text-[11px] text-slate-500">
                                  Source: {sourceDisplayValue}
                                </p>
                              ) : null}
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                          <form>
                            <input type="hidden" name="record_id" value={record.id} />
                            <input type="hidden" name="column_id" value={column.id} />
                            <input type="hidden" name="column_kind" value={column.column_kind} />
                            <div className="flex min-w-[12rem] items-center gap-2">
                              <select
                                name="currency_code"
                                defaultValue={sourceCurrencyCode}
                                aria-label={`${column.label} currency`}
                                className={`h-[34px] rounded-md border px-2 text-sm text-slate-700 ${
                                  isEmpty ? "border-red-200 bg-red-50/70" : "border-slate-300 bg-white"
                                }`}
                                onChange={handleSelectChange}
                              >
                                {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                                  <option key={code} value={code}>
                                    {code}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                inputMode="decimal"
                                name="value"
                                defaultValue={valueRow?.text_value || ""}
                                placeholder={getEmployeeInfoCurrencySymbol(sourceCurrencyCode)}
                                aria-label={column.label}
                                className={getCellFieldClassName({
                                  isEmpty,
                                  minWidthClass: "w-full",
                                })}
                                onChange={handleInputChange}
                                onBlur={handleInputBlur}
                              />
                            </div>
                          </form>
                        </td>
                      );
                    }

                    if (column.column_kind === "date") {
                      const isEmpty =
                        highlightEmptyState && isEmptyCellValue(toDateInputValue(valueRow?.text_value));
                        return (
                          <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                            <form>
                              <input type="hidden" name="record_id" value={record.id} />
                              <input type="hidden" name="column_id" value={column.id} />
                              <input type="hidden" name="column_kind" value={column.column_kind} />
                              <input
                                type="date"
                                name="value"
                                defaultValue={toDateInputValue(valueRow?.text_value)}
                                aria-label={column.label}
                                className={getCellFieldClassName({
                                  isEmpty,
                                  minWidthClass: "w-full min-w-[12rem]",
                                })}
                                onChange={handleInputChange}
                                onBlur={handleInputBlur}
                              />
                            </form>
                          </td>
                        );
                      }

                      const isEmpty = highlightEmptyState && isEmptyCellValue(valueRow?.text_value);
                      return (
                        <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                          <form>
                            <input type="hidden" name="record_id" value={record.id} />
                            <input type="hidden" name="column_id" value={column.id} />
                            <input type="hidden" name="column_kind" value={column.column_kind} />
                            <input
                              name="value"
                              defaultValue={valueRow?.text_value || ""}
                              aria-label={column.label}
                              className={getCellFieldClassName({
                                isEmpty,
                                minWidthClass: "w-full min-w-[12rem]",
                              })}
                              onChange={handleInputChange}
                              onBlur={handleInputBlur}
                            />
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-slate-500"
                  colSpan={1 + visibleColumns.length}
                >
                  {records.length
                    ? "No matching inventory records for current filters."
                    : "No inventory records yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

