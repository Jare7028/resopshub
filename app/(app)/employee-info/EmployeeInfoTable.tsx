"use client";

import { useRouter } from "next/navigation";
import {
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
import {
  EMPLOYEE_INFO_VISIBILITY_EVENT,
  EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY,
  type EmployeeInfoVisibilityState,
} from "./employeeInfoVisibility";
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
const currencyLabelByCode: Record<EmployeeInfoCurrencyCode, string> = {
  USD: "USD ($)",
  GBP: "GBP (\u00A3)",
  MUR: "MUR (Rs)",
};

function parseOptionsJson(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
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

function shouldHighlightEmptyStateForColumn(column: EmployeeInfoColumnRow) {
  const keyToken = normalizeColumnToken(column.key);
  const labelToken = normalizeColumnToken(column.label);
  return (
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(keyToken) &&
    !EMPTY_HIGHLIGHT_EXCLUDED_COLUMN_TOKENS.has(labelToken)
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
  const initialLabel = column.label;
  const initialKind = column.column_kind;
  const initialDropdownOptions = formatOptionsInput(column.options_json);
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

      const hasChanges =
        nextLabel !== initialLabel ||
        nextKind !== initialKind ||
        nextDropdownOptions !== initialDropdownOptions ||
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
    initialDropdownOptions,
    initialFormula,
    initialFormulaCurrencyCode,
    initialFormulaCurrencyMode,
    initialKind,
    initialLabel,
    isFormulaEditorOpen,
  ]);

  return (
    <details ref={detailsRef} className="relative shrink-0">
      <summary
        className="flex h-6 items-center rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold tracking-normal text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label={`Edit ${column.label}`}
        title={`Edit ${column.label}`}
      >
        Edit
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 text-left normal-case shadow-lg">
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
            <input
              name="dropdown_options"
              defaultValue={formatOptionsInput(column.options_json)}
              placeholder="Dropdown options (comma separated)"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              required
            />
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

export default function EmployeeInfoTable({
  records,
  clients,
  columns,
  valuesByRecordId,
  formulaValueByRecordIdAndColumnId,
  currencyDisplayValueByRecordIdAndColumnId,
  displayCurrency,
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
  columns: EmployeeInfoColumnRow[];
  valuesByRecordId: Record<string, Record<string, EmployeeInfoValueRow>>;
  formulaValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  currencyDisplayValueByRecordIdAndColumnId: Record<string, Record<string, string>>;
  displayCurrency: EmployeeInfoDisplayCurrencyCode;
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
  const createRecordFormId = "employee-info-create-record-form";
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [showClientColumn, setShowClientColumn] = useState(true);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => columns.map((c) => c.id));
  const hasLoadedVisibilityRef = useRef(false);
  const knownColumnIdsRef = useRef(new Set(columns.map((column) => column.id)));

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

  useEffect(() => {
    if (hasLoadedVisibilityRef.current) return;
    hasLoadedVisibilityRef.current = true;
    if (typeof window === "undefined") return;

    const knownColumnIds = new Set(columns.map((column) => column.id));
    try {
      const raw = window.localStorage.getItem(EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        show_client_column?: boolean;
        visible_column_ids?: string[];
      };
      if (typeof parsed.show_client_column === "boolean") {
        setShowClientColumn(parsed.show_client_column);
      }
      if (Array.isArray(parsed.visible_column_ids)) {
        const normalized = parsed.visible_column_ids.filter((id) => knownColumnIds.has(String(id)));
        setVisibleColumnIds(normalized);
      }
    } catch {
      // Ignore invalid persisted preferences.
    }
  }, [columns]);

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
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        EMPLOYEE_INFO_VISIBILITY_STORAGE_KEY,
        JSON.stringify({
          show_client_column: showClientColumn,
          visible_column_ids: visibleColumnIds,
        })
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [showClientColumn, visibleColumnIds]);

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

      setShowClientColumn(Boolean(detail.showClientColumn));
      setVisibleColumnIds(normalizedVisibleColumnIds);
    };

    window.addEventListener(EMPLOYEE_INFO_VISIBILITY_EVENT, onVisibilityUpdated);
    return () => {
      window.removeEventListener(EMPLOYEE_INFO_VISIBILITY_EVENT, onVisibilityUpdated);
    };
  }, [columns]);

  const getHighlightPolicyForControl = (control: HTMLInputElement | HTMLSelectElement) => {
    const form = control.form;
    const columnId = String(
      form?.querySelector<HTMLInputElement>('input[name="column_id"]')?.value || ""
    );
    const column = columns.find((item) => item.id === columnId);
    return column ? shouldHighlightEmptyStateForColumn(column) : true;
  };

  const saveControlChange = (control: HTMLInputElement | HTMLSelectElement) => {
    const shouldHighlight = getHighlightPolicyForControl(control);
    syncEditableCellHighlight(control, shouldHighlight);
    const form = control.form;
    if (!form) return;
    const formData = new FormData(form);
    startTransition(() => {
      void (async () => {
        const result = await onUpdateCell(formData);
        if (!result?.ok && result?.error) {
          window.alert(result.error);
          return;
        }
        if (result?.ok) {
          router.refresh();
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
      setNewClientId("");
      router.refresh();
    });
  };

  const preventMiddleClickAutoscroll = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  return (
    <div
      className="overflow-x-auto"
      onMouseDown={preventMiddleClickAutoscroll}
      onAuxClick={preventMiddleClickAutoscroll}
    >
      <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 top-0 z-40 border-r border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span>Full Name</span>
                  <button
                    type="button"
                    aria-label="Add employee row"
                    title="Add employee row"
                    onClick={() => setIsAddingRow(true)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    +
                  </button>
                </div>
              </th>
              {showClientColumn ? (
                <th className="sticky top-0 z-30 bg-slate-50 px-4 py-3">Client</th>
              ) : null}
              {visibleColumns.map((column) => (
                <th key={column.id} className="sticky top-0 z-30 bg-slate-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span>{column.label}</span>
                    </div>
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
                </th>
              ))}
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
                      placeholder="Add employee full name"
                      aria-label="Add employee full name"
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
                        setNewClientId("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </td>
                {showClientColumn ? (
                  <td className="px-4 py-3">
                    <select
                      form={createRecordFormId}
                      name="client_id"
                      value={newClientId}
                      aria-label="New employee client"
                      className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                      onChange={(event) => setNewClientId(event.currentTarget.value)}
                    >
                      <option value="">Client (N/A)</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                {visibleColumns.map((column) => (
                  <td key={`new-record-${column.id}`} className="px-4 py-3 text-xs text-slate-400">
                    {column.column_kind === "formula" ? "auto" : "-"}
                  </td>
                ))}
              </tr>
            ) : null}

            {records.length ? (
              records.map((record) => {
                const valuesByColumnId = valuesByRecordId[record.id] || {};
                const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
                return (
                  <tr key={record.id}>
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-3">
                      <form>
                        <input type="hidden" name="record_id" value={record.id} />
                        <input type="hidden" name="base_field" value="full_name" />
                        <input
                          name="value"
                          defaultValue={record.full_name}
                          aria-label="Full name"
                          className={getCellFieldClassName({
                            isEmpty: isEmptyCellValue(record.full_name),
                            minWidthClass: "w-full min-w-[14rem]",
                          })}
                          onChange={handleInputChange}
                          onBlur={handleInputBlur}
                        />
                      </form>
                    </td>
                    {showClientColumn ? (
                      <td className={`px-4 py-3 ${getCellToneClass(isEmptyCellValue(record.client_id))}`}>
                        <form>
                          <input type="hidden" name="record_id" value={record.id} />
                          <input type="hidden" name="base_field" value="client_id" />
                          <select
                            name="value"
                            defaultValue={record.client_id || ""}
                            aria-label="Client"
                            className={getCellFieldClassName({
                              isEmpty: isEmptyCellValue(record.client_id),
                              minWidthClass: "w-full min-w-[12rem]",
                            })}
                            onChange={handleSelectChange}
                          >
                            <option value="">N/A</option>
                            {clients.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.name}
                              </option>
                            ))}
                          </select>
                        </form>
                      </td>
                    ) : null}
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
                        const options = parseOptionsJson(column.options_json);
                        const isEmpty = highlightEmptyState && isEmptyCellValue(valueRow?.option_value);
                        return (
                          <td key={column.id} className={`px-4 py-3 ${getCellToneClass(isEmpty)}`}>
                            <form>
                              <input type="hidden" name="record_id" value={record.id} />
                              <input type="hidden" name="column_id" value={column.id} />
                              <input type="hidden" name="column_kind" value={column.column_kind} />
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
                  colSpan={1 + (showClientColumn ? 1 : 0) + visibleColumns.length}
                >
                  No employee records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
  );
}
