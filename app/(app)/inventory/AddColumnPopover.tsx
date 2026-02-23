"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import FormulaAutocompleteInput, {
  type FormulaSuggestion,
} from "./FormulaAutocompleteInput";
import FormulaEditorDialog from "./FormulaEditorDialog";
import {
  EMPLOYEE_INFO_CURRENCY_CODES,
  EMPLOYEE_INFO_FORMULA_CURRENCY_MODES,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoFormulaCurrencyMode,
} from "@/lib/employeeInfo";

type EmployeeInfoColumnKind = "text" | "number" | "date" | "currency" | "dropdown" | "formula";
type InventoryColumnKind =
  | EmployeeInfoColumnKind
  | "employee_name"
  | "client_lookup";
type EmployeeInfoActionResult = { ok: boolean; error?: string };
const currencyLabelByCode: Record<EmployeeInfoCurrencyCode, string> = {
  USD: "USD ($)",
  GBP: "GBP (\u00A3)",
  MUR: "MUR (Rs)",
};

export default function AddColumnPopover({
  formulaSuggestions,
  onCreateColumn,
}: {
  formulaSuggestions: FormulaSuggestion[];
  onCreateColumn: (formData: FormData) => Promise<EmployeeInfoActionResult>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [columnKind, setColumnKind] = useState<InventoryColumnKind>("text");
  const [currencyCode, setCurrencyCode] = useState<EmployeeInfoCurrencyCode>("USD");
  const [formulaCurrencyMode, setFormulaCurrencyMode] =
    useState<EmployeeInfoFormulaCurrencyMode>("display");
  const [formulaCurrencyCode, setFormulaCurrencyCode] = useState<EmployeeInfoCurrencyCode>("USD");
  const [formulaValue, setFormulaValue] = useState("");
  const [isFormulaEditorOpen, setIsFormulaEditorOpen] = useState(false);

  useEffect(() => {
    if (columnKind !== "formula" && isFormulaEditorOpen) {
      setIsFormulaEditorOpen(false);
    }
  }, [columnKind, isFormulaEditorOpen]);

  const resetState = () => {
    setColumnKind("text");
    setCurrencyCode("USD");
    setFormulaCurrencyMode("display");
    setFormulaCurrencyCode("USD");
    setFormulaValue("");
    setIsFormulaEditorOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (columnKind === "formula" && !formulaValue.trim()) {
      window.alert("Formula is required");
      return;
    }

    const formData = new FormData(form);
    startTransition(async () => {
      const result = await onCreateColumn(formData);
      if (!result?.ok) {
        if (result?.error) window.alert(result.error);
        return;
      }
      form.reset();
      resetState();
      if (detailsRef.current) detailsRef.current.open = false;
      router.refresh();
    });
  };

  return (
    <details
      ref={detailsRef}
      className="relative"
      data-inventory-popover="true"
    >
      <summary
        className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-lg font-semibold leading-none text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label="Add column"
        title="Add column"
      >
        +
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-[min(92vw,36rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <p className="text-xs text-slate-500">
          Formula columns support Excel-style functions (for example <code>SUM</code>,{" "}
          <code>ROUND</code>, <code>IF</code>), plus letters (A=Inventory Item, B=Client, C onward
          custom columns) and
          column keys (for example <code>=salary + bonus</code> or{" "}
          <code>=IF(OR(client=&quot;Resolvable&quot;,client=&quot;Dusk&quot;),500,0)</code>).
        </p>
        <form onSubmit={handleSubmit} className="mt-3 grid gap-3">
          <input
            type="hidden"
            name="column_kind"
            value={
              columnKind === "employee_name" || columnKind === "client_lookup"
                ? "dropdown"
                : columnKind
            }
          />
          <input
            type="hidden"
            name="dropdown_source"
            value={
              columnKind === "employee_name"
                ? "employee_names"
                : columnKind === "client_lookup"
                ? "clients"
                : "custom"
            }
          />
          <input
            name="label"
            placeholder="Column label"
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            required
          />
          <select
            value={columnKind}
            onChange={(event) =>
              setColumnKind(event.currentTarget.value as InventoryColumnKind)
            }
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="currency">Currency ($)</option>
            <option value="dropdown">Dropdown</option>
            <option value="employee_name">Name (Employee Info)</option>
            <option value="client_lookup">Client</option>
            <option value="formula">Formula</option>
          </select>
          {columnKind === "currency" ? (
            <select
              name="currency_code"
              value={currencyCode}
              onChange={(event) =>
                setCurrencyCode(normalizeEmployeeInfoCurrencyCode(event.currentTarget.value))
              }
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
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
              placeholder="Dropdown options (comma separated)"
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
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
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
                required
                suggestions={formulaSuggestions}
              />
              <button
                type="button"
                onClick={() => setIsFormulaEditorOpen(true)}
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
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
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
              >
                {EMPLOYEE_INFO_FORMULA_CURRENCY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "display"
                      ? "Formula currency: follow display switch"
                      : "Formula currency: fixed"}
                  </option>
                ))}
              </select>
              {formulaCurrencyMode === "fixed" ? (
                <select
                  name="formula_currency_code"
                  value={formulaCurrencyCode}
                  onChange={(event) =>
                    setFormulaCurrencyCode(normalizeEmployeeInfoCurrencyCode(event.currentTarget.value))
                  }
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
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
            className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Add column
          </button>
        </form>
      </div>
      <FormulaEditorDialog
        open={isFormulaEditorOpen}
        title="Formula Editor"
        value={formulaValue}
        onValueChange={setFormulaValue}
        onClose={() => setIsFormulaEditorOpen(false)}
        suggestions={formulaSuggestions}
      />
    </details>
  );
}

