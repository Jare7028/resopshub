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
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
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

  const closePopover = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  const refreshInventoryTable = () => {
    if (typeof window === "undefined") {
      router.refresh();
      return;
    }
    const nextUrl = `${window.location.pathname}${window.location.search}`;
    window.location.assign(nextUrl);
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
      closePopover();
      refreshInventoryTable();
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePopover();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isOpen) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <details
      ref={detailsRef}
      className="relative"
      data-inventory-popover="true"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary
        className="inline-flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label="New column"
        title="New column"
      >
        <span className="text-sm leading-none">+</span>
        <span>New column</span>
      </summary>
      <button
        type="button"
        className="fixed inset-0 z-[170] bg-slate-900/45"
        aria-label="Close new column popout"
        onClick={() => closePopover()}
      />
      <div className="fixed inset-0 z-[180] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Create New Column</h3>
              <p className="text-xs text-slate-500">
                Choose a name, type, and any extra settings.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
              aria-label="Close"
              onClick={() => closePopover()}
              disabled={isPending}
            >
              ×
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid gap-4 px-5 py-5">
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
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Column Name
                <input
                  name="label"
                  placeholder="e.g. Device Serial"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal tracking-normal text-slate-700"
                  required
                  autoFocus
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Column Type
                <select
                  value={columnKind}
                  onChange={(event) =>
                    setColumnKind(event.currentTarget.value as InventoryColumnKind)
                  }
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal tracking-normal text-slate-700"
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
              </label>
            </div>

            {columnKind === "currency" ? (
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Currency
                <select
                  name="currency_code"
                  value={currencyCode}
                  onChange={(event) =>
                    setCurrencyCode(normalizeEmployeeInfoCurrencyCode(event.currentTarget.value))
                  }
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal tracking-normal text-slate-700"
                >
                  {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {currencyLabelByCode[code]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {columnKind === "dropdown" ? (
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Dropdown Options
                <input
                  name="dropdown_options"
                  placeholder="Option 1, Option 2, Option 3"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal tracking-normal text-slate-700"
                  required
                />
              </label>
            ) : null}

            {columnKind === "formula" ? (
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs text-slate-500">
                  Supports <code>SUM</code>, <code>ROUND</code>, <code>IF</code>, letters (A=Inventory
                  Item, B=Client, C+ custom columns), and column keys.
                </p>
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
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
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
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => closePopover()}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 rounded-md border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isPending}
              >
                {isPending ? "Creating..." : "Create column"}
              </button>
            </div>
          </form>
        </div>
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

